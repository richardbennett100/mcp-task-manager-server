// src/services/__tests__/integrationSetup.ts
import { Pool } from 'pg';
import { DatabaseManager } from '../../db/DatabaseManager.js';
import { ConfigurationManager } from '../../config/ConfigurationManager.js';
import {
  WorkItemRepository,
  ActionHistoryRepository,
} from '../../repositories/index.js';
import { WorkItemService } from '../WorkItemService.js';
import { logger } from '../../utils/logger.js';

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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Ensure tables are dropped in the correct order due to FKs
    await client.query('TRUNCATE TABLE undo_steps CASCADE');
    await client.query('TRUNCATE TABLE action_history CASCADE');
    await client.query('TRUNCATE TABLE work_item_dependencies CASCADE');
    await client.query('TRUNCATE TABLE work_items CASCADE');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error cleaning database:', error);
    throw error;
  } finally {
    client.release();
  }
}