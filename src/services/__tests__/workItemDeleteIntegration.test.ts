// src/services/__tests__/workItemDeleteIntegration.test.ts
import { setupTestEnvironment, cleanDatabase } from './integrationSetup.js';
// Corrected imports: Use index.js
import { WorkItemData } from '../../repositories/index.js';

describe('WorkItemService - Delete Work Item Integration Tests', () => {
  let testEnvironment: Awaited<ReturnType<typeof setupTestEnvironment>>;
  let parent: WorkItemData, child1: WorkItemData, child2: WorkItemData, grandchild1: WorkItemData;

  beforeAll(async () => {
    testEnvironment = await setupTestEnvironment();
  });

  beforeEach(async () => {
    await cleanDatabase(testEnvironment.pool);

    // Simulate a work item hierarchy
    parent = await testEnvironment.workItemService.addWorkItem({
      name: 'Parent Project',
      description: 'Top-level project to delete',
    });

    child1 = await testEnvironment.workItemService.addWorkItem({
      name: 'Child Task 1',
      parent_work_item_id: parent.work_item_id,
    });

    child2 = await testEnvironment.workItemService.addWorkItem({
      name: 'Child Task 2',
      parent_work_item_id: parent.work_item_id,
    });

    grandchild1 = await testEnvironment.workItemService.addWorkItem({
      name: 'Grandchild Task 1',
      parent_work_item_id: child1.work_item_id,
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

      // Verify item is inactive in DB
      const dbItem = await testEnvironment.workItemRepository.findById(child2.work_item_id, { isActive: false });
      expect(dbItem?.is_active).toBe(false);

      // Verify active count decreased
      const finalCount = (await testEnvironment.workItemRepository.findAll({ isActive: true })).length;
      expect(finalCount).toBe(initialCount - 1);

      // Verify history
      const history = await testEnvironment.actionHistoryRepository.listRecentActions({
        work_item_id: child2.work_item_id,
      });
      const deleteAction = history.find((h) => h.action_type === 'DELETE_WORK_ITEM_CASCADE');
      expect(deleteAction).toBeDefined();
      expect(deleteAction?.description).toContain('1 work item(s)'); // Should only mention 1 item deleted

      // Verify undo steps
      const steps = await testEnvironment.actionHistoryRepository.findUndoStepsByActionId(deleteAction!.action_id);
      expect(steps).toHaveLength(1); // Only one step for the single item
      expect(steps[0].step_type).toBe('UPDATE');
      expect(steps[0].table_name).toBe('work_items');
      expect(steps[0].record_id).toBe(child2.work_item_id);
      // Check old_data reflects the state *before* deletion (active)
      expect((steps[0].old_data as WorkItemData)?.is_active).toBe(true);
      // Check new_data reflects the state *after* deletion (inactive)
      expect((steps[0].new_data as WorkItemData)?.is_active).toBe(false);
    });

    it('should soft delete parent and all descendants recursively', async () => {
      // Setup a dependency link from grandchild1 to child2 to test link deletion cascade
      await testEnvironment.workItemService.updateWorkItem(grandchild1.work_item_id, {}, [
        { depends_on_work_item_id: child2.work_item_id },
      ]);
      const initialDep = await testEnvironment.workItemRepository.findDependencies(grandchild1.work_item_id);
      expect(initialDep[0]?.is_active).toBe(true);

      const initialCount = (await testEnvironment.workItemRepository.findAll({ isActive: true })).length;

      // Delete the parent
      const deletedCount = await testEnvironment.workItemService.deleteWorkItem([parent.work_item_id]);

      // Define expected cascade list
      const descendants = [parent.work_item_id, child1.work_item_id, child2.work_item_id, grandchild1.work_item_id];

      // Verify count of deleted items matches cascade size
      expect(deletedCount).toBe(descendants.length);

      // Query each descendant to confirm soft delete
      for (const descendantId of descendants) {
        const descendant = await testEnvironment.workItemRepository.findById(descendantId, { isActive: false });
        expect(descendant).toBeDefined();
        expect(descendant?.is_active).toBe(false);
      }

      // Verify active count reduction in DB
      const finalCount = (await testEnvironment.workItemRepository.findAll({ isActive: true })).length;
      expect(finalCount).toBe(initialCount - descendants.length);

      // Verify action history for the parent
      const history = await testEnvironment.actionHistoryRepository.listRecentActions({
        work_item_id: parent.work_item_id,
      });
      const deleteAction = history.find((h) => h.action_type === 'DELETE_WORK_ITEM_CASCADE');
      expect(deleteAction).toBeDefined();
      expect(deleteAction?.description).toContain(`${descendants.length} work item(s)`);
      expect(deleteAction?.description).toContain('1 related active links'); // Check link deletion description

      // Verify undo steps
      const steps = await testEnvironment.actionHistoryRepository.findUndoStepsByActionId(deleteAction!.action_id);
      // Expect steps for each item + 1 for the dependency link
      expect(steps).toHaveLength(descendants.length + 1);
      // Check item steps
      expect(steps.filter((s) => s.table_name === 'work_items').length).toBe(descendants.length);
      expect(steps.filter((s) => s.table_name === 'work_items').every((s) => s.step_type === 'UPDATE')).toBe(true);
      // Check dependency link step
      const linkStep = steps.find((s) => s.table_name === 'work_item_dependencies');
      expect(linkStep).toBeDefined();
      expect(linkStep?.step_type).toBe('UPDATE');
      expect(linkStep?.record_id).toBe(`${grandchild1.work_item_id}:${child2.work_item_id}`);
      expect((linkStep?.old_data as any)?.is_active).toBe(true); // FIXME: Remove 'as any'
      expect((linkStep?.new_data as any)?.is_active).toBe(false); // FIXME: Remove 'as any'

      // Verify the dependency link itself is inactive
      const finalDep = await testEnvironment.workItemRepository.findDependencies(grandchild1.work_item_id, {
        isActive: false,
      });
      expect(finalDep[0]?.is_active).toBe(false);
    });

    it('should clear the redo stack when deleting items', async () => {
      // 1. Delete child1
      await testEnvironment.workItemService.deleteWorkItem([child1.work_item_id]);
      const action1 = (
        await testEnvironment.actionHistoryRepository.listRecentActions({
          limit: 1,
        })
      )[0];
      expect(action1.action_type).toBe('DELETE_WORK_ITEM_CASCADE');

      // 2. Undo the delete of child1
      await testEnvironment.workItemService.undoLastAction();
      const undoAction = (
        await testEnvironment.actionHistoryRepository.listRecentActions({
          limit: 1,
        })
      )[0];
      expect(undoAction.action_type).toBe('UNDO_ACTION');

      // Verify action1 is marked undone by undoAction
      const action1_after_undo = await testEnvironment.actionHistoryRepository.findActionById(action1.action_id);
      expect(action1_after_undo?.is_undone).toBe(true);
      expect(action1_after_undo?.undone_at_action_id).toBe(undoAction.action_id);

      // 3. Delete another item (child2), which should clear the redo stack (invalidate undoAction)
      await testEnvironment.workItemService.deleteWorkItem([child2.work_item_id]);
      const action2 = (
        await testEnvironment.actionHistoryRepository.listRecentActions({
          limit: 1,
        })
      )[0];
      expect(action2.action_type).toBe('DELETE_WORK_ITEM_CASCADE');

      // 4. Verify the previous undo action is now marked as redone/invalidated by action2
      const undoAction_after_action2 = await testEnvironment.actionHistoryRepository.findActionById(
        undoAction!.action_id
      );
      expect(undoAction_after_action2?.is_undone).toBe(true); // Still 'undone', but means invalidated now
      expect(undoAction_after_action2?.undone_at_action_id).toBe(action2.action_id); // Linked to action2

      // 5. Attempt to Redo - should return null
      const redoResult = await testEnvironment.workItemService.redoLastUndo();
      expect(redoResult).toBeNull();
    });
  });
});
