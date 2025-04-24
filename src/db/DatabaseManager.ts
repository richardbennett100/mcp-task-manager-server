import pg, { Pool, PoolClient } from 'pg'; // Import Pool and PoolClient from pg
import fs from 'node:fs/promises'; // Use promises version of fs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigurationManager } from '../config/ConfigurationManager.js';
import { logger } from '../utils/logger.js';

export class DatabaseManager {
    private static instance: DatabaseManager;
    private pool: Pool; // Use pg.Pool

    private constructor() {
        const configManager = ConfigurationManager.getInstance();
        logger.info('[DatabaseManager] Setting up PostgreSQL connection pool...');

        // Create the connection pool using config
        this.pool = new pg.Pool({
            host: configManager.getPgHost(),
            port: configManager.getPgPort(),
            user: configManager.getPgUser(),
            password: configManager.getPgPassword(), // Can be undefined if using other auth methods
            database: configManager.getPgDatabase(),
            // Add other pool options if needed (e.g., ssl, max connections, idle timeout)
            // ssl: configManager.getPgSsl(),
            // max: 20,
            // idleTimeoutMillis: 30000,
            // connectionTimeoutMillis: configManager.getPgConnectionTimeoutMillis(),
        });

        // Optional: Add listener for pool errors
        this.pool.on('error', (err, client) => {
            logger.error('[DatabaseManager] Unexpected error on idle client', {
                error: err.message,
                stack: err.stack
            });
            // Decide how to handle this, e.g., exit process
            // process.exit(-1);
        });

        logger.info('[DatabaseManager] PostgreSQL connection pool configured.');

        // Initialize DB schema asynchronously, but don't block constructor
        // The application might start serving requests before schema is fully verified/applied
        // A better approach might involve an explicit async init method called at startup.
        this.initializeDatabase().catch(err => {
             logger.error('[DatabaseManager] Database initialization failed:', err);
             // Depending on requirements, might need to shut down the app here
             // process.exit(1);
        });
    }

    public static getInstance(): DatabaseManager {
        if (!DatabaseManager.instance) {
            DatabaseManager.instance = new DatabaseManager();
        }
        return DatabaseManager.instance;
    }

    // Initialization is now async
    private async initializeDatabase(): Promise<void> {
        logger.info('[DatabaseManager] Initializing database schema if necessary...');
        let client: PoolClient | null = null; // Define client variable outside try
        try {
            // Get a client from the pool to perform initialization checks
            client = await this.pool.connect();
            logger.info('[DatabaseManager] Connected to PostgreSQL for schema check.');

            // Check if 'projects' table exists
            // Using information_schema is standard SQL
            const tableCheck = await client.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables
                    WHERE table_schema = 'public'
                    AND table_name = 'projects'
                );
            `);

            // Note: tableCheck.rows[0].exists will be true or false
            if (!tableCheck.rows[0]?.exists) {
                logger.info('[DatabaseManager] Projects table not found. Initializing schema...');

                // Determine schema path relative to the current file
                const __filename = fileURLToPath(import.meta.url);
                const __dirname = path.dirname(__filename);
                // Assuming schema.sql is still in the same relative location after build
                const schemaPath = path.join(__dirname, 'schema.sql');

                logger.info(`[DatabaseManager] Looking for schema file at: ${schemaPath}`);

                // Read the new PostgreSQL-compatible schema file
                const schemaSql = await fs.readFile(schemaPath, 'utf8');

                // Execute the schema SQL
                await client.query(schemaSql);
                logger.info('[DatabaseManager] Database schema initialized successfully.');

            } else {
                logger.info('[DatabaseManager] Database schema already initialized (projects table exists).');
            }
        } catch (error: any) { // Catch specific PG errors if needed
            logger.error('[DatabaseManager] Failed to initialize database schema:', {
                 error: error.message,
                 stack: error.stack,
                 code: (error as any).code // PG error code might be useful
                });
            // Re-throw or handle appropriately
            throw error;
        } finally {
            // VERY Important: Always release the client back to the pool
            if (client) {
                client.release();
                logger.info('[DatabaseManager] Released schema check client.');
            }
        }
    }

    // Method to get the pool instance for repositories
    public getPool(): Pool {
        if (!this.pool) {
            // Should not happen if constructor succeeded, but defensive check
            logger.error('[DatabaseManager] PostgreSQL pool not available.');
            throw new Error('Database connection pool not available.');
        }
        return this.pool;
    }

    // Close the pool gracefully on shutdown (async)
    public async closeDb(): Promise<void> {
        if (this.pool) {
            logger.info('[DatabaseManager] Closing PostgreSQL connection pool...');
            await this.pool.end(); // Closes all connections in the pool
            logger.info('[DatabaseManager] PostgreSQL connection pool closed.');
        }
    }
}