// src/services/__tests__/workItemUpdateIntegration.test.ts
import { setupTestEnvironment, cleanDatabase } from './integrationSetup.js';
import { WorkItemData } from '../../repositories/WorkItemRepository.js';
import { UpdateWorkItemInput } from '../WorkItemServiceTypes.js';

describe('WorkItemService - Update Work Item Integration Tests', () => {
  let testEnvironment: Awaited<ReturnType<typeof setupTestEnvironment>>;
  let itemToUpdate: WorkItemData;
  let parentItem: WorkItemData;

  beforeAll(async () => {
    testEnvironment = await setupTestEnvironment();
  });

  beforeEach(async () => {
    await cleanDatabase(testEnvironment.pool);
    
    // Create a parent item to use for parent-related tests
    parentItem = await testEnvironment.workItemService.addWorkItem({ 
      name: 'Parent Project', 
      description: 'Parent project for testing' 
    });

    // Setup a work item to update
    itemToUpdate = await testEnvironment.workItemService.addWorkItem({ 
      name: 'Update Me', 
      status: 'todo', 
      priority: 'medium' 
    });
  });

  afterAll(async () => {
    if (testEnvironment.pool) {
      await testEnvironment.pool.end();
    }
  });

  describe('Basic Updates', () => {
    it('should update item basic fields', async () => {
      const updates: UpdateWorkItemInput = { 
        name: 'Updated Name', 
        status: 'in-progress' 
      };
      
      const result = await testEnvironment.workItemService.updateWorkItem(
        itemToUpdate.work_item_id, 
        updates
      );

      expect(result.name).toBe(updates.name);
      expect(result.status).toBe(updates.status);

      const dbItem = await testEnvironment.workItemRepository.findById(itemToUpdate.work_item_id);
      expect(dbItem?.name).toBe(updates.name);
      expect(dbItem?.status).toBe(updates.status);
    });

    it('should update parent and recalculate related fields', async () => {
      const updates: UpdateWorkItemInput = { 
        parent_work_item_id: parentItem.work_item_id 
      };
      
      const result = await testEnvironment.workItemService.updateWorkItem(
        itemToUpdate.work_item_id, 
        updates
      );

      expect(result.parent_work_item_id).toBe(parentItem.work_item_id);
      
      const dbItem = await testEnvironment.workItemRepository.findById(itemToUpdate.work_item_id);
      expect(dbItem?.parent_work_item_id).toBe(parentItem.work_item_id);
    });
  });

  describe('Dependency Management', () => {
    it('should add, modify, and manage dependencies', async () => {
      // Create dependency targets
      const dep1 = await testEnvironment.workItemService.addWorkItem({ name: 'Dependency 1' });
      const dep2 = await testEnvironment.workItemService.addWorkItem({ name: 'Dependency 2' });

      // First, add an initial dependency
      await testEnvironment.workItemService.updateWorkItem(
        itemToUpdate.work_item_id, 
        {}, 
        [{ 
          depends_on_work_item_id: dep1.work_item_id,
          dependency_type: 'finish-to-start' 
        }]
      );

      // Then update to a new dependency
      const result = await testEnvironment.workItemService.updateWorkItem(
        itemToUpdate.work_item_id, 
        {}, 
        [{ 
          depends_on_work_item_id: dep2.work_item_id,
          dependency_type: 'linked' 
        }]
      );

      // Verify dependencies
      const dbDependencies = await testEnvironment.workItemRepository.findDependencies(
        itemToUpdate.work_item_id,
        { isActive: false }
      );

      const activeDeps = dbDependencies.filter(d => d.is_active);
      const inactiveDeps = dbDependencies.filter(d => !d.is_active);

      expect(activeDeps).toHaveLength(1);
      expect(activeDeps[0].depends_on_work_item_id).toBe(dep2.work_item_id);
      expect(activeDeps[0].dependency_type).toBe('linked');

      expect(inactiveDeps).toHaveLength(1);
      expect(inactiveDeps[0].depends_on_work_item_id).toBe(dep1.work_item_id);
    });
  });

  describe('Error Handling', () => {
    it('should handle updates to non-existent parent', async () => {
      const nonExistentParentId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

      await expect(
        testEnvironment.workItemService.updateWorkItem(
          itemToUpdate.work_item_id, 
          { parent_work_item_id: nonExistentParentId }
        )
      ).rejects.toThrow('not found');
    });

    it('should not create history for no-change updates', async () => {
      const originalItem = await testEnvironment.workItemService.getWorkItemById(itemToUpdate.work_item_id);
      
      const result = await testEnvironment.workItemService.updateWorkItem(
        itemToUpdate.work_item_id, 
        {} // No updates
      );

      // Verify no changes occurred
      expect(result).toEqual(originalItem);

      // Verify no history action was created
      const history = await testEnvironment.actionHistoryRepository.listRecentActions({ 
        work_item_id: itemToUpdate.work_item_id 
      });
      const updateActions = history.filter(h => h.action_type === 'UPDATE_WORK_ITEM');
      expect(updateActions.length).toBe(0);
    });
  });
});