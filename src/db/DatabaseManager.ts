// src/db/DatabaseManager.ts
import pg, { Pool, PoolClient } from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigurationManager } from '../config/ConfigurationManager.js';
import { logger } from '../utils/logger.js';

export class DatabaseManager {
  private static instance: DatabaseManager | null = null;
  private static initializationPromise: Promise<void> | null = null; // Static promise for initialization
  private pool: Pool;
  private initializationComplete: boolean = false; // Instance-level flag

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
        connectionTimeoutMillis: 5000, // Keep timeout
      });

      this.pool.on('error', (err) => {
        logger.error('[DatabaseManager] Unexpected error on idle client', { err });
        console.error('[DatabaseManager] Fallback console log: Unexpected error on idle client:', err);
        // On critical error, reset state to allow re-initialization attempt
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
      throw configError; // Throw error to prevent instantiation
    }
  }

  // Simplified getInstance - handles initialization on first call
  public static async getInstance(): Promise<DatabaseManager> {
    // If instance exists and is initialized, return it directly
    if (DatabaseManager.instance?.initializationComplete) {
      logger.debug('[DatabaseManager] getInstance: Returning existing initialized instance.');
      return DatabaseManager.instance;
    }

    // If initialization is already in progress, await it
    if (DatabaseManager.initializationPromise) {
      logger.debug('[DatabaseManager] getInstance: Initialization in progress, awaiting existing promise.');
      await DatabaseManager.initializationPromise;
      // Check again if successful after awaiting
      if (DatabaseManager.instance?.initializationComplete) {
        return DatabaseManager.instance;
      } else {
        logger.error('[DatabaseManager] getInstance: Awaited existing promise, but initialization failed.');
        throw new Error('DatabaseManager initialization failed after awaiting existing promise.');
      }
    }

    // Otherwise, start new initialization
    logger.debug('[DatabaseManager] getInstance: No instance or ongoing initialization, starting new...');
    const newInstance = new DatabaseManager();
    DatabaseManager.initializationPromise = newInstance
      .initializeDatabaseInternal()
      .then(() => {
        logger.info('[DatabaseManager] getInstance: Initialization successful.');
        DatabaseManager.instance = newInstance; // Set static instance *after* successful init
      })
      .catch((initError) => {
        logger.error('[DatabaseManager] getInstance: Initialization failed.', { initError });
        DatabaseManager.initializationPromise = null; // Reset promise on failure
        DatabaseManager.instance = null; // Ensure no broken instance is kept
        throw initError; // Propagate the error
      });

    await DatabaseManager.initializationPromise;

    // Final check after awaiting the *new* promise
    if (!DatabaseManager.instance?.initializationComplete) {
      logger.error(
        '[DatabaseManager] getInstance: Exiting, failed to get a fully initialized instance after new attempt.'
      );
      throw new Error('DatabaseManager initialization failed or did not complete.');
    }

    logger.debug('[DatabaseManager] getInstance: Returning newly initialized instance.');
    return DatabaseManager.instance;
  }

  private async initializeDatabaseInternal(): Promise<void> {
    // Prevent re-running if already complete on this instance
    if (this.initializationComplete) {
      logger.debug('[DatabaseManager] initializeDatabaseInternal: Instance already marked complete.');
      return;
    }

    logger.info('[DatabaseManager] initializeDatabaseInternal: Starting schema initialization...');
    let client: PoolClient | null = null;
    try {
      // Direct connection attempt
      logger.debug('[DatabaseManager] initializeDatabaseInternal: Attempting connection...');
      client = await this.pool.connect(); // Throws if connection fails
      logger.info(`[DatabaseManager] initializeDatabaseInternal: Connected to PostgreSQL.`);

      const forceSchemaRun = true; // Keep forcing schema run for test consistency
      if (forceSchemaRun) {
        logger.info('[DatabaseManager] initializeDatabaseInternal: Force schema run enabled.');
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
        logger.debug('[DatabaseManager] initializeDatabaseInternal: Executing schema setup...');
        await client.query(schemaSql);
        logger.info('[DatabaseManager] initializeDatabaseInternal: Full schema script executed.');

        // Verification
        const finalCheck = await client.query(
          `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'work_items');`
        );
        if (!finalCheck.rows[0]?.exists) {
          logger.error(
            '[DatabaseManager] initializeDatabaseInternal: work_items table does not exist after execution!'
          );
          throw new Error('Schema execution failed to create work_items table.');
        } else {
          logger.info('[DatabaseManager] initializeDatabaseInternal: Confirmed work_items table exists.');
        }
      } else {
        logger.info('[DatabaseManager] initializeDatabaseInternal: Skipped forced schema run.');
      }

      this.initializationComplete = true; // Mark instance as complete *only on success*
      logger.info('[DatabaseManager] initializeDatabaseInternal: Initialization marked as complete.');
    } catch (error: unknown) {
      logger.error('[DatabaseManager] initializeDatabaseInternal: FAILED during execution:', { error });
      console.error(
        '[DatabaseManager] initializeDatabaseInternal: Fallback console log: FAILED during execution:',
        error
      );
      this.initializationComplete = false; // Ensure it's marked as failed
      throw error; // Propagate error to reject the initializationPromise
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
    const instance = DatabaseManager.instance; // Grab current instance if it exists
    DatabaseManager.instance = null; // Clear static ref
    DatabaseManager.initializationPromise = null; // Clear static promise

    if (instance?.pool) {
      logger.info('[DatabaseManager] Closing PostgreSQL connection pool...');
      instance.initializationComplete = false; // Mark specific instance as not complete
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
