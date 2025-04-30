// src/services/__tests__/workItemDeleteIntegration.test.ts
import { setupTestEnvironment, cleanDatabase } from './integrationSetup.js';
import { WorkItemData } from '../../repositories/WorkItemRepository.js';

describe('WorkItemService - Delete Work Item Integration Tests', () => {
  let testEnvironment: Awaited<ReturnType<typeof setupTestEnvironment>>;
  let parent: WorkItemData, 
      child1: WorkItemData, 
      child2: WorkItemData, 
      grandchild1: WorkItemData;

  beforeAll(async () => {
    testEnvironment = await setupTestEnvironment();
  });

  beforeEach(async () => {
    await cleanDatabase(testEnvironment.pool);
    
    // Simulate a work item hierarchy
    parent = await testEnvironment.workItemService.addWorkItem({ 
      name: 'Parent Project', 
      description: 'Top-level project to delete' 
    });

    child1 = await testEnvironment.workItemService.addWorkItem({ 
      name: 'Child Task 1', 
      parent_work_item_id: parent.work_item_id 
    });

    child2 = await testEnvironment.workItemService.addWorkItem({ 
      name: 'Child Task 2', 
      parent_work_item_id: parent.work_item_id 
    });

    grandchild1 = await testEnvironment.workItemService.addWorkItem({ 
      name: 'Grandchild Task 1', 
      parent_work_item_id: child1.work_item_id 
    });
  });

  afterAll(async () => {
    if (testEnvironment.pool) {
      await testEnvironment.pool.end();
    }
  });

describe('Soft Delete Operations', () => {
  it('should soft delete single work item', async () => {
    const initialCount = (await testEnvironment.workItemRepository.findAll({ isActive: true })).length;
    
    const deletedCount = await testEnvironment.workItemService.deleteWorkItem([child2.work_item_id]);
    expect(deletedCount).toBe(1);

    const dbItem = await testEnvironment.workItemRepository.findById(child2.work_item_id, { isActive: false });
    expect(dbItem?.is_active).toBe(false);

    const finalCount = (await testEnvironment.workItemRepository.findAll({ isActive: true })).length;
    expect(finalCount).toBe(initialCount - 1);

    const history = await testEnvironment.actionHistoryRepository.listRecentActions({ 
      work_item_id: child2.work_item_id 
    });
    const deleteAction = history.find(h => h.action_type === 'DELETE_WORK_ITEM_CASCADE');
    expect(deleteAction).toBeDefined();

    const steps = await testEnvironment.actionHistoryRepository.findUndoStepsByActionId(deleteAction!.action_id);
    expect(steps).toHaveLength(1);
    expect(steps[0].step_type).toBe('UPDATE');
    expect(steps[0].table_name).toBe('work_items');
  });

  it('should soft delete parent and all descendants recursively', async () => {
    const initialCount = (await testEnvironment.workItemRepository.findAll({ isActive: true })).length;
    
    const deletedCount = await testEnvironment.workItemService.deleteWorkItem([parent.work_item_id]);
    
    // Find all descendants including the parent
    const descendants = [
      parent.work_item_id, 
      child1.work_item_id, 
      child2.work_item_id, 
      grandchild1.work_item_id
    ];

    // Query each descendant to confirm soft delete
    for (const descendantId of descendants) {
      const descendant = await testEnvironment.workItemRepository.findById(descendantId, { isActive: false });
      expect(descendant?.is_active).toBe(false);
    }

    // Verify count reduction
    const finalCount = (await testEnvironment.workItemRepository.findAll({ isActive: true })).length;
    expect(finalCount).toBe(initialCount - descendants.length);

    // Verify action history
    const history = await testEnvironment.actionHistoryRepository.listRecentActions({ 
      work_item_id: parent.work_item_id 
    });
    const deleteAction = history.find(h => h.action_type === 'DELETE_WORK_ITEM_CASCADE');
    expect(deleteAction).toBeDefined();
    expect(deleteAction?.description).toContain(`${descendants.length} work item(s)`);

    // Verify undo steps
    const steps = await testEnvironment.actionHistoryRepository.findUndoStepsByActionId(deleteAction!.action_id);
    expect(steps).toHaveLength(descendants.length);
    expect(steps.every(s => s.step_type === 'UPDATE' && s.table_name === 'work_items')).toBe(true);
  });

  it('should clear the redo stack when deleting items', async () => {
    // Delete an item
    await testEnvironment.workItemService.deleteWorkItem([child1.work_item_id]);
    
    // Undo the delete
    await testEnvironment.workItemService.undoLastAction();
    
    // Find the undo action
    const allRecentActionsUndo = await testEnvironment.actionHistoryRepository.listRecentActions({ limit: 10 });
    const undoAction = allRecentActionsUndo.find(a => a.action_type === 'UNDO_ACTION');
    expect(undoAction).toBeDefined();

    // Delete another item, which should clear the redo stack
    await testEnvironment.workItemService.deleteWorkItem([child2.work_item_id]);
    
    // Verify the previous undo action is now marked as redone
    const undoActionAfterAction2 = await testEnvironment.actionHistoryRepository.findActionById(undoAction!.action_id);
    expect(undoActionAfterAction2?.is_undone).toBe(true);
    expect(undoActionAfterAction2?.undone_at_action_id).toBe(
      (await testEnvironment.actionHistoryRepository.listRecentActions({ limit: 1 }))[0].action_id
    );
  });
});
});