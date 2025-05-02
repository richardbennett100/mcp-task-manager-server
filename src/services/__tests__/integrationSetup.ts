// src/services/__tests__/integrationSetup.ts
import { Pool, type PoolClient } from 'pg'; // Explicitly import PoolClient as a type
// Remove unused imports that are used by DatabaseManager internally: fs, path, fileURLToPath
import { DatabaseManager } from '../../db/DatabaseManager.js'; // Keep DatabaseManager
import { ConfigurationManager } from '../../config/ConfigurationManager.js'; // Keep ConfigurationManager
import { WorkItemRepository, ActionHistoryRepository } from '../../repositories/index.js'; // Keep repositories
import { WorkItemService } from '../WorkItemService.js'; // Keep service
import { logger } from '../../utils/logger.js'; // Keep logger

// Helper function to set up test environment
export async function setupTestEnvironment() {
  // Ensure correct test database is used
  process.env.PGDATABASE = process.env.PGDATABASE ?? 'taskmanager_db';

  // Initialize configuration
  ConfigurationManager.getInstance();

  // Initialize database
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
  const client: PoolClient = await pool.connect(); // Explicitly type 'client' using the imported type
  try {
    await client.query('BEGIN');
    // Ensure tables are dropped in the correct order due to FKs
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
    await client.query('ROLLBACK');
    logger.error('[integrationSetup] Database clean up rollback complete.');
    throw error;
  } finally {
    client.release();
    logger.debug('[integrationSetup] Database client released.');
  }
}
