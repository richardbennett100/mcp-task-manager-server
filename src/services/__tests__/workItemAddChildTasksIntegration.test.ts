// src/services/__tests__/workItemAddChildTasksIntegration.test.ts
import { WorkItemService } from '../WorkItemService.js';
import { DatabaseManager } from '../../db/DatabaseManager.js';
import { WorkItemData } from '../../repositories/index.js'; // Correct import for WorkItemData
import { setupTestEnvironment, cleanDatabase } from './integrationSetup.js';
import {
  AddWorkItemInput,
  // WorkItemStatus and WorkItemPriority enums/types are defined in WorkItemServiceTypes
  // but we will rely on string literals matching those definitions for AddWorkItemInput
} from '../WorkItemServiceTypes.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';

describe('WorkItemService - Add Child Tasks Integration Tests', () => {
  let workItemService: WorkItemService;
  let dbManager: DatabaseManager;
  let pool: any;

  beforeAll(async () => {
    const setup = await setupTestEnvironment();
    pool = setup.pool;
    workItemService = setup.workItemService;
    dbManager = await DatabaseManager.getInstance();
  });

  beforeEach(async () => {
    await cleanDatabase(pool);
  });

  afterAll(async () => {
    if (dbManager) {
      await dbManager.closeDb(); // Corrected method name
    }
  });

  test('should add multiple child tasks under a parent project', async () => {
    const parentProjectInput: AddWorkItemInput = { name: 'Parent Project for Children Test' };
    const parentProject = await workItemService.addWorkItem(parentProjectInput);
    expect(parentProject?.work_item_id).toBeDefined();
    if (!parentProject?.work_item_id) throw new Error('Parent project creation failed');

    // Status and priority literals should align with WorkItemServiceTypes.ts definitions
    // (e.g., 'in-progress', not 'inprogress'; 'low', 'medium', 'high')
    const childTasksToCreate = [
      { name: 'Child Task 1', description: 'First child task for bulk add', status: 'todo', priority: 'medium' },
      { name: 'Child Task 2', description: 'Second child task for bulk add', status: 'in-progress', priority: 'high' },
    ];

    const createdChildren: WorkItemData[] = [];
    for (const childData of childTasksToCreate) {
      const childInput: AddWorkItemInput = {
        parent_work_item_id: parentProject.work_item_id,
        name: childData.name,
        description: childData.description,
        status: childData.status as 'todo' | 'in-progress' | 'review' | 'done', // Cast to expected string literal union
        priority: childData.priority as 'low' | 'medium' | 'high', // Cast to expected string literal union
      };
      const createdChild = await workItemService.addWorkItem(childInput);
      if (createdChild) {
        createdChildren.push(createdChild);
      }
    }

    expect(createdChildren.length).toBe(2);

    // listWorkItems returns WorkItemData[] directly
    const childrenInDb = await workItemService.listWorkItems({ parent_work_item_id: parentProject.work_item_id });
    expect(childrenInDb.length).toBe(2);

    const child1InDb = childrenInDb.find((c: WorkItemData) => c.name === 'Child Task 1');
    expect(child1InDb).toBeDefined();
    expect(child1InDb?.description).toBe('First child task for bulk add');
    expect(child1InDb?.parent_work_item_id).toBe(parentProject.work_item_id);
    expect(child1InDb?.status).toBe('todo');

    const child2InDb = childrenInDb.find((c: WorkItemData) => c.name === 'Child Task 2');
    expect(child2InDb).toBeDefined();
    expect(child2InDb?.status).toBe('in-progress');
    expect(child2InDb?.priority).toBe('high');
    expect(child2InDb?.parent_work_item_id).toBe(parentProject.work_item_id);

    // Use the new public listHistory method on WorkItemService
    const parentHistory = await workItemService.listHistory({ work_item_id: parentProject.work_item_id, limit: 1 });
    expect(parentHistory.length).toBeGreaterThanOrEqual(1);

    if (child1InDb?.work_item_id) {
      const child1History = await workItemService.listHistory({ work_item_id: child1InDb.work_item_id, limit: 1 });
      expect(child1History.length).toBe(1);
      expect(child1History[0].action_type).toBe('ADD_WORK_ITEM');
    } else {
      fail('Child 1 not found in DB for history check');
    }

    if (child2InDb?.work_item_id) {
      const child2History = await workItemService.listHistory({ work_item_id: child2InDb.work_item_id, limit: 1 });
      expect(child2History.length).toBe(1);
      expect(child2History[0].action_type).toBe('ADD_WORK_ITEM');
    } else {
      fail('Child 2 not found in DB for history check');
    }
  });

  test('add_child_tasks: should fail with ValidationError if parent_work_item_id is an invalid UUID format', async () => {
    const invalidUuidParentId = 'not-a-uuid';
    const childTaskData = { name: 'Orphan Child Invalid Parent UUID' };

    try {
      const childInput: AddWorkItemInput = {
        parent_work_item_id: invalidUuidParentId,
        name: childTaskData.name,
      };
      // The service's addWorkItem internally calls addingService.addWorkItem, which validates UUID format
      await workItemService.addWorkItem(childInput);
      fail('Should have thrown ValidationError for invalid parent UUID format');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as Error).message).toContain(`Invalid parent_work_item_id format: ${invalidUuidParentId}`);
    }
  });

  test('add_child_tasks: should fail with NotFoundError if parent_work_item_id is valid format but does not exist', async () => {
    const nonExistentButValidUuidParentId = '123e4567-e89b-12d3-a456-426614174000'; // valid format, but non-existent
    const childTaskData = { name: 'Almost Orphan Child' };

    try {
      const childInput: AddWorkItemInput = {
        parent_work_item_id: nonExistentButValidUuidParentId,
        name: childTaskData.name,
      };
      await workItemService.addWorkItem(childInput);
      fail('Should have thrown NotFoundError for non-existent parent');
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as Error).message).toContain(
        `Parent work item with ID ${nonExistentButValidUuidParentId} not found`
      );
    }
  });
});
