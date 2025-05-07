// src/services/__tests__/workItemPromoteIntegration.test.ts
import { setupTestEnvironment, cleanDatabase } from './integrationSetup.js';
import { type WorkItemData } from '../../repositories/index.js';
import { type FullWorkItemData } from '../WorkItemServiceTypes.js';
import { ValidationError, NotFoundError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

describe('WorkItemService - Promote to Project Integration Tests', () => {
  let testEnvironment: Awaited<ReturnType<typeof setupTestEnvironment>>;
  let originalParent: WorkItemData;
  let taskToPromote: WorkItemData;
  let siblingTask: WorkItemData;

  beforeAll(async () => {
    testEnvironment = await setupTestEnvironment();
  });

  beforeEach(async () => {
    await cleanDatabase(testEnvironment.pool);

    originalParent = await testEnvironment.workItemService.addWorkItem({
      name: 'Original Parent Project',
      priority: 'high',
    });

    taskToPromote = await testEnvironment.workItemService.addWorkItem({
      name: 'Task To Be Promoted',
      parent_work_item_id: originalParent.work_item_id,
      description: 'This task will become a project.',
      priority: 'medium',
    });

    siblingTask = await testEnvironment.workItemService.addWorkItem({
      name: 'Sibling Task',
      parent_work_item_id: originalParent.work_item_id,
      priority: 'low',
    });
    logger.debug(
      `[PromoteTest Setup] Created originalParent: ${originalParent.work_item_id}, taskToPromote: ${taskToPromote.work_item_id}, siblingTask: ${siblingTask.work_item_id}`
    );
  });

  afterAll(async () => {
    if (testEnvironment.pool) {
      await testEnvironment.pool.end();
    }
  });

  describe('Successful Promotion', () => {
    it('should promote a task to a root project and create a link-back dependency', async () => {
      const promotedItem: FullWorkItemData = await testEnvironment.workItemService.promoteToProject(
        taskToPromote.work_item_id
      );

      expect(promotedItem).toBeDefined();
      expect(promotedItem.work_item_id).toBe(taskToPromote.work_item_id);
      expect(promotedItem.parent_work_item_id).toBeNull();
      expect(promotedItem.name).toBe('Task To Be Promoted');

      const rootItems = await testEnvironment.workItemService.listWorkItems({
        rootsOnly: true,
      });
      expect(rootItems.some((item) => item.work_item_id === promotedItem.work_item_id)).toBe(true);

      const originalParentDetails = await testEnvironment.workItemService.getWorkItemById(originalParent.work_item_id);
      expect(originalParentDetails).toBeDefined();
      expect(originalParentDetails!.dependencies).toBeDefined();
      const linkBack = originalParentDetails!.dependencies.find(
        (dep) => dep.depends_on_work_item_id === promotedItem.work_item_id
      );
      expect(linkBack).toBeDefined();
      expect(linkBack!.dependency_type).toBe('linked');
      expect(linkBack!.is_active).toBe(true);
      expect(linkBack!.work_item_id).toBe(originalParent.work_item_id);

      const originalParentChildren = await testEnvironment.workItemService.listWorkItems({
        parent_work_item_id: originalParent.work_item_id,
      });
      expect(originalParentChildren.some((child) => child.work_item_id === taskToPromote.work_item_id)).toBe(false);
      expect(originalParentChildren.length).toBe(1);
      expect(originalParentChildren[0].work_item_id).toBe(siblingTask.work_item_id);

      const history = await testEnvironment.actionHistoryRepository.listRecentActions({
        limit: 10,
      });

      const promoteAction = history.find(
        (action) => action.action_type === 'PROMOTE_TO_PROJECT' && action.work_item_id === taskToPromote.work_item_id
      );
      expect(promoteAction).toBeDefined();
      expect(promoteAction!.description).toContain('Promoted task');
      expect(promoteAction!.is_undone).toBe(false);

      const addDepsActionForLinkBack = history.find(
        (action) =>
          action.action_type === 'ADD_DEPENDENCIES' &&
          action.work_item_id === originalParent.work_item_id &&
          action.description?.includes(originalParent.name) &&
          action.description?.includes('1 dependencies')
      );
      expect(addDepsActionForLinkBack).toBeDefined();
    });

    it('should correctly update order_key upon promotion', async () => {
      const itemBefore = await testEnvironment.workItemService.getWorkItemById(taskToPromote.work_item_id);
      expect(itemBefore).not.toBeNull();

      const promotedItem: FullWorkItemData = await testEnvironment.workItemService.promoteToProject(
        taskToPromote.work_item_id
      );

      expect(promotedItem.order_key).not.toBe(itemBefore!.order_key);
      expect(typeof promotedItem.order_key).toBe('string');
      // REMOVED shortname assertions
    });
  });

  describe('Error Handling', () => {
    it('should throw ValidationError if trying to promote an item that is already a root project', async () => {
      await expect(testEnvironment.workItemService.promoteToProject(originalParent.work_item_id)).rejects.toThrow(
        ValidationError
      );
      await expect(testEnvironment.workItemService.promoteToProject(originalParent.work_item_id)).rejects.toThrow(
        /is already a top-level project/
      );
    });

    it('should throw NotFoundError if trying to promote a non-existent work_item_id', async () => {
      const nonExistentId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
      await expect(testEnvironment.workItemService.promoteToProject(nonExistentId)).rejects.toThrow(NotFoundError);
    });

    it('should throw ValidationError if trying to promote an inactive task', async () => {
      await testEnvironment.workItemService.deleteWorkItem([taskToPromote.work_item_id]);

      await expect(testEnvironment.workItemService.promoteToProject(taskToPromote.work_item_id)).rejects.toThrow(
        ValidationError
      );
      await expect(testEnvironment.workItemService.promoteToProject(taskToPromote.work_item_id)).rejects.toThrow(
        /is inactive and cannot be promoted/
      );
    });
  });

  describe('Undo/Redo for Promotion', () => {
    it('should correctly undo and redo a task promotion', async () => {
      const originalTaskState = await testEnvironment.workItemService.getWorkItemById(taskToPromote.work_item_id);
      expect(originalTaskState).not.toBeNull();

      await testEnvironment.workItemService.promoteToProject(taskToPromote.work_item_id);

      // Undo PROMOTE_TO_PROJECT action first
      let lastUndoAction = await testEnvironment.workItemService.undoLastAction();
      expect(lastUndoAction).toBeDefined();
      expect(lastUndoAction!.action_type).toBe('PROMOTE_TO_PROJECT'); // Corrected
      expect(lastUndoAction!.is_undone).toBe(true);

      const taskAfterFirstUndo = await testEnvironment.workItemService.getWorkItemById(taskToPromote.work_item_id);
      expect(taskAfterFirstUndo).toBeDefined();
      expect(taskAfterFirstUndo!.parent_work_item_id).toBe(originalParent.work_item_id);
      expect(taskAfterFirstUndo!.order_key).toBe(originalTaskState!.order_key);
      // REMOVED shortname assertion

      let parentAfterFirstUndo = await testEnvironment.workItemService.getWorkItemById(originalParent.work_item_id);
      let linkBackDepAfterFirstUndo = parentAfterFirstUndo!.dependencies.find(
        (d) => d.depends_on_work_item_id === taskToPromote.work_item_id
      );
      // The PROMOTE_TO_PROJECT undo step should ensure the link it intended to create is undone (made inactive or removed)
      // If dependencyUpdateService.addDependencies created an *active* link, the PROMOTE action's undo step
      // for the dependency should make it inactive.
      expect(linkBackDepAfterFirstUndo?.is_active ?? false).toBe(false);

      // Undo the ADD_DEPENDENCIES action (created by internal call to dependencyUpdateService)
      lastUndoAction = await testEnvironment.workItemService.undoLastAction();
      expect(lastUndoAction).toBeDefined();
      expect(lastUndoAction!.action_type).toBe('ADD_DEPENDENCIES'); // Corrected
      expect(lastUndoAction!.is_undone).toBe(true);

      parentAfterFirstUndo = // Re-fetch
        await testEnvironment.workItemService.getWorkItemById(originalParent.work_item_id);
      linkBackDepAfterFirstUndo = parentAfterFirstUndo!.dependencies.find(
        (d) => d.depends_on_work_item_id === taskToPromote.work_item_id
      );
      expect(linkBackDepAfterFirstUndo?.is_active ?? false).toBe(false);

      // Redo ADD_DEPENDENCIES action first
      let lastRedoAction = await testEnvironment.workItemService.redoLastUndo();
      expect(lastRedoAction).toBeDefined();
      expect(lastRedoAction!.action_type).toBe('ADD_DEPENDENCIES');
      expect(lastRedoAction!.is_undone).toBe(false);

      const parentAfterFirstRedo = await testEnvironment.workItemService.getWorkItemById(originalParent.work_item_id);
      const linkBackDepAfterFirstRedo = parentAfterFirstRedo!.dependencies.find(
        (d) => d.depends_on_work_item_id === taskToPromote.work_item_id
      );
      expect(linkBackDepAfterFirstRedo).toBeDefined();
      expect(linkBackDepAfterFirstRedo!.is_active).toBe(true);

      // Redo PROMOTE_TO_PROJECT action
      lastRedoAction = await testEnvironment.workItemService.redoLastUndo();
      expect(lastRedoAction).toBeDefined();
      expect(lastRedoAction!.action_type).toBe('PROMOTE_TO_PROJECT');
      expect(lastRedoAction!.is_undone).toBe(false);

      const taskAfterSecondRedo = await testEnvironment.workItemService.getWorkItemById(taskToPromote.work_item_id);
      expect(taskAfterSecondRedo).toBeDefined();
      expect(taskAfterSecondRedo!.parent_work_item_id).toBeNull();
      expect(taskAfterSecondRedo!.order_key).not.toBe(originalTaskState!.order_key);
      // REMOVED shortname assertion
    });
  });
});
