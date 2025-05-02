// src/db/DatabaseManager.ts
import pg, { Pool, PoolClient } from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigurationManager } from '../config/ConfigurationManager.js';
import { logger } from '../utils/logger.js';

export class DatabaseManager {
  private static instance: DatabaseManager | null = null;
  private pool: Pool;
  private initializationComplete: boolean = false;
  private initializationPromise: Promise<void> | null = null;

  private constructor() {
    const configManager = ConfigurationManager.getInstance();
    logger.info('[DatabaseManager] Setting up PostgreSQL connection pool...');
    try {
      this.pool = new pg.Pool({
        host: configManager.getPgHost(),
        port: configManager.getPgPort(),
        user: configManager.getPgUser(),
        password: configManager.getPgPassword(),
        database: configManager.getPgDatabase(),
      });
      this.pool.on('error', (err) => {
        logger.error('[DatabaseManager] Unexpected error on idle client', { err });
        console.error('[DatabaseManager] Fallback console log: Unexpected error on idle client:', err);
      });
      logger.info('[DatabaseManager] PostgreSQL connection pool configured.');
      // Start initialization immediately
      this.initializationPromise = this.initializeDatabaseInternal();
    } catch (configError) {
      logger.error('[DatabaseManager] CRITICAL: Failed to configure PostgreSQL pool:', { error: configError });
      console.error(
        '[DatabaseManager] Fallback console log: CRITICAL: Failed to configure PostgreSQL pool:',
        configError
      );
      process.exit(1); // Exit if pool config fails
    }
  }

  public static async getInstance(): Promise<DatabaseManager> {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
      await DatabaseManager.instance.initializationPromise;
      logger.info('[DatabaseManager] Instance created and database initialized.');
    } else {
      await DatabaseManager.instance.initializationPromise;
    }
    if (!DatabaseManager.instance?.initializationComplete) {
      logger.error('[DatabaseManager] getInstance called but initialization failed or did not complete.');
      throw new Error('Database initialization failed or did not complete.');
    }
    return DatabaseManager.instance;
  }

  private async initializeDatabaseInternal(): Promise<void> {
    if (this.initializationComplete) {
      logger.info('[DatabaseManager] Initialization already marked complete.');
      return;
    }
    if (this.initializationPromise && !this.initializationComplete) {
      logger.warn('[DatabaseManager] Initialization already in progress, awaiting existing promise.');
      return this.initializationPromise;
    }

    logger.info('[DatabaseManager] Starting database schema initialization...');
    let client: PoolClient | null = null;
    try {
      client = await this.pool.connect();
      logger.info(`[DatabaseManager] Connected to PostgreSQL for schema check/application.`);

      // --- FIX: Force schema execution for tests or always ---
      // Option: Check an environment variable like NODE_ENV === 'test'
      // For simplicity now, let's *always* try to run the schema script.
      // The script uses DROP/CREATE which should handle resetting.
      const forceSchemaRun = true; // Set to true to always run
      // const requiredTables = ['work_items', 'work_item_dependencies', 'action_history', 'undo_steps'];
      // let allTablesExist = true;
      // ... (Keep the check logic if you want conditional run later) ...
      // logger.debug(`[DatabaseManager] All required tables exist check result: ${allTablesExist}`);

      // if (!allTablesExist || forceSchemaRun) { // Modify condition
      if (forceSchemaRun) {
        // Simpler: Always run
        logger.info(
          '[DatabaseManager] Force schema run enabled or tables missing. Initializing/Re-initializing schema...'
        );
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const schemaPath = path.join(__dirname, 'schema.sql'); // Relative to dist/db
        logger.info(`[DatabaseManager] Looking for schema file at: ${schemaPath}`);

        // Check if file exists before reading
        try {
          await fs.access(schemaPath);
        } catch (accessError) {
          logger.error(`[DatabaseManager] Schema file not found at ${schemaPath}`);
          throw new Error(`Schema file not found: ${schemaPath}`);
        }

        const schemaSql = await fs.readFile(schemaPath, 'utf8');
        logger.debug('[DatabaseManager] Schema file read successfully. Executing schema setup...');

        // Execute the full script
        await client.query(schemaSql);
        logger.info('[DatabaseManager] Full schema script executed.');

        // Optional: Verify critical tables exist after execution
        const finalCheck = await client.query(
          `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'work_items');`
        );
        if (!finalCheck.rows[0]?.exists) {
          logger.error('!!! [DatabaseManager] work_items table STILL does not exist after schema execution!');
          throw new Error('Schema execution failed to create work_items table.');
        } else {
          logger.info('[DatabaseManager] Confirmed work_items table exists after schema execution.');
        }
      } else {
        // This block might not be reached if forceSchemaRun is true
        logger.info('[DatabaseManager] Database schema already initialized (all required tables exist).');
      }
      // --- End FIX ---

      this.initializationComplete = true;
      logger.info('[DatabaseManager] Initialization marked as complete.');
    } catch (error: unknown) {
      logger.error('[DatabaseManager] FAILED during initializeDatabase execution:', { error });
      console.error('[DatabaseManager] Fallback console log: FAILED during initializeDatabase execution:', error);
      this.initializationComplete = false;
      throw error;
    } finally {
      if (client) {
        client.release();
        logger.info(`[DatabaseManager] Released schema check/application client.`);
      }
    }
  }

  public getPool(): Pool {
    if (!this.initializationComplete) {
      logger.error('[DatabaseManager] getPool called before initialization was complete or after it failed.');
      throw new Error('Database manager getPool called before initialization was complete or after it failed.');
    }
    return this.pool;
  }

  public async closeDb(): Promise<void> {
    if (this.pool) {
      logger.info('[DatabaseManager] Closing PostgreSQL connection pool...');
      this.initializationComplete = false;
      this.initializationPromise = null;
      DatabaseManager.instance = null;
      await this.pool.end();
      logger.info('[DatabaseManager] PostgreSQL connection pool closed.');
    }
  }
}
