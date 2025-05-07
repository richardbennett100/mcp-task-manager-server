// src/services/__tests__/workItemHistoryIntegration.test.ts
import { setupTestEnvironment, cleanDatabase } from './integrationSetup.js';
// Corrected imports: Use index.js
import { WorkItemData, ActionHistoryData } from '../../repositories/index.js';
import { logger } from '../../utils/logger.js'; // Import the logger

// Helper function for delay
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
    action4_delete = (await testEnvironment.actionHistoryRepository.listRecentActions({ limit: 1 }))[0]; // Get the very last action // Fetch the DELETE action itself

    // Sanity checks
    expect(action1_add?.action_type).toBe('ADD_WORK_ITEM');
    expect(action2_add?.action_type).toBe('ADD_WORK_ITEM');
    expect(action3_update?.action_type).toBe('UPDATE_WORK_ITEM');
    expect(action4_delete?.action_type).toBe('DELETE_WORK_ITEM_CASCADE'); // Check the last action type
    expect(action4_delete?.work_item_id).toBe(item2.work_item_id); // Ensure it pertains to item2

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

      // Remove the test delay, as it didn't help
      // await delay(100);
      // logger.debug('Test: should undo last action (delete item 2) - After 100ms delay');

      expect(undoneAction).toBeDefined();

      logger.debug('Test: should undo last action (delete item 2) - Fetching item 2 after undo');
      // --- START: Modified Assertion Logic ---
      const currentItem2Active = await testEnvironment.workItemRepository.findById(item2.work_item_id, {
        isActive: true,
      });

      if (!currentItem2Active) {
        // If not found active, check if it exists but is inactive
        const currentItem2Inactive = await testEnvironment.workItemRepository.findById(item2.work_item_id, {
          isActive: false,
        });
        logger.error(
          'Test Failure Condition: Item 2 found INACTIVE after undo. Undo step execution likely failed.',
          currentItem2Inactive
        );
        // Fail explicitly if it's found inactive, confirming the update didn't stick
        expect(currentItem2Inactive).toBeUndefined(); // We expect it to be active, finding it inactive is the error.
      }

      // These assertions will now only run if currentItem2Active was found successfully
      expect(currentItem2Active).toBeDefined();
      expect(currentItem2Active?.is_active).toBe(true);
      // --- END: Modified Assertion Logic ---

      logger.debug('Test: should undo last action (delete item 2) - Fetching item 1 after undo');
      const currentItem1 = await testEnvironment.workItemRepository.findById(item1.work_item_id, { isActive: true });
      logger.debug('Test: should undo last action (delete item 2) - Fetched item 1 after undo:', currentItem1);

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

    // Note: Similar modifications might be needed for other failing tests if this passes,
    // but per the guidelines, we focus on one failure at a time.
    it('should undo multiple actions sequentially', async () => {
      logger.debug('Test: should undo multiple actions sequentially - Starting');
      const undoneDelete = await testEnvironment.workItemService.undoLastAction(); // Undoes delete (action 4)
      logger.debug('Test: should undo multiple actions sequentially - 1st undo (delete) result:', undoneDelete);
      expect(undoneDelete).toBeDefined();

      await delay(50); // Keep short delay between undos for now

      logger.debug('Test: should undo multiple actions sequentially - Performing 2nd undo (update)');
      const undoneUpdate = await testEnvironment.workItemService.undoLastAction(); // Undoes update (action 3)
      logger.debug('Test: should undo multiple actions sequentially - 2nd undo (update) result:', undoneUpdate);
      expect(undoneUpdate).toBeDefined();

      await delay(100); // Delay before checking state

      logger.debug('Test: should undo multiple actions sequentially - Fetching items after 2nd undo');
      const currentItem1 = await testEnvironment.workItemRepository.findById(item1.work_item_id, { isActive: true });
      const currentItem2 = await testEnvironment.workItemRepository.findById(item2.work_item_id, { isActive: true });
      logger.debug('Test: should undo multiple actions sequentially - Fetched item 1 after 2nd undo:', currentItem1);
      logger.debug('Test: should undo multiple actions sequentially - Fetched item 2 after 2nd undo:', currentItem2);

      expect(currentItem1?.name).toBe('Item 1');
      // Apply similar check logic here if needed
      expect(currentItem2).toBeDefined();
      expect(currentItem2?.is_active).toBe(true);

      const action3AfterUndo = await testEnvironment.actionHistoryRepository.findActionById(action3_update.action_id);
      expect(action3AfterUndo?.is_undone).toBe(true);
      const action4AfterUndo = await testEnvironment.actionHistoryRepository.findActionById(action4_delete.action_id);
      expect(action4AfterUndo?.is_undone).toBe(true);

      const lastAction = (await testEnvironment.actionHistoryRepository.listRecentActions({ limit: 1 }))[0];
      expect(lastAction.action_type).toBe('UNDO_ACTION');
      expect(action3AfterUndo?.undone_at_action_id).toBe(lastAction.action_id);
      logger.debug('Test: should undo multiple actions sequentially - Finished');
    });

    it('should return null if no action to undo', async () => {
      logger.debug('Test: should return null if no action to undo - Starting');
      // Undo all original actions
      await testEnvironment.workItemService.undoLastAction(); // 4
      await testEnvironment.workItemService.undoLastAction(); // 3
      await testEnvironment.workItemService.undoLastAction(); // 2
      await testEnvironment.workItemService.undoLastAction(); // 1

      // Try to undo again
      const result = await testEnvironment.workItemService.undoLastAction();
      expect(result).toBeNull();

      await delay(100); // Delay before checking final state

      // Fetch items (inactive state)
      const item1AfterAllUndos = await testEnvironment.workItemRepository.findById(item1.work_item_id, {
        isActive: false,
      });
      const item2AfterAllUndos = await testEnvironment.workItemRepository.findById(item2.work_item_id, {
        isActive: false,
      });

      expect(item1AfterAllUndos).toBeDefined();
      expect(item1AfterAllUndos?.is_active).toBe(false);
      expect(item2AfterAllUndos).toBeDefined();
      expect(item2AfterAllUndos?.is_active).toBe(false);

      logger.debug('Test: should return null if no action to undo - Finished');
    });
  });

  describe('Redo Operations', () => {
    it('should redo the last undone action', async () => {
      logger.debug('Test: should redo the last undone action - Starting');
      await testEnvironment.workItemService.undoLastAction(); // Undoes delete (action 4)
      logger.debug('Test: should redo the last undone action - After undoing delete (action 4)');

      await delay(100); // Delay before checking state after undo

      logger.debug('Test: should redo the last undone action - Fetching item 2 after undo');
      const item2AfterUndo = await testEnvironment.workItemRepository.findById(item2.work_item_id, { isActive: true });
      logger.debug('Test: should redo the last undone action - Fetched item 2 after undo:', item2AfterUndo);
      // Apply similar check logic if needed
      expect(item2AfterUndo).toBeDefined();
      expect(item2AfterUndo?.is_active).toBe(true);

      logger.debug('Test: should redo the last undone action - Performing redo');
      const redoneAction = await testEnvironment.workItemService.redoLastUndo(); // Redoes delete (action 4)
      logger.debug('Test: should redo the last undone action - redoLastUndo result:', redoneAction);
      expect(redoneAction).toBeDefined();
      expect(redoneAction?.action_id).toBe(action4_delete.action_id);
      expect(redoneAction?.is_undone).toBe(false);

      await delay(100); // Delay before checking state after redo

      logger.debug('Test: should redo the last undone action - Fetching item 2 after redo');
      const item2AfterRedo = await testEnvironment.workItemRepository.findById(item2.work_item_id, { isActive: false });
      logger.debug('Test: should redo the last undone action - Fetched item 2 after redo:', item2AfterRedo);
      expect(item2AfterRedo).toBeDefined();
      expect(item2AfterRedo?.is_active).toBe(false);

      logger.debug('Test: should redo the last undone action - Fetching item 1 after redo');
      const item1AfterRedo = await testEnvironment.workItemRepository.findById(item1.work_item_id, { isActive: true });
      logger.debug('Test: should redo the last undone action - Fetched item 1 after redo:', item1AfterRedo);
      expect(item1AfterRedo?.name).toBe('Item 1 Updated');

      const allActions = await testEnvironment.actionHistoryRepository.listRecentActions({ limit: 10 });
      const undoActionRecord = allActions.find(
        (a) => a.action_type === 'UNDO_ACTION' && a.description?.includes(action4_delete.description ?? '')
      );
      const redoActionRecord = allActions.find((a) => a.action_type === 'REDO_ACTION');

      expect(redoActionRecord).toBeDefined();
      expect(undoActionRecord?.is_undone).toBe(true);
      expect(undoActionRecord?.undone_at_action_id).toBe(redoActionRecord!.action_id);

      const originalActionFinalState = await testEnvironment.actionHistoryRepository.findActionById(
        action4_delete.action_id
      );
      expect(originalActionFinalState?.is_undone).toBe(false);
      logger.debug('Test: should redo the last undone action - Finished');
    });

    it('should redo multiple undone actions sequentially', async () => {
      logger.debug('Test: should redo multiple undone actions sequentially - Starting');
      await testEnvironment.workItemService.undoLastAction(); // Undo delete (4)
      await delay(50);
      await testEnvironment.workItemService.undoLastAction(); // Undo update (3)
      logger.debug('Test: should redo multiple undone actions sequentially - After 2nd undo');

      await delay(100); // Delay before checking state after undos

      logger.debug('Test: should redo multiple undone actions sequentially - Fetching items after undos');
      const item1AfterUndos = await testEnvironment.workItemRepository.findById(item1.work_item_id, { isActive: true });
      const item2AfterUndos = await testEnvironment.workItemRepository.findById(item2.work_item_id, { isActive: true });
      logger.debug(
        'Test: should redo multiple undone actions sequentially - Fetched item 1 after undos:',
        item1AfterUndos
      );
      logger.debug(
        'Test: should redo multiple undone actions sequentially - Fetched item 2 after undos:',
        item2AfterUndos
      );

      expect(item1AfterUndos?.name).toBe('Item 1');
      // Apply similar check logic if needed
      expect(item2AfterUndos).toBeDefined();
      expect(item2AfterUndos?.is_active).toBe(true);

      // Redo update (action 3)
      logger.debug('Test: should redo multiple undone actions sequentially - Performing 1st redo (update action 3)');
      const redoneUpdateAction = await testEnvironment.workItemService.redoLastUndo();
      expect(redoneUpdateAction?.action_id).toBe(action3_update.action_id);
      expect(redoneUpdateAction?.is_undone).toBe(false);

      await delay(100); // Delay before checking state after 1st redo

      logger.debug('Test: should redo multiple undone actions sequentially - Fetching items after 1st redo');
      const item1AfterRedo1 = await testEnvironment.workItemRepository.findById(item1.work_item_id, { isActive: true });
      const item2AfterRedo1 = await testEnvironment.workItemRepository.findById(item2.work_item_id, { isActive: true });
      expect(item1AfterRedo1?.name).toBe('Item 1 Updated');
      expect(item2AfterRedo1?.is_active).toBe(true);

      // Redo delete (action 4)
      logger.debug('Test: should redo multiple undone actions sequentially - Performing 2nd redo (delete action 4)');
      const redoneDeleteAction = await testEnvironment.workItemService.redoLastUndo();
      expect(redoneDeleteAction?.action_id).toBe(action4_delete.action_id);
      expect(redoneDeleteAction?.is_undone).toBe(false);

      await delay(100); // Delay before checking final state

      logger.debug('Test: should redo multiple undone actions sequentially - Fetching items after 2nd redo');
      const item1AfterRedo2 = await testEnvironment.workItemRepository.findById(item1.work_item_id, { isActive: true });
      const item2AfterRedo2 = await testEnvironment.workItemRepository.findById(item2.work_item_id, {
        isActive: false,
      });
      expect(item1AfterRedo2?.name).toBe('Item 1 Updated');
      expect(item2AfterRedo2).toBeDefined();
      expect(item2AfterRedo2?.is_active).toBe(false);

      logger.debug('Test: should redo multiple undone actions sequentially - Finished');
    });
  });

  describe('Edge Cases', () => {
    it('should return null if no action to undo', async () => {
      logger.debug('Test: should return null if no action to undo - Starting');
      await testEnvironment.workItemService.undoLastAction(); // 4
      await testEnvironment.workItemService.undoLastAction(); // 3
      await testEnvironment.workItemService.undoLastAction(); // 2
      await testEnvironment.workItemService.undoLastAction(); // 1
      const result = await testEnvironment.workItemService.undoLastAction();
      expect(result).toBeNull();

      await delay(100);

      const item1AfterAllUndos = await testEnvironment.workItemRepository.findById(item1.work_item_id, {
        isActive: false,
      });
      const item2AfterAllUndos = await testEnvironment.workItemRepository.findById(item2.work_item_id, {
        isActive: false,
      });
      expect(item1AfterAllUndos?.is_active).toBe(false);
      expect(item2AfterAllUndos?.is_active).toBe(false);
      logger.debug('Test: should return null if no action to undo - Finished');
    });

    it('should return null if no action to redo', async () => {
      logger.debug('Test: should return null if no action to redo - Starting');
      const result1 = await testEnvironment.workItemService.redoLastUndo();
      expect(result1).toBeNull();

      await testEnvironment.workItemService.undoLastAction(); // Undo delete item 2
      await testEnvironment.workItemService.redoLastUndo(); // Redo delete item 2
      const finalResult = await testEnvironment.workItemService.redoLastUndo();
      expect(finalResult).toBeNull();

      await delay(100);

      const item1AtEnd = await testEnvironment.workItemRepository.findById(item1.work_item_id, { isActive: true });
      const item2AtEnd = await testEnvironment.workItemRepository.findById(item2.work_item_id, { isActive: false });
      expect(item1AtEnd?.name).toBe('Item 1 Updated');
      expect(item2AtEnd?.is_active).toBe(false);
      logger.debug('Test: should return null if no action to redo - Finished');
    });

    it('should return null if redo stack is cleared by a new action', async () => {
      logger.debug('Test: should return null if redo stack is cleared by a new action - Starting');
      await testEnvironment.workItemService.undoLastAction(); // Undo delete item 2
      logger.debug('Test: should return null if redo stack is cleared by a new action - After undoing delete item 2');

      await delay(100); // Ensure undo state is visible

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

      await delay(100); // Delay before checking final state

      // Fetch item 1 and item 2 to see their state at the end
      logger.debug('Test: should return null if redo stack is cleared by a new action - Fetching items at the end');
      const item1AtEnd = await testEnvironment.workItemRepository.findById(item1.work_item_id, { isActive: true });
      // Item 2 should now be ACTIVE because the undo happened, and the subsequent update cleared the redo stack
      const item2AtEnd = await testEnvironment.workItemRepository.findById(item2.work_item_id, { isActive: true });
      logger.debug(
        'Test: should return null if redo stack is cleared by a new action - Fetched item 1 at end (isActive: true):',
        item1AtEnd
      );
      logger.debug(
        'Test: should return null if redo stack is cleared by a new action - Fetched item 2 at end (isActive: true):', // Adjusted expectation
        item2AtEnd
      );

      expect(item1AtEnd?.description).toBe('New description');
      // Adjusted assertion: Item 2 should be active after the undo and subsequent clearing action
      expect(item2AtEnd).toBeDefined();
      expect(item2AtEnd?.is_active).toBe(true);

      logger.debug('Test: should return null if redo stack is cleared by a new action - Finished');
    });
  });
});
