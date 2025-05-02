// src/services/__tests__/workItemDeleteIntegration.test.ts
import { setupTestEnvironment, cleanDatabase } from './integrationSetup.js';
// Corrected imports: Use index.js
import { WorkItemData, WorkItemDependencyData } from '../../repositories/index.js'; // Import necessary types
import { logger } from '../../utils/logger.js'; // Import logger
import { Pool } from 'pg'; // Import Pool for type safety

// Helper function to query and log DB state
const logDatabaseState = async (
  pool: Pool,
  itemIds: string[],
  dependencyToCheck?: { itemId: string; dependsOnId: string },
  context?: string
) => {
  try {
    logger.debug(`--- DB State Check${context ? `: ${context}` : ''} ---`);
    // Check work items
    const itemsResult = await pool.query(
      `SELECT work_item_id, name, shortname, is_active, status, parent_work_item_id
       FROM work_items
       WHERE work_item_id = ANY($1::uuid[])
       ORDER BY created_at`,
      [itemIds]
    );
    logger.debug(`Work Items Found (${itemsResult.rowCount}):\n${JSON.stringify(itemsResult.rows, null, 2)}`);

    // Check specific dependency
    if (dependencyToCheck) {
      const depResult = await pool.query(
        `SELECT work_item_id, depends_on_work_item_id, is_active, dependency_type
         FROM work_item_dependencies
         WHERE work_item_id = $1 AND depends_on_work_item_id = $2`,
        [dependencyToCheck.itemId, dependencyToCheck.dependsOnId]
      );
      logger.debug(
        `Dependency Link ${dependencyToCheck.itemId} -> ${dependencyToCheck.dependsOnId} Found (${depResult.rowCount}):\n${JSON.stringify(
          depResult.rows,
          null,
          2
        )}`
      );
    }
    logger.debug(`--- End DB State Check${context ? `: ${context}` : ''} ---`);
  } catch (error) {
    logger.error(`Error during DB State Check${context ? `: ${context}` : ''}:`, error);
  }
};

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
    logger.debug('BeforeEach setup complete for WorkItemDeleteIntegration.test.ts');
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
      expect(dbItem).toBeDefined();
      expect(dbItem?.is_active).toBe(false);

      // Verify active count decreased
      const finalCount = (await testEnvironment.workItemRepository.findAll({ isActive: true })).length;
      expect(finalCount).toBe(initialCount - 1);

      // Verify history
      const history = await testEnvironment.actionHistoryRepository.listRecentActions({
        limit: 5, // Get a few recent actions
      });
      const deleteAction = history.find((h) => h.action_type === 'DELETE_WORK_ITEM_CASCADE');
      expect(deleteAction).toBeDefined();
      expect(deleteAction?.work_item_id).toBe(child2.work_item_id);
      expect(deleteAction?.description).toContain('1 work item(s)'); // Should mention 1 item deleted
      expect(deleteAction?.description).toContain('0 related active links'); // Should mention 0 links deleted

      // Verify undo steps
      const steps = await testEnvironment.actionHistoryRepository.findUndoStepsByActionId(deleteAction!.action_id);
      expect(steps).toHaveLength(1); // Only one step for the single item
      expect(steps[0].step_type).toBe('UPDATE');
      expect(steps[0].table_name).toBe('work_items');
      expect(steps[0].record_id).toBe(child2.work_item_id);
      // old_data: State AFTER undo (item is active again)
      expect((steps[0].old_data as WorkItemData)?.is_active).toBe(true);
      // new_data: State BEFORE undo (item was inactive)
      expect((steps[0].new_data as WorkItemData)?.is_active).toBe(false);
    });

    it('should soft delete parent and all descendants recursively', async () => {
      // Setup a dependency link from grandchild1 to child2 to test link deletion cascade
      await testEnvironment.workItemService.updateWorkItem(grandchild1.work_item_id, {}, [
        { depends_on_work_item_id: child2.work_item_id },
      ]);
      const initialDep = await testEnvironment.workItemRepository.findDependencies(grandchild1.work_item_id);
      expect(initialDep[0]?.is_active).toBe(true);

      const initialCount = (await testEnvironment.workItemRepository.findAll({ isActive: true })).length; // Should be 4 active items
      expect(initialCount).toBe(4);

      const descendantIds = [parent.work_item_id, child1.work_item_id, child2.work_item_id, grandchild1.work_item_id];
      const dependencyToCheck = { itemId: grandchild1.work_item_id, dependsOnId: child2.work_item_id };

      // *** Log DB state BEFORE delete ***
      await logDatabaseState(testEnvironment.pool, descendantIds, dependencyToCheck, 'BEFORE DELETE');

      // Delete the parent
      const deletedCount = await testEnvironment.workItemService.deleteWorkItem([parent.work_item_id]);

      // *** Log DB state AFTER delete ***
      await logDatabaseState(testEnvironment.pool, descendantIds, dependencyToCheck, 'AFTER DELETE');

      // *** REVERTED ASSERTION ***
      // Verify count of deleted items matches the full cascade size now
      expect(deletedCount).toBe(descendantIds.length); // Should return 4 once the repo bug is fixed

      // Query each descendant to confirm soft delete (verify the cascade *intent* worked)
      logger.debug('Verifying final state after delete cascade using repository...');
      for (const descendantId of descendantIds) {
        const descendant = await testEnvironment.workItemRepository.findById(descendantId, { isActive: false });
        expect(descendant).toBeDefined(); // This should now pass if the UPDATE worked
        expect(descendant?.is_active).toBe(false);
      }
      logger.debug('Final state verification using repository complete.');

      // Verify active count reduction in DB reflects all items becoming inactive
      const finalCount = (await testEnvironment.workItemRepository.findAll({ isActive: true })).length;
      expect(finalCount).toBe(initialCount - descendantIds.length); // Should be 0, verifying all are inactive now

      // Verify action history for the parent (should reflect the intended scope)
      const history = await testEnvironment.actionHistoryRepository.listRecentActions({
        limit: 10, // Get enough history
      });
      const deleteAction = history.find((h) => h.action_type === 'DELETE_WORK_ITEM_CASCADE');
      expect(deleteAction).toBeDefined();
      expect(deleteAction?.work_item_id).toBe(parent.work_item_id); // Action linked to the initiating item
      expect(deleteAction?.description).toContain(`${descendantIds.length} work item(s)`); // Check intended item count (4)
      expect(deleteAction?.description).toContain('1 related active links'); // Check intended link deletion description

      // Verify undo steps (should reflect the intended scope)
      const steps = await testEnvironment.actionHistoryRepository.findUndoStepsByActionId(deleteAction!.action_id);
      // Expect steps for each intended item + 1 for the dependency link
      expect(steps).toHaveLength(descendantIds.length + 1); // Expect 5 steps
      // Check item steps
      expect(steps.filter((s) => s.table_name === 'work_items').length).toBe(descendantIds.length);
      expect(steps.filter((s) => s.table_name === 'work_items').every((s) => s.step_type === 'UPDATE')).toBe(true);
      // Check dependency link step
      const linkStep = steps.find((s) => s.table_name === 'work_item_dependencies');
      expect(linkStep).toBeDefined();
      expect(linkStep?.step_type).toBe('UPDATE');
      expect(linkStep?.record_id).toBe(`${grandchild1.work_item_id}:${child2.work_item_id}`);
      // old_data: State AFTER undo (link is active again)
      expect((linkStep?.old_data as WorkItemDependencyData)?.is_active).toBe(true);
      // new_data: State BEFORE undo (link was inactive)
      expect((linkStep?.new_data as WorkItemDependencyData)?.is_active).toBe(false);

      // Verify the dependency link itself is inactive (using repository)
      const finalDep = await testEnvironment.workItemRepository.findDependencies(grandchild1.work_item_id, {
        isActive: false, // Fetch inactive links
      });
      expect(finalDep).toHaveLength(1); // Should find the one link
      expect(finalDep[0]?.is_active).toBe(false); // Verify it's inactive
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
