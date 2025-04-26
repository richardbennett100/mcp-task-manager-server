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
            this.pool.on('error', (err) => { // Simplified error handler
                logger.error('[DatabaseManager] Unexpected error on idle client', { err });
                console.error('[DatabaseManager] Fallback console log: Unexpected error on idle client:', err);
            });
            logger.info('[DatabaseManager] PostgreSQL connection pool configured.');
            this.initializationPromise = this.initializeDatabaseInternal();
        } catch (configError) {
            logger.error('[DatabaseManager] CRITICAL: Failed to configure PostgreSQL pool:', { error: configError });
            console.error('[DatabaseManager] Fallback console log: CRITICAL: Failed to configure PostgreSQL pool:', configError);
            process.exit(1);
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
            // This error should be thrown by the awaited promise if init failed
            throw new Error("Database initialization failed or did not complete.");
        }
        return DatabaseManager.instance;
    }

    private async initializeDatabaseInternal(): Promise<void> {
        if (this.initializationComplete) return;
        if (this.initializationPromise && !this.initializationComplete) {
            logger.warn("[DatabaseManager] Initialization already in progress, awaiting existing promise.");
            return this.initializationPromise;
        }

        logger.info('[DatabaseManager] Starting database schema initialization...');
        let client: PoolClient | null = null;
        try {
            client = await this.pool.connect();
            logger.info(`[DatabaseManager] Connected to PostgreSQL for schema check.`);

            // --- FIX: Check for 'work_items' table instead of 'projects' ---
            const tableCheck = await client.query(`
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables
                    WHERE table_schema = 'public'
                    AND table_name = 'work_items'
                );
            `);
            // --- END FIX ---
            logger.debug(`[DatabaseManager] Table check result ('work_items' exists): ${tableCheck.rows[0]?.exists}`);

            if (!tableCheck.rows[0]?.exists) {
                logger.info('[DatabaseManager] "work_items" table not found. Initializing schema...');
                const __filename = fileURLToPath(import.meta.url);
                const __dirname = path.dirname(__filename);
                const schemaPath = path.join(__dirname, 'schema.sql');
                logger.info(`[DatabaseManager] Looking for schema file at: ${schemaPath}`);
                await fs.access(schemaPath);
                const schemaSql = await fs.readFile(schemaPath, 'utf8');
                logger.debug('[DatabaseManager] Schema file read successfully. Executing schema SQL...');
                await client.query(schemaSql);
                logger.info('[DatabaseManager] Database schema initialized successfully via schema.sql execution.');
            } else {
                logger.info('[DatabaseManager] Database schema already initialized ("work_items" table exists).');
            }
            this.initializationComplete = true;
            logger.info('[DatabaseManager] Initialization marked as complete.');
        } catch (error: unknown) { // Use unknown for better type safety
            logger.error('[DatabaseManager] FAILED during initializeDatabase execution:', { error });
            console.error('[DatabaseManager] Fallback console log: FAILED during initializeDatabase execution:', error);
            this.initializationComplete = false;
            throw error;
        } finally {
            if (client) {
                client.release();
                logger.info(`[DatabaseManager] Released schema check client.`);
            }
        }
    }

    public getPool(): Pool {
        if (!this.initializationComplete) {
            throw new Error('Database manager getPool called before initialization was complete.');
        }
        return this.pool;
    }

    public async closeDb(): Promise<void> {
        if (this.pool) {
            logger.info('[DatabaseManager] Closing PostgreSQL connection pool...');
            await this.pool.end();
            logger.info('[DatabaseManager] PostgreSQL connection pool closed.');
        }
    }
}