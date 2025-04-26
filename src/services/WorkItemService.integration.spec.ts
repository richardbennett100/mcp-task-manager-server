// src/services/WorkItemService.integration.spec.ts
import { Pool } from 'pg';
import { DatabaseManager } from '../db/DatabaseManager.js';
import {
  WorkItemRepository,
  WorkItemData,
} from '../repositories/WorkItemRepository.js';
import {
  WorkItemService,
  AddWorkItemInput,
  FullWorkItemData,
} from './WorkItemService.js';
import { v4 as uuidv4, validate as uuidValidate } from 'uuid';

describe('WorkItemService Integration Tests', () => {
  let dbManager: DatabaseManager | undefined;
  let pool: Pool;
  let workItemRepository: WorkItemRepository;
  let workItemService: WorkItemService;

  beforeAll(async () => {
    try {
      dbManager = await DatabaseManager.getInstance();
      pool = dbManager.getPool();
    } catch (error) {
        console.error("FATAL: Failed to get DatabaseManager instance in beforeAll:", error);
        throw error;
    }
  });

  afterAll(async () => {
    if (dbManager) {
      await dbManager.closeDb();
    }
  });

  it('should add a new root work item to the database', async () => {
    if (!pool) throw new Error("Database pool not initialized for test");

    workItemRepository = new WorkItemRepository(pool);
    workItemService = new WorkItemService(workItemRepository);

    const input: AddWorkItemInput = {
      name: 'Integration Test Project',
      parent_work_item_id: null,
      description: 'Verify addWorkItem integration',
      priority: 'medium', // Let's use default to simplify test
      status: 'todo',
    };

    let createdWorkItemId: string | null = null;

    await pool.query('BEGIN');
    try {
      // --- 1. Act ---
      const result = await workItemService.addWorkItem(input);
      createdWorkItemId = result.work_item_id;

      // --- 2. Assert Service Response ---
      expect(result).toBeDefined();
      expect(uuidValidate(result.work_item_id)).toBe(true);
      expect(result.name).toBe(input.name);
      // ... check other fields if needed ...
      expect(result.shortname).toBe('IN'); // Check placeholder

      // --- 3. Assert Database State ---
      if (!createdWorkItemId) throw new Error("Created Work Item ID is null!"); // Sanity check

      const dbResult = await pool.query(
        'SELECT * FROM work_items WHERE work_item_id = $1',
        [createdWorkItemId]
      );

      // --- ADDED CHECKS ---
      console.log(`DEBUG Integration Test: DB Query Result for ${createdWorkItemId}:`, JSON.stringify(dbResult.rows, null, 2));
      expect(dbResult.rows.length).toBe(1); // Verify exactly one row was found
      expect(dbResult.rows[0]).toBeDefined(); // Verify the row object exists
      expect(dbResult.rows[0].work_item_id).toBeDefined(); // Verify the ID property exists on the raw row
      expect(dbResult.rows[0].work_item_id).toEqual(createdWorkItemId); // Verify ID matches before mapping
      // --- END ADDED CHECKS ---

      const dbRow = mapDbRowToWorkItemData(dbResult.rows[0]);

      // This assertion should now pass if the checks above pass
      expect(dbRow.work_item_id).toBe(createdWorkItemId);
      expect(dbRow.name).toBe(input.name);
      expect(dbRow.parent_work_item_id).toBeNull();
      expect(dbRow.description).toBe(input.description);
      expect(dbRow.priority).toBe(input.priority);
      expect(dbRow.status).toBe(input.status);
      expect(dbRow.shortname).toBe('IN'); // Check value stored in DB matches expectation
      expect(dbRow.order_key).toBeNull();
      expect(dbRow.created_at).toBe(result.created_at);
      expect(dbRow.updated_at).toBe(result.updated_at);

    } catch (error) {
      throw error;
    } finally {
      await pool.query('ROLLBACK');
    }
  });

   // Add more integration tests...

});

// Helper function (ensure it matches repository version if types differ)
function mapDbRowToWorkItemData(row: any): WorkItemData {
  return {
    work_item_id: row.work_item_id,
    parent_work_item_id: row.parent_work_item_id,
    name: row.name,
    shortname: row.shortname,
    description: row.description,
    status: row.status,
    priority: row.priority,
    order_key: row.order_key,
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
    updated_at:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : row.updated_at,
    due_date:
      row.due_date === null
        ? null
        : row.due_date instanceof Date
          ? row.due_date.toISOString()
          : row.due_date,
  };
}