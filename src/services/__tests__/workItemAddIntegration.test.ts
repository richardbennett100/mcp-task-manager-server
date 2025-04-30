// src/services/__tests__/workItemAddIntegration.test.ts
import { setupTestEnvironment, cleanDatabase } from './integrationSetup.js';
import { AddWorkItemInput } from '../WorkItemServiceTypes.js';

describe('WorkItemService - Add Work Item Integration Tests', () => {
  let testEnvironment: Awaited<ReturnType<typeof setupTestEnvironment>>;

  beforeAll(async () => {
    testEnvironment = await setupTestEnvironment();
  });

  beforeEach(async () => {
    await cleanDatabase(testEnvironment.pool);
  });

  afterAll(async () => {
    if (testEnvironment.pool) {
      await testEnvironment.pool.end();
    }
  });

  describe('addWorkItem', () => {
    it('should add a root work item without dependencies', async () => {
      const input: AddWorkItemInput = {
        name: 'Root Project A', 
        description: 'Test root project', 
        priority: 'high',
      };
      const result = await testEnvironment.workItemService.addWorkItem(input);

      expect(result).toBeDefined(); 
      expect(result.work_item_id).toBeDefined(); 
      expect(result.name).toBe(input.name); 
      expect(result.is_active).toBe(true);

      const dbItem = await testEnvironment.workItemRepository.findById(result.work_item_id, { isActive: true });
      expect(dbItem).toEqual(result);

      const history = await testEnvironment.actionHistoryRepository.listRecentActions({ 
        work_item_id: result.work_item_id, 
        limit: 1 
      });
      expect(history).toHaveLength(1); 
      expect(history[0].action_type).toBe('ADD_WORK_ITEM');

      const steps = await testEnvironment.actionHistoryRepository.findUndoStepsByActionId(history[0].action_id);
      expect(steps).toHaveLength(1);
      expect(steps[0].step_type).toBe('DELETE');
      expect(steps[0].table_name).toBe('work_items');
      expect(steps[0].record_id).toBe(result.work_item_id);
    });

    it('should add a child work item with a parent', async () => {
      const parent = await testEnvironment.workItemService.addWorkItem({ name: 'Parent Project' });
      
      const childInput: AddWorkItemInput = {
        name: 'Child Task', 
        parent_work_item_id: parent.work_item_id, 
        status: 'in-progress',
      };
      const childResult = await testEnvironment.workItemService.addWorkItem(childInput);

      expect(childResult).toBeDefined(); 
      expect(childResult.parent_work_item_id).toBe(parent.work_item_id);

      const dbChild = await testEnvironment.workItemRepository.findById(childResult.work_item_id);
      expect(dbChild).toEqual(childResult);
    });

    it('should add a work item with dependencies', async () => {
      const depTarget = await testEnvironment.workItemService.addWorkItem({ name: 'Dependency Target' });
      
      const workItemInput: AddWorkItemInput = {
        name: 'Item with Dependency', 
        dependencies: [{ 
          depends_on_work_item_id: depTarget.work_item_id, 
          dependency_type: 'linked' 
        }],
      };
      const result = await testEnvironment.workItemService.addWorkItem(workItemInput);

      const dbDeps = await testEnvironment.workItemRepository.findDependencies(result.work_item_id);
      expect(dbDeps).toHaveLength(1); 
      expect(dbDeps[0].depends_on_work_item_id).toBe(depTarget.work_item_id);
    });

    it('should clear the redo stack when adding a new item', async () => {
      const item1 = await testEnvironment.workItemService.addWorkItem({ name: 'Item 1' });
      
      await testEnvironment.workItemService.undoLastAction();
      
      const item2 = await testEnvironment.workItemService.addWorkItem({ name: 'Item 2' });
      
      const allRecentActions = await testEnvironment.actionHistoryRepository.listRecentActions({ limit: 10 });
      const undoAction = allRecentActions.find(a => a.action_type === 'UNDO_ACTION');
      expect(undoAction).toBeDefined();

      const undoActionAfterAction2 = await testEnvironment.actionHistoryRepository.findActionById(undoAction!.action_id);
      expect(undoActionAfterAction2?.is_undone).toBe(true);
      expect(undoActionAfterAction2?.undone_at_action_id).toBe(
        (await testEnvironment.actionHistoryRepository.listRecentActions({ limit: 1 }))[0].action_id
      );
    });

    it('should validate parent work item is active', async () => {
      const parent = await testEnvironment.workItemService.addWorkItem({ name: 'Parent Project' });
      
      // Soft delete the parent
      await testEnvironment.workItemService.deleteWorkItem([parent.work_item_id]);

      // Try to add a child to deleted parent should throw
      await expect(
        testEnvironment.workItemService.addWorkItem({
          name: 'Child Task', 
          parent_work_item_id: parent.work_item_id, 
        })
      ).rejects.toThrow('Parent work item');
    });
  });
});