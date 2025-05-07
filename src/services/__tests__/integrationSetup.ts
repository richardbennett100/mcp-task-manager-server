// src/services/__tests__/integrationSetup.ts
import { Pool, type PoolClient } from 'pg';
import net from 'node:net'; // Import the 'net' module for TCP checks
import { DatabaseManager } from '../../db/DatabaseManager.js';
import { ConfigurationManager } from '../../config/ConfigurationManager.js';
import { WorkItemRepository, ActionHistoryRepository } from '../../repositories/index.js';
import { WorkItemService } from '../WorkItemService.js';
import { logger } from '../../utils/logger.js';

const DB_CHECK_RETRY_DELAY_MS = 500; // Wait 500ms between checks
const DB_CHECK_MAX_RETRIES = 10; // Retry up to 10 times (total 5 seconds)

// --- New Helper Function: Check DB Port Availability ---
async function checkDatabaseConnection(host: string, port: number): Promise<void> {
  logger.info(`[integrationSetup] Checking database availability at ${host}:${port}...`);
  for (let i = 0; i < DB_CHECK_MAX_RETRIES; i++) {
    try {
      // Attempt to establish a basic TCP connection
      await new Promise<void>((resolve, reject) => {
        const socket = net.createConnection({ host, port }, () => {
          logger.info(`[integrationSetup] Database port ${port} is open on attempt ${i + 1}. Proceeding...`);
          socket.end(); // Close the socket immediately after connection
          resolve(); // Signal success
        });
        // Set a short timeout for the connection attempt itself
        socket.setTimeout(DB_CHECK_RETRY_DELAY_MS);
        socket.on('timeout', () => {
          socket.destroy();
          reject(new Error(`Connection attempt timed out after ${DB_CHECK_RETRY_DELAY_MS}ms`));
        });
        // Handle errors during connection attempt
        socket.on('error', (err) => {
          // For ECONNREFUSED or timeout, we want to retry (reject to signal retry)
          if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
            reject(err);
          } else {
            // For other errors, reject immediately
            logger.warn(`[integrationSetup] Non-ECONNREFUSED error during check: ${err.message}`);
            reject(err);
          }
        });
      });
      return; // If the promise resolved, connection was successful, exit the function
    } catch (error: any) {
      // Log ECONNREFUSED or timeout and prepare for retry
      if (error.code === 'ECONNREFUSED' || error.message.includes('timed out')) {
        if (i < DB_CHECK_MAX_RETRIES - 1) {
          logger.warn(
            `[integrationSetup] Attempt ${i + 1}/${DB_CHECK_MAX_RETRIES}: Database not yet available (${error.code || 'Timeout'}). Retrying in ${DB_CHECK_RETRY_DELAY_MS}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, DB_CHECK_RETRY_DELAY_MS)); // Wait before retrying
        } else {
          // Max retries reached
          logger.error(`[integrationSetup] Database connection failed after ${DB_CHECK_MAX_RETRIES} attempts.`);
          throw new Error(
            `Database connection failed at ${host}:${port} after ${DB_CHECK_MAX_RETRIES} attempts: ${error.message}`
          );
        }
      } else {
        // Rethrow unexpected errors
        logger.error('[integrationSetup] Unexpected error during database connection check:', error);
        throw error;
      }
    }
  }
}
// --- End Helper Function ---

// Helper function to set up test environment
export async function setupTestEnvironment() {
  // Ensure correct test database is used
  process.env.PGDATABASE = process.env.PGDATABASE ?? 'taskmanager_db';

  // Initialize configuration
  const configManager = ConfigurationManager.getInstance();
  const dbHost = configManager.getPgHost();
  const dbPort = configManager.getPgPort();

  // --- Check connection availability before initializing DatabaseManager ---
  logger.debug(`[integrationSetup] Running pre-connection check for ${dbHost}:${dbPort}...`);
  await checkDatabaseConnection(dbHost, dbPort);
  logger.debug(`[integrationSetup] Pre-connection check passed for ${dbHost}:${dbPort}.`);
  // --- End Check ---

  // Initialize database (NOW should be more likely to succeed immediately)
  const dbManager = await DatabaseManager.getInstance();
  const pool = dbManager.getPool();

  // Create repositories and service
  const workItemRepository = new WorkItemRepository(pool);
  const actionHistoryRepository = new ActionHistoryRepository(pool);
  const workItemService = new WorkItemService(workItemRepository, actionHistoryRepository);

  return {
    pool,
    workItemRepository,
    actionHistoryRepository,
    workItemService,
  };
}

// Helper to clean database before each test
export async function cleanDatabase(pool: Pool) {
  logger.debug('[integrationSetup] Starting database clean up...');
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    logger.debug('[integrationSetup] Acquired client for cleanup.');
    await client.query('BEGIN');
    // Truncate tables... (ensure correct order)
    logger.debug('[integrationSetup] Truncating undo_steps CASCADE...');
    await client.query('TRUNCATE TABLE undo_steps CASCADE');
    logger.debug('[integrationSetup] Truncating action_history CASCADE...');
    await client.query('TRUNCATE TABLE action_history CASCADE');
    logger.debug('[integrationSetup] Truncating work_item_dependencies CASCADE...');
    await client.query('TRUNCATE TABLE work_item_dependencies CASCADE');
    logger.debug('[integrationSetup] Truncating work_items CASCADE...');
    await client.query('TRUNCATE TABLE work_items CASCADE');
    await client.query('COMMIT');
    logger.debug('[integrationSetup] Database clean up committed.');
  } catch (error) {
    logger.error('[integrationSetup] Error during database clean up, attempting rollback:', error);
    if (client) {
      try {
        await client.query('ROLLBACK');
        logger.error('[integrationSetup] Database clean up rollback complete.');
      } catch (rollbackError) {
        logger.error('[integrationSetup] Error during rollback attempt:', rollbackError);
      }
    } else {
      logger.error('[integrationSetup] Could not acquire client for cleanup/rollback.');
    }
    throw error;
  } finally {
    if (client) {
      client.release();
      logger.debug('[integrationSetup] Database client released.');
    }
  }
}
