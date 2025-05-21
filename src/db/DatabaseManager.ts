// upload/src/db/DatabaseManager.ts
import pg, { Pool, PoolClient } from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigurationManager } from '../config/ConfigurationManager.js';
import { logger } from '../utils/logger.js';

export class DatabaseManager {
  private static instance: DatabaseManager | null = null;
  private static initializationPromise: Promise<void> | null = null;
  private pool: Pool;
  private initializationComplete: boolean = false;

  private constructor() {
    const configManager = ConfigurationManager.getInstance();
    logger.info('[DatabaseManager] Constructor: Setting up PostgreSQL connection pool...');
    try {
      this.pool = new pg.Pool({
        host: configManager.getPgHost(),
        port: configManager.getPgPort(),
        user: configManager.getPgUser(),
        password: configManager.getPgPassword(),
        database: configManager.getPgDatabase(),
        connectionTimeoutMillis: 5000,
      });

      this.pool.on('error', (err) => {
        logger.error('[DatabaseManager] Unexpected error on idle client', { err });
        console.error('[DatabaseManager] Fallback console log: Unexpected error on idle client:', err);
        this.initializationComplete = false;
        DatabaseManager.instance = null;
        DatabaseManager.initializationPromise = null;
      });
      logger.info('[DatabaseManager] Constructor: PostgreSQL connection pool configured.');
    } catch (configError) {
      logger.error('[DatabaseManager] CRITICAL: Failed to configure PostgreSQL pool:', { error: configError });
      console.error(
        '[DatabaseManager] Fallback console log: CRITICAL: Failed to configure PostgreSQL pool:',
        configError
      );
      throw configError;
    }
  }

  public static async getInstance(): Promise<DatabaseManager> {
    if (DatabaseManager.instance?.initializationComplete) {
      logger.debug('[DatabaseManager] getInstance: Returning existing initialized instance.');
      return DatabaseManager.instance;
    }

    if (DatabaseManager.initializationPromise) {
      logger.debug('[DatabaseManager] getInstance: Initialization in progress, awaiting existing promise.');
      await DatabaseManager.initializationPromise;
      if (DatabaseManager.instance?.initializationComplete) {
        return DatabaseManager.instance;
      } else {
        logger.error('[DatabaseManager] getInstance: Awaited existing promise, but initialization failed.');
        throw new Error('DatabaseManager initialization failed after awaiting existing promise.');
      }
    }

    logger.debug('[DatabaseManager] getInstance: No instance or ongoing initialization, starting new...');
    const newInstance = new DatabaseManager();
    DatabaseManager.initializationPromise = newInstance
      .initializeDatabaseInternal()
      .then(() => {
        logger.info('[DatabaseManager] getInstance: Initialization successful.');
        DatabaseManager.instance = newInstance;
      })
      .catch((initError) => {
        logger.error('[DatabaseManager] getInstance: Initialization failed.', { initError });
        DatabaseManager.initializationPromise = null;
        DatabaseManager.instance = null;
        throw initError;
      });

    await DatabaseManager.initializationPromise;

    if (!DatabaseManager.instance?.initializationComplete) {
      logger.error(
        '[DatabaseManager] getInstance: Exiting, failed to get a fully initialized instance after new attempt.'
      );
      throw new Error('DatabaseManager initialization failed or did not complete.');
    }

    logger.debug('[DatabaseManager] getInstance: Returning newly initialized instance.');
    return DatabaseManager.instance;
  }

  private async logConnectionDetails(client: PoolClient): Promise<void> {
    try {
      logger.info('[DatabaseManager] Querying connection details from Node.js application perspective...');
      const versionRes = await client.query('SELECT version();');
      const dbNameRes = await client.query('SELECT current_database();');
      const userRes = await client.query('SELECT current_user;');
      const dataDirRes = await client.query('SHOW data_directory;');
      const serverAddrRes = await client.query('SELECT inet_server_addr(), inet_server_port();');
      const settingContextRes = await client.query('SHOW config_file;');

      logger.info(`[DatabaseManager] Connected to PostgreSQL Server Version: ${versionRes.rows[0]?.version}`);
      logger.info(`[DatabaseManager] Current Database: ${dbNameRes.rows[0]?.current_database}`);
      logger.info(`[DatabaseManager] Current User: ${userRes.rows[0]?.current_user}`);
      logger.info(`[DatabaseManager] Data Directory (from SHOW data_directory): ${dataDirRes.rows[0]?.data_directory}`);
      logger.info(`[DatabaseManager] Config File (from SHOW config_file): ${settingContextRes.rows[0]?.config_file}`);
      if (serverAddrRes.rows[0]) {
        logger.info(
          `[DatabaseManager] Server Listening on IP: ${serverAddrRes.rows[0].inet_server_addr}, Port: ${serverAddrRes.rows[0].inet_server_port}`
        );
      } else {
        logger.warn('[DatabaseManager] Could not retrieve server address and port.');
      }
    } catch (error) {
      logger.error(
        '[DatabaseManager] Failed to query extended connection details (some queries might require specific permissions):',
        {
          message: error instanceof Error ? error.message : String(error),
          // @ts-expect-error Expected error if 'code' property doesn't exist on 'unknown' type
          code: error.code,
        }
      );
      try {
        const versionRes = await client.query('SELECT version();');
        logger.info(
          `[DatabaseManager] Connected to PostgreSQL Server Version (fallback): ${versionRes.rows[0]?.version}`
        );
      } catch (versionError) {
        logger.error('[DatabaseManager] Failed to query even PostgreSQL version (fallback):', { versionError });
      }
    }
  }

  // REMOVED checkEssentialTablesExist method

  private async initializeDatabaseInternal(): Promise<void> {
    if (this.initializationComplete) {
      logger.debug('[DatabaseManager] initializeDatabaseInternal: Instance already marked complete.');
      return;
    }

    logger.info('[DatabaseManager] initializeDatabaseInternal: Starting schema initialization process...');
    let client: PoolClient | null = null;
    try {
      logger.debug('[DatabaseManager] initializeDatabaseInternal: Attempting connection...');
      client = await this.pool.connect();
      logger.info(`[DatabaseManager] initializeDatabaseInternal: Connected to PostgreSQL.`);

      await this.logConnectionDetails(client); // Keep this for diagnostics

      const forceSchemaRun = process.env.FORCE_SCHEMA_RUN === 'true';
      logger.info(
        `[DatabaseManager] initializeDatabaseInternal: FORCE_SCHEMA_RUN environment variable is set to '${process.env.FORCE_SCHEMA_RUN}', schema run is ${forceSchemaRun ? 'ENABLED' : 'DISABLED'}.`
      );

      if (forceSchemaRun) {
        logger.info('[DatabaseManager] initializeDatabaseInternal: Force schema run enabled. Executing schema.sql...');
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const schemaPath = path.join(__dirname, 'schema.sql');
        logger.info(`[DatabaseManager] initializeDatabaseInternal: Schema path: ${schemaPath}`);

        try {
          await fs.access(schemaPath);
        } catch (accessError) {
          logger.error(`[DatabaseManager] initializeDatabaseInternal: Schema file not found at ${schemaPath}.`, {
            accessError,
          });
          throw new Error(`Schema file not found: ${schemaPath}`);
        }

        const schemaSql = await fs.readFile(schemaPath, 'utf8');
        logger.debug('[DatabaseManager] initializeDatabaseInternal: Executing schema setup from schema.sql...');
        await client.query(schemaSql);
        logger.info('[DatabaseManager] initializeDatabaseInternal: Full schema script executed.');

        // You might still want a simple confirmation here if FORCE_SCHEMA_RUN was true,
        // or rely on the psql logs from build.sh for that confirmation.
        // For example, check if 'work_items' exists after a forced schema run.
        const finalCheck = await client.query(
          `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'work_items');`
        );
        if (!finalCheck.rows[0]?.exists) {
          logger.error(
            '[DatabaseManager] initializeDatabaseInternal: work_items table does not exist even after a forced schema execution!'
          );
          throw new Error('Schema execution (when forced) failed to create work_items table.');
        } else {
          logger.info(
            '[DatabaseManager] initializeDatabaseInternal: Confirmed work_items table exists after forced schema run.'
          );
        }
      } else {
        logger.info(
          '[DatabaseManager] initializeDatabaseInternal: Skipped forced schema run based on FORCE_SCHEMA_RUN environment variable.'
        );
        // REMOVED call to checkEssentialTablesExist and associated error throwing
        logger.info(
          '[DatabaseManager] initializeDatabaseInternal: Proceeding without explicit table existence check as FORCE_SCHEMA_RUN is not true.'
        );
      }

      this.initializationComplete = true;
      logger.info('[DatabaseManager] initializeDatabaseInternal: Initialization marked as complete.');
    } catch (error: unknown) {
      logger.error('[DatabaseManager] initializeDatabaseInternal: FAILED during execution:', { error });
      console.error(
        '[DatabaseManager] initializeDatabaseInternal: Fallback console log: FAILED during execution:',
        error
      );
      this.initializationComplete = false;
      throw error;
    } finally {
      if (client) {
        client.release();
        logger.info(`[DatabaseManager] initializeDatabaseInternal: Released client.`);
      }
    }
  }

  public getPool(): Pool {
    if (!this.initializationComplete || !DatabaseManager.instance) {
      logger.error('[DatabaseManager] getPool called before initialization was complete or on a failed instance.');
      throw new Error('Database manager getPool called before initialization was complete or on a failed instance.');
    }
    return this.pool;
  }

  public async closeDb(): Promise<void> {
    const instance = DatabaseManager.instance;
    DatabaseManager.instance = null;
    DatabaseManager.initializationPromise = null;

    if (instance?.pool) {
      logger.info('[DatabaseManager] Closing PostgreSQL connection pool...');
      instance.initializationComplete = false;
      try {
        await instance.pool.end();
        logger.info('[DatabaseManager] PostgreSQL connection pool closed.');
      } catch (closeError) {
        logger.error('[DatabaseManager] Error closing pool:', { closeError });
      }
    } else {
      logger.warn('[DatabaseManager] closeDb called but no pool/instance was available.');
    }
  }
}
