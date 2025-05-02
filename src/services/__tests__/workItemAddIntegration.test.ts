// src/services/__tests__/workItemAddIntegration.test.ts
import { setupTestEnvironment, cleanDatabase } from './integrationSetup.js';
import { AddWorkItemInput } from '../WorkItemServiceTypes.js'; // Assuming path is correct
import { ValidationError } from '../../utils/errors.js'; // Assuming path is correct
// Corrected imports: Use index.js
import { WorkItemData } from '../../repositories/index.js'; // Import WorkItemData for type assertion
import { logger } from '../../utils/logger.js'; // Import logger

describe('WorkItemService - Add Work Item Integration Tests', () => {
  let testEnvironment: Awaited<ReturnType<typeof setupTestEnvironment>>;

  beforeAll(async () => {
    testEnvironment = await setupTestEnvironment();
  });

  beforeEach(async () => {
    await cleanDatabase(testEnvironment.pool);
    logger.debug('BeforeEach setup complete for WorkItemAddIntegration.test.ts');
  });

  afterAll(async () => {
    if (testEnvironment.pool) {
      await testEnvironment.pool.end();
    }
  });

  describe('addWorkItem', () => {
    it('should add a root work item without dependencies', async () => {
      logger.debug('Test: should add a root work item without dependencies - Starting');
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
        limit: 1,
      });
      expect(history).toHaveLength(1);
      expect(history[0].action_type).toBe('ADD_WORK_ITEM');
      const steps = await testEnvironment.actionHistoryRepository.findUndoStepsByActionId(history[0].action_id);
      expect(steps).toHaveLength(1);
      // FIX: Expect UPDATE step type for undo of ADD
      expect(steps[0].step_type).toBe('UPDATE');
      expect(steps[0].table_name).toBe('work_items');
      expect(steps[0].record_id).toBe(result.work_item_id);
      // FIX: Verify old_data and new_data for is_active change (using WorkItemData type assertion)
      expect(steps[0].old_data).toBeDefined();
      // old_data should represent the state AFTER the undo (inactive)
      expect((steps[0].old_data as WorkItemData).is_active).toBe(false);

      expect(steps[0].new_data).toBeDefined();
      // new_data should represent the state BEFORE the undo (active, as added)
      expect((steps[0].new_data as WorkItemData).is_active).toBe(true);
      logger.debug('Test: should add a root work item without dependencies - Finished');
    });

    it('should add a child work item with a parent', async () => {
      logger.debug('Test: should add a child work item with a parent - Starting');
      const parent = await testEnvironment.workItemService.addWorkItem({
        name: 'Parent Project',
      });
      logger.debug('Test: should add a child work item with a parent - Created parent:', parent.work_item_id);
      const childInput: AddWorkItemInput = {
        name: 'Child Task',
        parent_work_item_id: parent.work_item_id,
        status: 'in-progress',
      };
      logger.debug('Test: should add a child work item with a parent - Adding child to parent', parent.work_item_id);
      const childResult = await testEnvironment.workItemService.addWorkItem(childInput);
      logger.debug('Test: should add a child work item with a parent - Child added:', childResult.work_item_id);
      expect(childResult).toBeDefined();
      expect(childResult.parent_work_item_id).toBe(parent.work_item_id);
      const dbChild = await testEnvironment.workItemRepository.findById(childResult.work_item_id);
      expect(dbChild).toEqual(childResult);
      logger.debug('Test: should add a child work item with a parent - Finished');
    });

    it('should add a work item with dependencies', async () => {
      logger.debug('Test: should add a work item with dependencies - Starting');
      const depTarget = await testEnvironment.workItemService.addWorkItem({
        name: 'Dependency Target',
      });
      logger.debug(
        'Test: should add a work item with dependencies - Created dependency target:',
        depTarget.work_item_id
      );
      const workItemInput: AddWorkItemInput = {
        name: 'Item with Dependency',
        dependencies: [{ depends_on_work_item_id: depTarget.work_item_id, dependency_type: 'linked' }],
      };
      logger.debug(
        'Test: should add a work item with dependencies - Adding item with dependency on',
        depTarget.work_item_id
      );
      const result = await testEnvironment.workItemService.addWorkItem(workItemInput);
      logger.debug('Test: should add a work item with dependencies - Item with dependency added:', result.work_item_id);
      const dbDeps = await testEnvironment.workItemRepository.findDependencies(result.work_item_id);
      expect(dbDeps).toHaveLength(1);
      expect(dbDeps[0].depends_on_work_item_id).toBe(depTarget.work_item_id);
      expect(dbDeps[0].dependency_type).toBe('linked');
      expect(dbDeps[0].is_active).toBe(true); // Verify dependency is active
      logger.debug('Test: should add a work item with dependencies - Finished');
    });

    it('should clear the redo stack when adding a new item', async () => {
      logger.debug('Test: should clear the redo stack when adding a new item - Starting');
      // 1. Add Item 1
      logger.debug('Test: should clear the redo stack when adding a new item - Adding Item 1');
      const item1 = await testEnvironment.workItemService.addWorkItem({
        name: 'Item 1',
      });
      const action1 = (
        await testEnvironment.actionHistoryRepository.listRecentActions({
          limit: 1,
        })
      )[0];
      expect(action1).toBeDefined();
      logger.debug(
        'Test: should clear the redo stack when adding a new item - Added Item 1, action:',
        action1.action_id
      );

      // 2. Undo Add Item 1
      logger.debug('Test: should clear the redo stack when adding a new item - Undoing Add Item 1');
      await testEnvironment.workItemService.undoLastAction();
      const undoActionForItem1 = (
        await testEnvironment.actionHistoryRepository.listRecentActions({
          limit: 1,
        })
      )[0];
      expect(undoActionForItem1).toBeDefined();
      expect(undoActionForItem1.action_type).toBe('UNDO_ACTION');
      logger.debug(
        'Test: should clear the redo stack when adding a new item - Undid Add Item 1, undo action:',
        undoActionForItem1.action_id
      );

      // Verify Action 1 is marked as undone by the UNDO action
      const action1_after_undo = await testEnvironment.actionHistoryRepository.findActionById(action1.action_id);
      expect(action1_after_undo?.is_undone).toBe(true);
      expect(action1_after_undo?.undone_at_action_id).toBe(undoActionForItem1.action_id);
      logger.debug('Test: should clear the redo stack when adding a new item - Verified action 1 is undone.');

      // 3. Add Item 2 (This should invalidate the redo possibility for Action 1)
      logger.debug('Test: should clear the redo stack when adding a new item - Adding Item 2 (clears redo stack)');
      const item2 = await testEnvironment.workItemService.addWorkItem({
        name: 'Item 2',
      });
      const action2 = (
        await testEnvironment.actionHistoryRepository.listRecentActions({
          limit: 1,
        })
      )[0];
      expect(action2).toBeDefined();
      expect(action2.action_type).toBe('ADD_WORK_ITEM');
      expect(action2.work_item_id).toBe(item2.work_item_id);
      logger.debug(
        'Test: should clear the redo stack when adding a new item - Added Item 2, action:',
        action2.action_id
      );

      // 4. Verify the UNDO action (undoActionForItem1) is now marked as "undone" (invalidated) by Action 2
      const undoAction_after_action2 = await testEnvironment.actionHistoryRepository.findActionById(
        undoActionForItem1.action_id
      );
      expect(undoAction_after_action2?.is_undone).toBe(true); // Still 'undone', but means invalidated now
      expect(undoAction_after_action2?.undone_at_action_id).toBe(action2.action_id); // Linked to action2
      logger.debug(
        'Test: should clear the redo stack when adding a new item - Verified undo action is invalidated by action 2.'
      );

      // 5. Attempt to Redo - should return null as the stack was cleared by Action 2
      logger.debug('Test: should clear the redo stack when adding a new item - Attempting redo (should be null)');
      const redoResult = await testEnvironment.workItemService.redoLastUndo();
      logger.debug('Test: should clear the redo stack when adding a new item - Redo result:', redoResult);
      expect(redoResult).toBeNull();

      // 6. Verify Item 1 remains inactive (after being soft-deleted by undo)
      logger.debug(
        'Test: should clear the redo stack when adding a new item - Verifying item 1 is inactive (isActive: false)'
      );
      const dbItem1 = await testEnvironment.workItemRepository.findById(item1.work_item_id, { isActive: false });
      logger.debug(
        'Test: should clear the redo stack when adding a new item - Fetched item 1 (isActive: false):',
        dbItem1
      );
      // FIX: Expect item to exist but be inactive after undoing an ADD under soft-delete history
      expect(dbItem1).toBeDefined();
      expect(dbItem1?.is_active).toBe(false);
      logger.debug('Test: should clear the redo stack when adding a new item - Verified item 1 is inactive.');

      // 7. Verify Item 2 exists and is active
      logger.debug(
        'Test: should clear the redo stack when adding a new item - Verifying item 2 exists and is active (isActive: true)'
      );
      const dbItem2 = await testEnvironment.workItemRepository.findById(item2.work_item_id, { isActive: true });
      logger.debug(
        'Test: should clear the redo stack when adding a new item - Fetched item 2 (isActive: true):',
        dbItem2
      );
      expect(dbItem2).toBeDefined();
      expect(dbItem2?.is_active).toBe(true);
      logger.debug('Test: should clear the redo stack when adding a new item - Finished');
    });

    it('should validate parent work item is active', async () => {
      logger.debug('Test: should validate parent work item is active - Starting');
      const parent = await testEnvironment.workItemService.addWorkItem({
        name: 'Parent Project',
      });
      logger.debug('Test: should validate parent work item is active - Created parent:', parent.work_item_id);
      // Soft delete the parent
      logger.debug('Test: should validate parent work item is active - Soft deleting parent');
      await testEnvironment.workItemService.deleteWorkItem([parent.work_item_id]);

      // Fetch to confirm inactive
      logger.debug(
        'Test: should validate parent work item is active - Fetching parent (isActive: false) to confirm inactive'
      );
      const dbParent = await testEnvironment.workItemRepository.findById(parent.work_item_id, { isActive: false });
      logger.debug('Test: should validate parent work item is active - Fetched parent (isActive: false):', dbParent);
      expect(dbParent?.is_active).toBe(false);

      // Assert that adding a child to an inactive parent throws ValidationError
      logger.debug('Test: should validate parent work item is active - Attempting to add child to inactive parent');
      await expect(
        testEnvironment.workItemService.addWorkItem({
          name: 'Child Task',
          parent_work_item_id: parent.work_item_id,
        })
      ).rejects.toThrow(ValidationError);
      await expect(
        testEnvironment.workItemService.addWorkItem({
          name: 'Child Task',
          parent_work_item_id: parent.work_item_id,
        })
      ).rejects.toThrow(/not found or is inactive/);
      logger.debug('Test: should validate parent work item is active - Finished');
    });
  });
});
