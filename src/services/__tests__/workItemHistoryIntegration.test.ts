// src/services/__tests__/workItemHistoryIntegration.test.ts
import { setupTestEnvironment, cleanDatabase } from './integrationSetup.js';
// Corrected imports: Use index.js
import { WorkItemData, ActionHistoryData } from '../../repositories/index.js';
import { logger } from '../../utils/logger.js'; // Import the logger

describe('WorkItemService - History Operations Integration Tests', () => {
  let testEnvironment: Awaited<ReturnType<typeof setupTestEnvironment>>;
  let item1: WorkItemData, item2: WorkItemData;
  let action1_add: ActionHistoryData,
    action2_add: ActionHistoryData,
    action3_update: ActionHistoryData,
    action4_delete: ActionHistoryData;

  beforeAll(async () => {
    testEnvironment = await setupTestEnvironment();
  });

  beforeEach(async () => {
    await cleanDatabase(testEnvironment.pool);

    // Create sequence of actions for testing undo/redo
    item1 = await testEnvironment.workItemService.addWorkItem({ name: 'Item 1' });
    action1_add = (
      await testEnvironment.actionHistoryRepository.listRecentActions({ work_item_id: item1.work_item_id, limit: 1 })
    )[0];

    item2 = await testEnvironment.workItemService.addWorkItem({ name: 'Item 2' });
    action2_add = (
      await testEnvironment.actionHistoryRepository.listRecentActions({ work_item_id: item2.work_item_id, limit: 1 })
    )[0];

    await testEnvironment.workItemService.updateWorkItem(item1.work_item_id, { name: 'Item 1 Updated' });
    action3_update = (
      await testEnvironment.actionHistoryRepository.listRecentActions({ work_item_id: item1.work_item_id, limit: 1 })
    )[0];

    // Delete Item 2
    await testEnvironment.workItemService.deleteWorkItem([item2.work_item_id]);
    action4_delete = (
      await testEnvironment.actionHistoryRepository.listRecentActions({ work_item_id: item2.work_item_id, limit: 1 })
    )[0];

    // Sanity checks
    expect(action1_add?.action_type).toBe('ADD_WORK_ITEM');
    expect(action2_add?.action_type).toBe('ADD_WORK_ITEM');
    expect(action3_update?.action_type).toBe('UPDATE_WORK_ITEM');
    expect(action4_delete?.action_type).toBe('DELETE_WORK_ITEM_CASCADE');

    logger.debug('BeforeEach setup complete. Initial items: item1', item1, 'item2', item2);
    logger.debug(
      'Initial actions: action1',
      action1_add,
      'action2',
      action2_add,
      'action3',
      action3_update,
      'action4',
      action4_delete
    );
  });

  afterAll(async () => {
    if (testEnvironment.pool) {
      await testEnvironment.pool.end();
    }
  });

  describe('Undo Operations', () => {
    it('should undo last action (delete item 2)', async () => {
      logger.debug('Test: should undo last action (delete item 2) - Starting');
      const undoneAction = await testEnvironment.workItemService.undoLastAction();
      logger.debug('Test: should undo last action (delete item 2) - undoLastAction result:', undoneAction);

      expect(undoneAction).toBeDefined();
      expect(undoneAction?.action_id).toBe(action4_delete.action_id);
      expect(undoneAction?.is_undone).toBe(true);

      logger.debug('Test: should undo last action (delete item 2) - Fetching item 2 after undo');
      const currentItem2 = await testEnvironment.workItemRepository.findById(item2.work_item_id, { isActive: true });
      logger.debug('Test: should undo last action (delete item 2) - Fetched item 2 after undo:', currentItem2);

      expect(currentItem2).toBeDefined();
      expect(currentItem2?.is_active).toBe(true);

      logger.debug('Test: should undo last action (delete item 2) - Fetching item 1 after undo');
      const currentItem1 = await testEnvironment.workItemRepository.findById(item1.work_item_id, { isActive: true });
      logger.debug('Test: should undo last action (delete item 2) - Fetched item 1 after undo:', currentItem1);

      // This is one of the failing assertions
      expect(currentItem1?.name).toBe('Item 1 Updated');

      const originalActionAfterUndo = await testEnvironment.actionHistoryRepository.findActionById(
        action4_delete.action_id
      );
      expect(originalActionAfterUndo?.is_undone).toBe(true);

      const undoActionRecord = (await testEnvironment.actionHistoryRepository.listRecentActions({ limit: 1 }))[0];
      expect(undoActionRecord.action_type).toBe('UNDO_ACTION');
      expect(originalActionAfterUndo?.undone_at_action_id).toBe(undoActionRecord.action_id);
      logger.debug('Test: should undo last action (delete item 2) - Finished');
    });

    it('should undo multiple actions sequentially', async () => {
      logger.debug('Test: should undo multiple actions sequentially - Starting');
      const undoneDelete = await testEnvironment.workItemService.undoLastAction(); // Undoes delete (action 4)
      logger.debug('Test: should undo multiple actions sequentially - 1st undo (delete) result:', undoneDelete);
      expect(undoneDelete?.action_id).toBe(action4_delete.action_id);
      expect(undoneDelete?.is_undone).toBe(true);

      logger.debug('Test: should undo multiple actions sequentially - Performing 2nd undo (update)');
      const undoneUpdate = await testEnvironment.workItemService.undoLastAction(); // Undoes update (action 3)
      logger.debug('Test: should undo multiple actions sequentially - 2nd undo (update) result:', undoneUpdate);
      expect(undoneUpdate).toBeDefined();
      expect(undoneUpdate?.action_id).toBe(action3_update.action_id);
      expect(undoneUpdate?.is_undone).toBe(true);

      logger.debug('Test: should undo multiple actions sequentially - Fetching items after 2nd undo');
      const currentItem1 = await testEnvironment.workItemRepository.findById(item1.work_item_id, { isActive: true });
      const currentItem2 = await testEnvironment.workItemRepository.findById(item2.work_item_id, { isActive: true });
      logger.debug('Test: should undo multiple actions sequentially - Fetched item 1 after 2nd undo:', currentItem1);
      logger.debug('Test: should undo multiple actions sequentially - Fetched item 2 after 2nd undo:', currentItem2);

      expect(currentItem1?.name).toBe('Item 1');
      expect(currentItem2?.is_active).toBe(true);

      const action3AfterUndo = await testEnvironment.actionHistoryRepository.findActionById(action3_update.action_id);
      expect(action3AfterUndo?.is_undone).toBe(true);

      const lastAction = (await testEnvironment.actionHistoryRepository.listRecentActions({ limit: 1 }))[0];
      expect(lastAction.action_type).toBe('UNDO_ACTION');
      expect(action3AfterUndo?.undone_at_action_id).toBe(lastAction.action_id);
      logger.debug('Test: should undo multiple actions sequentially - Finished');
    });

    it('should return null if no action to undo', async () => {
      logger.debug('Test: should return null if no action to undo - Starting');
      // Undo all original actions
      const res1 = await testEnvironment.workItemService.undoLastAction(); // Delete Item 2 (action 4)
      logger.debug('Test: should return null if no action to undo - 1st undo result:', res1?.action_id);
      const res2 = await testEnvironment.workItemService.undoLastAction(); // Update Item 1 (action 3)
      logger.debug('Test: should return null if no action to undo - 2nd undo result:', res2?.action_id);
      const res3 = await testEnvironment.workItemService.undoLastAction(); // Add Item 2 (action 2)
      logger.debug('Test: should return null if no action to undo - 3rd undo result:', res3?.action_id);
      const res4 = await testEnvironment.workItemService.undoLastAction(); // Add Item 1 (action 1)
      logger.debug('Test: should return null if no action to undo - 4th undo result:', res4?.action_id);

      // Try to undo again
      logger.debug('Test: should return null if no action to undo - Attempting 5th undo');
      const result = await testEnvironment.workItemService.undoLastAction();
      logger.debug('Test: should return null if no action to undo - 5th undo result:', result);
      expect(result).toBeNull();

      // Fetch item 1 and item 2 to see their state after all undos (should be inactive)
      logger.debug('Test: should return null if no action to undo - Fetching items after all undos');
      const item1AfterAllUndos = await testEnvironment.workItemRepository.findById(item1.work_item_id, {
        isActive: false,
      });
      const item2AfterAllUndos = await testEnvironment.workItemRepository.findById(item2.work_item_id, {
        isActive: false,
      });
      logger.debug(
        'Test: should return null if no action to undo - Fetched item 1 after all undos (isActive: false):',
        item1AfterAllUndos
      );
      logger.debug(
        'Test: should return null if no action to undo - Fetched item 2 after all undos (isActive: false):',
        item2AfterAllUndos
      );

      logger.debug('Test: should return null if no action to undo - Finished');
    });
  });

  describe('Redo Operations', () => {
    it('should redo the last undone action', async () => {
      logger.debug('Test: should redo the last undone action - Starting');
      await testEnvironment.workItemService.undoLastAction(); // Undoes delete (action 4)
      logger.debug('Test: should redo the last undone action - After undoing delete (action 4)');

      logger.debug('Test: should redo the last undone action - Fetching item 2 after undo');
      const item2AfterUndo = await testEnvironment.workItemRepository.findById(item2.work_item_id, { isActive: true });
      logger.debug('Test: should redo the last undone action - Fetched item 2 after undo:', item2AfterUndo);
      expect(item2AfterUndo?.is_active).toBe(true);

      logger.debug('Test: should redo the last undone action - Performing redo');
      const redoneAction = await testEnvironment.workItemService.redoLastUndo(); // Redoes delete (action 4)
      logger.debug('Test: should redo the last undone action - redoLastUndo result:', redoneAction);
      expect(redoneAction).toBeDefined();
      expect(redoneAction?.action_id).toBe(action4_delete.action_id);
      expect(redoneAction?.is_undone).toBe(false); // Should be marked as NOT undone after redo

      logger.debug('Test: should redo the last undone action - Fetching item 2 after redo');
      const item2AfterRedo = await testEnvironment.workItemRepository.findById(item2.work_item_id, { isActive: false });
      logger.debug('Test: should redo the last undone action - Fetched item 2 after redo:', item2AfterRedo);
      expect(item2AfterRedo?.is_active).toBe(false);

      logger.debug('Test: should redo the last undone action - Fetching item 1 after redo');
      const item1AfterRedo = await testEnvironment.workItemRepository.findById(item1.work_item_id, { isActive: true });
      logger.debug('Test: should redo the last undone action - Fetched item 1 after redo:', item1AfterRedo);

      const allActions = await testEnvironment.actionHistoryRepository.listRecentActions({ limit: 10 }); // Get enough history
      const undoActionRecord = allActions.find(
        (a) => a.action_type === 'UNDO_ACTION' && a.description?.includes(action4_delete.description ?? '')
      );
      const redoActionRecord = allActions.find((a) => a.action_type === 'REDO_ACTION');

      expect(redoActionRecord).toBeDefined();
      expect(undoActionRecord?.is_undone).toBe(true); // UNDO itself is marked as undone/invalidated
      expect(undoActionRecord?.undone_at_action_id).toBe(redoActionRecord!.action_id); // Linked to REDO

      const originalActionFinalState = await testEnvironment.actionHistoryRepository.findActionById(
        action4_delete.action_id
      );
      expect(originalActionFinalState?.is_undone).toBe(false);
      logger.debug('Test: should redo the last undone action - Finished');
    });

    it('should redo multiple undone actions sequentially', async () => {
      logger.debug('Test: should redo multiple undone actions sequentially - Starting');
      await testEnvironment.workItemService.undoLastAction(); // Undoes delete (action 4)
      logger.debug('Test: should redo multiple undone actions sequentially - After 1st undo (delete action 4)');
      await testEnvironment.workItemService.undoLastAction(); // Undoes update (action 3)
      logger.debug('Test: should redo multiple undone actions sequentially - After 2nd undo (update action 3)');

      logger.debug('Test: should redo multiple undone actions sequentially - Fetching items after undos');
      const item1AfterUndos = await testEnvironment.workItemRepository.findById(item1.work_item_id, { isActive: true }); // Should be active with original name
      const item2AfterUndos = await testEnvironment.workItemRepository.findById(item2.work_item_id, { isActive: true }); // Should be active
      logger.debug(
        'Test: should redo multiple undone actions sequentially - Fetched item 1 after undos:',
        item1AfterUndos
      );
      logger.debug(
        'Test: should redo multiple undone actions sequentially - Fetched item 2 after undos:',
        item2AfterUndos
      );

      expect(item1AfterUndos?.name).toBe('Item 1');
      expect(item2AfterUndos?.is_active).toBe(true);

      // Redo update (action 3)
      logger.debug('Test: should redo multiple undone actions sequentially - Performing 1st redo (update action 3)');
      const redoneUpdateAction = await testEnvironment.workItemService.redoLastUndo();
      logger.debug(
        'Test: should redo multiple undone actions sequentially - 1st redo (update) result:',
        redoneUpdateAction
      );
      expect(redoneUpdateAction?.action_id).toBe(action3_update.action_id);
      expect(redoneUpdateAction?.is_undone).toBe(false);

      logger.debug('Test: should redo multiple undone actions sequentially - Fetching items after 1st redo');
      const item1AfterRedo1 = await testEnvironment.workItemRepository.findById(item1.work_item_id, { isActive: true }); // Should be active with updated name
      const item2AfterRedo1 = await testEnvironment.workItemRepository.findById(item2.work_item_id, { isActive: true }); // Should still be active
      logger.debug('Test: should redo multiple actions sequentially - Fetched item 1 after 1st redo:', item1AfterRedo1);
      logger.debug('Test: should redo multiple actions sequentially - Fetched item 2 after 1st redo:', item2AfterRedo1);

      expect(item1AfterRedo1?.name).toBe('Item 1 Updated');
      expect(item2AfterRedo1?.is_active).toBe(true);

      const originalAction3FinalState = await testEnvironment.actionHistoryRepository.findActionById(
        action3_update.action_id
      );
      expect(originalAction3FinalState?.is_undone).toBe(false);

      // Redo delete (action 4)
      logger.debug('Test: should redo multiple undone actions sequentially - Performing 2nd redo (delete action 4)');
      const redoneDeleteAction = await testEnvironment.workItemService.redoLastUndo();
      logger.debug(
        'Test: should redo multiple undone actions sequentially - 2nd redo (delete) result:',
        redoneDeleteAction
      );
      expect(redoneDeleteAction?.action_id).toBe(action4_delete.action_id);
      expect(redoneDeleteAction?.is_undone).toBe(false);

      logger.debug('Test: should redo multiple undone actions sequentially - Fetching items after 2nd redo');
      const item1AfterRedo2 = await testEnvironment.workItemRepository.findById(item1.work_item_id, { isActive: true }); // Should still be active with updated name
      const item2AfterRedo2 = await testEnvironment.workItemRepository.findById(item2.work_item_id, {
        isActive: false, // Should be inactive
      });
      logger.debug('Test: should redo multiple actions sequentially - Fetched item 1 after 2nd redo:', item1AfterRedo2);
      logger.debug('Test: should redo multiple actions sequentially - Fetched item 2 after 2nd redo:', item2AfterRedo2);

      expect(item1AfterRedo2?.name).toBe('Item 1 Updated');
      expect(item2AfterRedo2?.is_active).toBe(false);

      const originalAction4FinalState = await testEnvironment.actionHistoryRepository.findActionById(
        action4_delete.action_id
      );
      expect(originalAction4FinalState?.is_undone).toBe(false);
      logger.debug('Test: should redo multiple undone actions sequentially - Finished');
    });
  });

  // ... other tests ...
  describe('Edge Cases', () => {
    it('should return null if no action to undo', async () => {
      logger.debug('Test: should return null if no action to undo - Starting');
      // Undo all original actions
      const res1 = await testEnvironment.workItemService.undoLastAction(); // Delete Item 2 (action 4)
      logger.debug('Test: should return null if no action to undo - 1st undo result:', res1?.action_id);
      const res2 = await testEnvironment.workItemService.undoLastAction(); // Update Item 1 (action 3)
      logger.debug('Test: should return null if no action to undo - 2nd undo result:', res2?.action_id);
      const res3 = await testEnvironment.workItemService.undoLastAction(); // Add Item 2 (action 2)
      logger.debug('Test: should return null if no action to undo - 3rd undo result:', res3?.action_id);
      const res4 = await testEnvironment.workItemService.undoLastAction(); // Add Item 1 (action 1)
      logger.debug('Test: should return null if no action to undo - 4th undo result:', res4?.action_id);

      // Try to undo again
      logger.debug('Test: should return null if no action to undo - Attempting 5th undo');
      const result = await testEnvironment.workItemService.undoLastAction();
      logger.debug('Test: should return null if no action to undo - 5th undo result:', result);
      expect(result).toBeNull();

      // Fetch item 1 and item 2 to see their state after all undos (should be inactive)
      logger.debug('Test: should return null if no action to undo - Fetching items after all undos');
      const item1AfterAllUndos = await testEnvironment.workItemRepository.findById(item1.work_item_id, {
        isActive: false,
      });
      const item2AfterAllUndos = await testEnvironment.workItemRepository.findById(item2.work_item_id, {
        isActive: false,
      });
      logger.debug(
        'Test: should return null if no action to undo - Fetched item 1 after all undos (isActive: false):',
        item1AfterAllUndos
      );
      logger.debug(
        'Test: should return null if no action to undo - Fetched item 2 after all undos (isActive: false):',
        item2AfterAllUndos
      );

      logger.debug('Test: should return null if no action to undo - Finished');
    });

    it('should return null if no action to redo', async () => {
      logger.debug('Test: should return null if no action to redo - Starting');
      logger.debug('Test: should return null if no action to redo - Attempting 1st redo');
      const result1 = await testEnvironment.workItemService.redoLastUndo();
      logger.debug('Test: should return null if no action to redo - 1st redo result:', result1);
      expect(result1).toBeNull();

      await testEnvironment.workItemService.undoLastAction(); // Undo delete item 2
      logger.debug('Test: should return null if no action to redo - After undoing delete item 2');

      logger.debug('Test: should return null if no action to redo - Attempting 2nd redo');
      await testEnvironment.workItemService.redoLastUndo(); // Redo delete item 2
      logger.debug('Test: should return null if no action to redo - After redoing delete item 2');

      logger.debug('Test: should return null if no action to redo - Attempting 3rd redo');
      const finalResult = await testEnvironment.workItemService.redoLastUndo();
      logger.debug('Test: should return null if no action to redo - 3rd redo result:', finalResult);
      expect(finalResult).toBeNull();

      // Fetch item 1 and item 2 to see their state at the end
      logger.debug('Test: should return null if no action to redo - Fetching items at the end');
      const item1AtEnd = await testEnvironment.workItemRepository.findById(item1.work_item_id, { isActive: true });
      const item2AtEnd = await testEnvironment.workItemRepository.findById(item2.work_item_id, { isActive: false });
      logger.debug(
        'Test: should return null if no action to redo - Fetched item 1 at end (isActive: true):',
        item1AtEnd
      );
      logger.debug(
        'Test: should return null if no action to redo - Fetched item 2 at end (isActive: false):',
        item2AtEnd
      );

      logger.debug('Test: should return null if no action to redo - Finished');
    });

    it('should return null if redo stack is cleared by a new action', async () => {
      logger.debug('Test: should return null if redo stack is cleared by a new action - Starting');
      await testEnvironment.workItemService.undoLastAction(); // Undo delete item 2
      logger.debug('Test: should return null if redo stack is cleared by a new action - After undoing delete item 2');

      logger.debug(
        'Test: should return null if redo stack is cleared by a new action - Performing new action (update item 1)'
      );
      await testEnvironment.workItemService.updateWorkItem(item1.work_item_id, {
        description: 'New description',
      });
      logger.debug('Test: should return null if redo stack is cleared by a new action - After new action');

      logger.debug('Test: should return null if redo stack is cleared by a new action - Attempting redo');
      const redoResult = await testEnvironment.workItemService.redoLastUndo();
      logger.debug('Test: should return null if redo stack is cleared by a new action - Redo result:', redoResult);
      expect(redoResult).toBeNull();

      // Fetch item 1 and item 2 to see their state at the end
      logger.debug('Test: should return null if redo stack is cleared by a new action - Fetching items at the end');
      const item1AtEnd = await testEnvironment.workItemRepository.findById(item1.work_item_id, { isActive: true });
      const item2AtEnd = await testEnvironment.workItemRepository.findById(item2.work_item_id, { isActive: false }); // Should still be inactive from original delete
      logger.debug(
        'Test: should return null if redo stack is cleared by a new action - Fetched item 1 at end (isActive: true):',
        item1AtEnd
      );
      logger.debug(
        'Test: should return null if redo stack is cleared by a new action - Fetched item 2 at end (isActive: false):',
        item2AtEnd
      );

      logger.debug('Test: should return null if redo stack is cleared by a new action - Finished');
    });
  });
});
