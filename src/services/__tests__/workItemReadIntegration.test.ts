// src/services/__tests__/workItemReadIntegration.test.ts
import { setupTestEnvironment, cleanDatabase } from './integrationSetup.js';
// Corrected imports: Use index.js
import { WorkItemData } from '../../repositories/index.js';
import { FullWorkItemData, ListWorkItemsFilter } from '../WorkItemServiceTypes.js'; // Assuming this path is correct

describe('WorkItemService - List and Read Operations Integration Tests', () => {
  let testEnvironment: Awaited<ReturnType<typeof setupTestEnvironment>>;
  let rootProject1: WorkItemData, rootProject2: WorkItemData, childTask1: WorkItemData, childTask2: WorkItemData;

  beforeAll(async () => {
    testEnvironment = await setupTestEnvironment();
  });

  beforeEach(async () => {
    await cleanDatabase(testEnvironment.pool);

    // Setup a hierarchy of work items with different statuses
    rootProject1 = await testEnvironment.workItemService.addWorkItem({
      // Defaults to todo
      name: 'Root Project 1',
      priority: 'high',
    });

    rootProject2 = await testEnvironment.workItemService.addWorkItem({
      // Defaults to todo
      name: 'Root Project 2',
      priority: 'low',
    });

    childTask1 = await testEnvironment.workItemService.addWorkItem({
      name: 'Child Task 1 (In Progress)',
      parent_work_item_id: rootProject1.work_item_id,
      status: 'in-progress', // Explicitly set
      priority: 'medium',
    });

    childTask2 = await testEnvironment.workItemService.addWorkItem({
      name: 'Child Task 2 (Todo)', // Explicitly set
      parent_work_item_id: rootProject1.work_item_id,
      status: 'todo',
      priority: 'high',
    });
    // Total: root1(todo), root2(todo), child1(in-progress), child2(todo) -> 3 todo items
  });

  afterAll(async () => {
    if (testEnvironment.pool) {
      await testEnvironment.pool.end();
    }
  });

  describe('getWorkItemById', () => {
    // ... other tests ...
    it('should retrieve a work item with full details', async () => {
      const depTarget = await testEnvironment.workItemService.addWorkItem({
        name: 'Dependency Target',
      });

      // Add a dependency to child task 1
      await testEnvironment.workItemService.updateWorkItem(childTask1.work_item_id, {}, [
        { depends_on_work_item_id: depTarget.work_item_id },
      ]);

      const retrievedItem: FullWorkItemData | null = await testEnvironment.workItemService.getWorkItemById(
        childTask1.work_item_id
      );

      // Assert non-null before accessing properties
      expect(retrievedItem).toBeDefined();
      expect(retrievedItem).not.toBeNull();

      // Access properties directly after non-null assertion
      expect(retrievedItem!.work_item_id).toBe(childTask1.work_item_id);
      expect(retrievedItem!.parent_work_item_id).toBe(rootProject1.work_item_id);

      // Check dependencies (already checked retrievedItem is not null)
      expect(retrievedItem!.dependencies).toHaveLength(1);
      expect(retrievedItem!.dependencies[0].depends_on_work_item_id).toBe(depTarget.work_item_id);
    });

    it('should return null for non-existent work item', async () => {
      const nonExistentId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
      const result = await testEnvironment.workItemService.getWorkItemById(nonExistentId);

      expect(result).toBeNull();
    });
  });

  describe('listWorkItems', () => {
    // ... other tests ...

    it('should filter work items by status', async () => {
      const listFilter: ListWorkItemsFilter = { status: 'todo' };
      const todoItems = await testEnvironment.workItemService.listWorkItems(listFilter);

      // FIX: Expect 3 items with status 'todo' based on beforeEach setup
      expect(todoItems.length).toBe(3);
      // Check if childTask2 is among them (order isn't guaranteed)
      expect(todoItems.map((i) => i.work_item_id)).toContain(childTask2.work_item_id);
      expect(todoItems.map((i) => i.work_item_id)).toContain(rootProject1.work_item_id);
      expect(todoItems.map((i) => i.work_item_id)).toContain(rootProject2.work_item_id);

      const inProgressItems = await testEnvironment.workItemService.listWorkItems({
        status: 'in-progress',
      });

      expect(inProgressItems.length).toBe(1);
      expect(inProgressItems[0].work_item_id).toBe(childTask1.work_item_id);
    });

    // ... other tests ...
  });
});
