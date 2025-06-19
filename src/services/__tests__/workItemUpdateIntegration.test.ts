// src/services/__tests__/workItemUpdateIntegration.test.ts
import { setupTestEnvironment, cleanDatabase } from './integrationSetup.js';
import { type WorkItemData } from '../../repositories/index.js';
import { type UpdateWorkItemInput, type FullWorkItemData, type ListWorkItemsFilter } from '../WorkItemServiceTypes.js';
import { AppError } from '../../utils/errors.js';
// import { logger } from '../../utils/logger.js'; // REMOVED

describe('WorkItemService - Update Work Item Integration Tests', () => {
  let testEnvironment: Awaited<ReturnType<typeof setupTestEnvironment>>;
  let parentItem: WorkItemData;
  // Items for reordering tests
  let itemA: WorkItemData, itemB: WorkItemData, itemC: WorkItemData, itemD: WorkItemData;

  // Helper function to get ordered list of child IDs
  const getOrderedChildIds = async (parentId: string | null): Promise<string[]> => {
    const filter: ListWorkItemsFilter = parentId ? { parent_work_item_id: parentId } : { rootsOnly: true };
    filter.isActive = true; // Ensure we only list active items for order checking
    const items = await testEnvironment.workItemService.listWorkItems(filter);
    // Assuming listWorkItems returns items sorted by order_key
    return items.map((item) => item.work_item_id);
  };

  beforeEach(async () => {
    testEnvironment = await setupTestEnvironment();
    await cleanDatabase(testEnvironment.pool);

    // Create a parent item
    parentItem = await testEnvironment.workItemService.addWorkItem({
      name: 'Parent Project For Updates',
    });

    // Create sibling items under the parent for reordering tests
    itemA = await testEnvironment.workItemService.addWorkItem({
      name: 'Item A',
      parent_work_item_id: parentItem.work_item_id,
    });
    itemB = await testEnvironment.workItemService.addWorkItem({
      name: 'Item B',
      parent_work_item_id: parentItem.work_item_id,
    });
    itemC = await testEnvironment.workItemService.addWorkItem({
      name: 'Item C',
      parent_work_item_id: parentItem.work_item_id,
    });
    itemD = await testEnvironment.workItemService.addWorkItem({
      name: 'Item D',
      parent_work_item_id: parentItem.work_item_id,
    });

    const initialOrder = await getOrderedChildIds(parentItem.work_item_id);
    expect(initialOrder).toEqual([itemA.work_item_id, itemB.work_item_id, itemC.work_item_id, itemD.work_item_id]);
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
        status: 'in-progress',
      };
      const result: FullWorkItemData = await testEnvironment.workItemService.updateWorkItem(
        itemB.work_item_id,
        updates
      );
      expect(result.name).toBe(updates.name);
      expect(result.status).toBe(updates.status);
    });

    it('should update parent and recalculate related fields (implicitly moves to end)', async () => {
      const parent2 = await testEnvironment.workItemService.addWorkItem({ name: 'Parent 2' });
      const updates: UpdateWorkItemInput = {
        parent_work_item_id: parent2.work_item_id,
      };
      const result: FullWorkItemData = await testEnvironment.workItemService.updateWorkItem(
        itemC.work_item_id,
        updates
      );
      expect(result.parent_work_item_id).toBe(parent2.work_item_id);
      const parent1Order = await getOrderedChildIds(parentItem.work_item_id);
      expect(parent1Order).toEqual([itemA.work_item_id, itemB.work_item_id, itemD.work_item_id]);
      const parent2Order = await getOrderedChildIds(parent2.work_item_id);
      expect(parent2Order).toEqual([itemC.work_item_id]);
    });
  });

  describe('Ordering Operations', () => {
    it('should move an item to the start', async () => {
      const updates: UpdateWorkItemInput = { moveTo: 'start' };
      await testEnvironment.workItemService.updateWorkItem(itemC.work_item_id, updates);
      const finalOrder = await getOrderedChildIds(parentItem.work_item_id);
      expect(finalOrder).toEqual([itemC.work_item_id, itemA.work_item_id, itemB.work_item_id, itemD.work_item_id]);
    });

    it('should move an item to the end', async () => {
      const updates: UpdateWorkItemInput = { moveTo: 'end' };
      await testEnvironment.workItemService.updateWorkItem(itemB.work_item_id, updates);
      const finalOrder = await getOrderedChildIds(parentItem.work_item_id);
      expect(finalOrder).toEqual([itemA.work_item_id, itemC.work_item_id, itemD.work_item_id, itemB.work_item_id]);
    });

    it('should move an item after another specific item', async () => {
      const updates: UpdateWorkItemInput = { moveAfter_work_item_id: itemC.work_item_id };
      await testEnvironment.workItemService.updateWorkItem(itemA.work_item_id, updates);
      const finalOrder = await getOrderedChildIds(parentItem.work_item_id);
      expect(finalOrder).toEqual([itemB.work_item_id, itemC.work_item_id, itemA.work_item_id, itemD.work_item_id]);
    });

    it('should move an item before another specific item', async () => {
      const updates: UpdateWorkItemInput = { moveBefore_work_item_id: itemB.work_item_id };
      await testEnvironment.workItemService.updateWorkItem(itemD.work_item_id, updates);
      const finalOrder = await getOrderedChildIds(parentItem.work_item_id);
      expect(finalOrder).toEqual([itemA.work_item_id, itemD.work_item_id, itemB.work_item_id, itemC.work_item_id]);
    });

    it('should throw error if trying to move relative to non-sibling', async () => {
      const otherParent = await testEnvironment.workItemService.addWorkItem({ name: 'Other Parent' });
      const otherChild = await testEnvironment.workItemService.addWorkItem({
        name: 'Other Child',
        parent_work_item_id: otherParent.work_item_id,
      });
      const updates: UpdateWorkItemInput = { moveAfter_work_item_id: otherChild.work_item_id };

      try {
        await testEnvironment.workItemService.updateWorkItem(itemA.work_item_id, updates);
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error).toBeInstanceOf(AppError);
        expect(error.errorCode).toBe('NotFound');
      }
    });

    it('should handle moving the first item after the last', async () => {
      const updates: UpdateWorkItemInput = { moveAfter_work_item_id: itemD.work_item_id };
      await testEnvironment.workItemService.updateWorkItem(itemA.work_item_id, updates);
      const finalOrder = await getOrderedChildIds(parentItem.work_item_id);
      expect(finalOrder).toEqual([itemB.work_item_id, itemC.work_item_id, itemD.work_item_id, itemA.work_item_id]);
    });

    it('should handle moving the last item before the first', async () => {
      const updates: UpdateWorkItemInput = { moveBefore_work_item_id: itemA.work_item_id };
      await testEnvironment.workItemService.updateWorkItem(itemD.work_item_id, updates);
      const finalOrder = await getOrderedChildIds(parentItem.work_item_id);
      expect(finalOrder).toEqual([itemD.work_item_id, itemA.work_item_id, itemB.work_item_id, itemC.work_item_id]);
    });
  });

  describe('Dependency Management', () => {
    it('should add, modify, and manage dependencies', async () => {
      const dep1 = await testEnvironment.workItemService.addWorkItem({ name: 'Dependency 1' });
      const dep2 = await testEnvironment.workItemService.addWorkItem({ name: 'Dependency 2' });

      // **THE FIX**: Removed unused variable assignment
      await testEnvironment.workItemService.updateWorkItem(itemA.work_item_id, {}, [
        { depends_on_work_item_id: dep1.work_item_id, dependency_type: 'finish-to-start' },
      ]);

      const result: FullWorkItemData = await testEnvironment.workItemService.updateWorkItem(itemA.work_item_id, {}, [
        { depends_on_work_item_id: dep2.work_item_id, dependency_type: 'linked' },
      ]);

      expect(result.dependencies).toHaveLength(1);
      expect(result.dependencies[0].depends_on_work_item_id).toBe(dep2.work_item_id);
    });
  });

  describe('Error Handling', () => {
    it('should handle updates to non-existent parent', async () => {
      const nonExistentParentId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

      try {
        await testEnvironment.workItemService.updateWorkItem(itemA.work_item_id, {
          parent_work_item_id: nonExistentParentId,
        });
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error).toBeInstanceOf(AppError);
        expect(error.errorCode).toBe('ValidationError');
        expect(error.message).toContain('not found or is inactive');
      }
    });

    it('should not create history for no-change updates', async () => {
      const initialHistoryCount = (await testEnvironment.actionHistoryRepository.listRecentActions({})).length;
      await testEnvironment.workItemService.updateWorkItem(itemA.work_item_id, {});
      const finalHistoryCount = (await testEnvironment.actionHistoryRepository.listRecentActions({})).length;
      expect(finalHistoryCount).toBe(initialHistoryCount);
    });
  });
});
