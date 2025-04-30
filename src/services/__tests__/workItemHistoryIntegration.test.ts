// src/services/__tests__/workItemHistoryIntegration.test.ts
import { setupTestEnvironment, cleanDatabase } from './integrationSetup.js';
import { WorkItemData } from '../../repositories/WorkItemRepository.js';
import { ActionHistoryData } from '../../repositories/ActionHistoryRepository.js';

describe('WorkItemService - History Operations Integration Tests', () => {
  let testEnvironment: Awaited<ReturnType<typeof setupTestEnvironment>>;
  let item1: WorkItemData, item2: WorkItemData;
  let action1: ActionHistoryData, 
      action2: ActionHistoryData, 
      action3: ActionHistoryData, 
      action4: ActionHistoryData;

  beforeAll(async () => {
    testEnvironment = await setupTestEnvironment();
  });

  beforeEach(async () => {
    await cleanDatabase(testEnvironment.pool);

    // Create sequence of actions for testing undo/redo
    item1 = await testEnvironment.workItemService.addWorkItem({ name: 'Item 1' });
    action1 = (await testEnvironment.actionHistoryRepository.listRecentActions({ limit: 1 }))[0];
    
    item2 = await testEnvironment.workItemService.addWorkItem({ name: 'Item 2' });
    action2 = (await testEnvironment.actionHistoryRepository.listRecentActions({ limit: 1 }))[0];
    
    await testEnvironment.workItemService.updateWorkItem(
      item1.work_item_id, 
      { name: 'Item 1 Updated' }
    );
    action3 = (await testEnvironment.actionHistoryRepository.listRecentActions({ limit: 1 }))[0];
    
    // Delete Item 2
    await testEnvironment.workItemService.deleteWorkItem([item2.work_item_id]);
    action4 = (await testEnvironment.actionHistoryRepository.listRecentActions({ limit: 1 }))[0];
  });

  afterAll(async () => {
    if (testEnvironment.pool) {
      await testEnvironment.pool.end();
    }
  });

  describe('Undo Operations', () => {
    it('should undo last action (delete item 2)', async () => {
      const undoneAction = await testEnvironment.workItemService.undoLastAction();
      
      expect(undoneAction).toBeDefined();
      expect(undoneAction?.action_id).toBe(action4.action_id);

      const currentItem2 = await testEnvironment.workItemRepository.findById(
        item2.work_item_id, 
        { isActive: false }
      );
      expect(currentItem2?.is_active).toBe(true);

      const originalActionAfterUndo = await testEnvironment.actionHistoryRepository.findActionById(action4.action_id);
      const undoActionRecord = (await testEnvironment.actionHistoryRepository.listRecentActions({ limit: 1 }))[0];
      
      expect(originalActionAfterUndo?.is_undone).toBe(true);
      expect(undoActionRecord.action_type).toBe('UNDO_ACTION');
    });

    it('should undo multiple actions sequentially', async () => {
      // Undo delete
      await testEnvironment.workItemService.undoLastAction();
      
      // Undo update
      const undoneAction = await testEnvironment.workItemService.undoLastAction();
      
      expect(undoneAction).toBeDefined();
      expect(undoneAction?.action_id).toBe(action3.action_id);

      const currentItem1 = await testEnvironment.workItemRepository.findById(item1.work_item_id, {isActive: false});
      const currentItem2 = await testEnvironment.workItemRepository.findById(item2.work_item_id, {isActive: false});
      
      expect(currentItem1?.name).toBe('Item 1');
      expect(currentItem2?.is_active).toBe(true);

      const action3AfterUndo = await testEnvironment.actionHistoryRepository.findActionById(action3.action_id);
      const lastAction = (await testEnvironment.actionHistoryRepository.listRecentActions({ limit: 1 }))[0];
      
      expect(action3AfterUndo?.is_undone).toBe(true);
      expect(lastAction.action_type).toBe('UNDO_ACTION');
    });
  });

  describe('Redo Operations', () => {
    it('should redo the last undone action', async () => {
      // Undo both actions
      await testEnvironment.workItemService.undoLastAction(); // Undo update
      await testEnvironment.workItemService.undoLastAction(); // Undo delete

      // Redo update
      const redoneUpdateAction = await testEnvironment.workItemService.redoLastUndo();
      expect(redoneUpdateAction).toBeDefined();
      expect(redoneUpdateAction?.action_id).toBe(action3.action_id);

      const currentItem1AfterRedo = await testEnvironment.workItemRepository.findById(item1.work_item_id, {isActive: false});
      expect(currentItem1AfterRedo?.name).toBe('Item 1 Updated');

      // Redo delete
      const redoneDeleteAction = await testEnvironment.workItemService.redoLastUndo();
      expect(redoneDeleteAction).toBeDefined();
      expect(redoneDeleteAction?.action_id).toBe(action4.action_id);

      const currentItem2AfterRedo = await testEnvironment.workItemRepository.findById(item2.work_item_id, {isActive: false});
      expect(currentItem2AfterRedo?.is_active).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should return null if no action to undo', async () => {
      // Undo all actions
      await testEnvironment.workItemService.undoLastAction(); // Delete
      await testEnvironment.workItemService.undoLastAction(); // Update
      await testEnvironment.workItemService.undoLastAction(); // Add item 2
      await testEnvironment.workItemService.undoLastAction(); // Add item 1

      const result = await testEnvironment.workItemService.undoLastAction();
      expect(result).toBeNull();
    });

    it('should return null if no action to redo', async () => {
      const result = await testEnvironment.workItemService.redoLastUndo();
      expect(result).toBeNull();

      // Do an undo and then redo everything
      await testEnvironment.workItemService.undoLastAction();
      await testEnvironment.workItemService.redoLastUndo();

      const finalResult = await testEnvironment.workItemService.redoLastUndo();
      expect(finalResult).toBeNull();
    });
  });
});