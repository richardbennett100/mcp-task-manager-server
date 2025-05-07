// src/services/__tests__/workItemUpdateIntegration.test.ts
import { setupTestEnvironment, cleanDatabase } from './integrationSetup.js';
import { WorkItemData } from '../../repositories/index.js';
import { UpdateWorkItemInput, FullWorkItemData, ListWorkItemsFilter } from '../WorkItemServiceTypes.js';
import { ValidationError, NotFoundError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

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

  beforeAll(async () => {
    testEnvironment = await setupTestEnvironment();
  });

  beforeEach(async () => {
    await cleanDatabase(testEnvironment.pool);

    // Create a parent item
    parentItem = await testEnvironment.workItemService.addWorkItem({
      name: 'Parent Project For Updates',
    });

    // Create sibling items under the parent for reordering tests
    // Add them sequentially; default behavior should place them at the end
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

    // Verify initial order (A, B, C, D) based on insertion
    const initialOrder = await getOrderedChildIds(parentItem.work_item_id);
    logger.debug(
      `[UpdateTest Setup] Initial items created. Parent: ${parentItem.work_item_id}, Children: ${JSON.stringify(initialOrder)}`
    );
    // Basic check, relies on default add placing at end with increasing order keys
    expect(initialOrder).toEqual([itemA.work_item_id, itemB.work_item_id, itemC.work_item_id, itemD.work_item_id]);
  });

  afterAll(async () => {
    if (testEnvironment.pool) {
      await testEnvironment.pool.end();
    }
  });

  describe('Basic Updates', () => {
    it('should update item basic fields', async () => {
      logger.debug('Test: should update item basic fields - Starting');
      const updates: UpdateWorkItemInput = {
        name: 'Updated Name',
        status: 'in-progress',
      };

      // Use itemB for this test
      const result: FullWorkItemData = await testEnvironment.workItemService.updateWorkItem(
        itemB.work_item_id, // Update itemB
        updates
      );

      expect(result.name).toBe(updates.name);
      expect(result.status).toBe(updates.status);
      expect(result.parent_work_item_id).toBe(parentItem.work_item_id); // Verify parent wasn't changed

      // Check DB directly
      const dbItem = await testEnvironment.workItemRepository.findById(itemB.work_item_id);
      expect(dbItem?.name).toBe(updates.name);
      expect(dbItem?.status).toBe(updates.status);
      logger.debug('Test: should update item basic fields - Finished');
    });

    it('should update parent and recalculate related fields (implicitly moves to end)', async () => {
      logger.debug('Test: should update parent and recalculate related fields - Starting');
      // Create a second parent
      const parent2 = await testEnvironment.workItemService.addWorkItem({ name: 'Parent 2' });

      // Move itemC to parent2
      const updates: UpdateWorkItemInput = {
        parent_work_item_id: parent2.work_item_id,
      };

      const result: FullWorkItemData = await testEnvironment.workItemService.updateWorkItem(
        itemC.work_item_id,
        updates
      );

      expect(result.parent_work_item_id).toBe(parent2.work_item_id);

      // Check DB directly
      const dbItem = await testEnvironment.workItemRepository.findById(itemC.work_item_id);
      expect(dbItem?.parent_work_item_id).toBe(parent2.work_item_id);

      // Verify order in original parent (should be A, B, D)
      const parent1Order = await getOrderedChildIds(parentItem.work_item_id);
      expect(parent1Order).toEqual([itemA.work_item_id, itemB.work_item_id, itemD.work_item_id]);

      // Verify order in new parent (should just be C)
      const parent2Order = await getOrderedChildIds(parent2.work_item_id);
      expect(parent2Order).toEqual([itemC.work_item_id]); // Should be the only item

      logger.debug('Test: should update parent and recalculate related fields - Finished');
    });
  });

  // --- NEW Describe Block for Ordering ---
  describe('Ordering Operations', () => {
    it('should move an item to the start', async () => {
      logger.debug('Test: should move an item to the start - Starting');
      // Move Item C to the start
      const updates: UpdateWorkItemInput = { moveTo: 'start' };
      await testEnvironment.workItemService.updateWorkItem(itemC.work_item_id, updates);

      const finalOrder = await getOrderedChildIds(parentItem.work_item_id);
      expect(finalOrder).toEqual([itemC.work_item_id, itemA.work_item_id, itemB.work_item_id, itemD.work_item_id]);
      logger.debug('Test: should move an item to the start - Finished');
    });

    it('should move an item to the end', async () => {
      logger.debug('Test: should move an item to the end - Starting');
      // Move Item B to the end
      const updates: UpdateWorkItemInput = { moveTo: 'end' };
      await testEnvironment.workItemService.updateWorkItem(itemB.work_item_id, updates);

      const finalOrder = await getOrderedChildIds(parentItem.work_item_id);
      expect(finalOrder).toEqual([itemA.work_item_id, itemC.work_item_id, itemD.work_item_id, itemB.work_item_id]);
      logger.debug('Test: should move an item to the end - Finished');
    });

    it('should move an item after another specific item', async () => {
      logger.debug('Test: should move an item after another specific item - Starting');
      // Initial order: A, B, C, D
      // Move Item A after Item C
      const updates: UpdateWorkItemInput = { moveAfter_work_item_id: itemC.work_item_id };
      await testEnvironment.workItemService.updateWorkItem(itemA.work_item_id, updates);

      const finalOrder = await getOrderedChildIds(parentItem.work_item_id);
      // Expected order: B, C, A, D
      expect(finalOrder).toEqual([itemB.work_item_id, itemC.work_item_id, itemA.work_item_id, itemD.work_item_id]);
      logger.debug('Test: should move an item after another specific item - Finished');
    });

    it('should move an item before another specific item', async () => {
      logger.debug('Test: should move an item before another specific item - Starting');
      // Initial order: A, B, C, D
      // Move Item D before Item B
      const updates: UpdateWorkItemInput = { moveBefore_work_item_id: itemB.work_item_id };
      await testEnvironment.workItemService.updateWorkItem(itemD.work_item_id, updates);

      const finalOrder = await getOrderedChildIds(parentItem.work_item_id);
      // Expected order: A, D, B, C
      expect(finalOrder).toEqual([itemA.work_item_id, itemD.work_item_id, itemB.work_item_id, itemC.work_item_id]);
      logger.debug('Test: should move an item before another specific item - Finished');
    });

    it('should throw error if trying to move relative to non-sibling', async () => {
      logger.debug('Test: should throw error if trying to move relative to non-sibling - Starting');
      const otherParent = await testEnvironment.workItemService.addWorkItem({ name: 'Other Parent' });
      const otherChild = await testEnvironment.workItemService.addWorkItem({
        name: 'Other Child',
        parent_work_item_id: otherParent.work_item_id,
      });

      // Try moving Item A after otherChild (which is under otherParent)
      const updates: UpdateWorkItemInput = { moveAfter_work_item_id: otherChild.work_item_id };

      await expect(testEnvironment.workItemService.updateWorkItem(itemA.work_item_id, updates)).rejects.toThrow(
        NotFoundError
      ); // Expect NotFound because findNeighbourOrderKeys won't find otherChild under parentItem
      await expect(testEnvironment.workItemService.updateWorkItem(itemA.work_item_id, updates)).rejects.toThrow(
        /Reference work item .* not found, not active, or does not belong to parent/
      );

      logger.debug('Test: should throw error if trying to move relative to non-sibling - Finished');
    });

    it('should handle moving the first item after the last', async () => {
      logger.debug('Test: should handle moving the first item after the last - Starting');
      // Initial: A, B, C, D
      // Move A after D
      const updates: UpdateWorkItemInput = { moveAfter_work_item_id: itemD.work_item_id };
      await testEnvironment.workItemService.updateWorkItem(itemA.work_item_id, updates);
      const finalOrder = await getOrderedChildIds(parentItem.work_item_id);
      expect(finalOrder).toEqual([itemB.work_item_id, itemC.work_item_id, itemD.work_item_id, itemA.work_item_id]);
      logger.debug('Test: should handle moving the first item after the last - Finished');
    });

    it('should handle moving the last item before the first', async () => {
      logger.debug('Test: should handle moving the last item before the first - Starting');
      // Initial: A, B, C, D
      // Move D before A
      const updates: UpdateWorkItemInput = { moveBefore_work_item_id: itemA.work_item_id };
      await testEnvironment.workItemService.updateWorkItem(itemD.work_item_id, updates);
      const finalOrder = await getOrderedChildIds(parentItem.work_item_id);
      expect(finalOrder).toEqual([itemD.work_item_id, itemA.work_item_id, itemB.work_item_id, itemC.work_item_id]);
      logger.debug('Test: should handle moving the last item before the first - Finished');
    });
  });
  // --- End Ordering Operations ---

  describe('Dependency Management', () => {
    it('should add, modify, and manage dependencies', async () => {
      // Test remains the same - uses itemA created in beforeEach
      logger.debug('Test: should add, modify, and manage dependencies - Starting');
      const dep1 = await testEnvironment.workItemService.addWorkItem({ name: 'Dependency 1' });
      const dep2 = await testEnvironment.workItemService.addWorkItem({ name: 'Dependency 2' });
      logger.debug(
        'Test: should add, modify, and manage dependencies - Created dep1:',
        dep1.work_item_id,
        'dep2:',
        dep2.work_item_id
      );

      logger.debug('Test: should add, modify, and manage dependencies - Adding initial dependency to dep1 for itemA');
      // Assign initial dependency result, though we might not check it directly
      const initialDepResult: FullWorkItemData = await testEnvironment.workItemService.updateWorkItem(
        itemA.work_item_id,
        {}, // No core updates
        [{ depends_on_work_item_id: dep1.work_item_id, dependency_type: 'finish-to-start' }]
      );
      logger.debug(
        'Test: should add, modify, and manage dependencies - Initial dependency added to item:',
        initialDepResult.work_item_id
      );

      logger.debug('Test: should add, modify, and manage dependencies - Updating dependency to dep2 for itemA');
      // Assign the result of the second update to 'result' and use it for assertions
      const result: FullWorkItemData = await testEnvironment.workItemService.updateWorkItem(
        itemA.work_item_id,
        {}, // No core updates
        [{ depends_on_work_item_id: dep2.work_item_id, dependency_type: 'linked' }] // Set new dependency
      );
      logger.debug(
        'Test: should add, modify, and manage dependencies - Dependency updated to dep2. Resulting item ID:',
        result.work_item_id
      );

      logger.debug(
        'Test: should add, modify, and manage dependencies - Verifying dependencies in the final returned result object.'
      );
      // --- Use the 'result' variable from *this* test ---
      expect(result).toBeDefined();
      expect(result.dependencies).toBeDefined();
      expect(result.dependencies).toHaveLength(1); // Expecting only the active dependency (dep2)
      expect(result.dependencies[0].depends_on_work_item_id).toBe(dep2.work_item_id);
      expect(result.dependencies[0].dependency_type).toBe('linked');
      expect(result.dependencies[0].is_active).toBe(true);
      logger.debug('Test: should add, modify, and manage dependencies - Result object verification complete.');

      logger.debug(
        'Test: should add, modify, and manage dependencies - Fetching all dependencies from DB for itemA for final check.'
      );
      // Fetch dependencies directly from DB to verify inactive ones
      // const dbDependencies = await testEnvironment.workItemRepository.findDependencies(itemA.work_item_id, {
      //   isActive: false,
      // }); // Fetch ALL
      // logger.debug(
      //   'Test: should add, modify, and manage dependencies - Fetched DB dependencies:',
      //   dbDependencies.length
      // );

      // const activeDeps = dbDependencies.filter((d) => d.is_active);
      // const inactiveDeps = dbDependencies.filter((d) => !d.is_active);
      // Fetch active dependencies directly from DB
      const activeDeps = await testEnvironment.workItemRepository.findDependencies(itemA.work_item_id, {
        isActive: true, // Fetch only active links
      });
      // Fetch inactive dependencies directly from DB
      const inactiveDeps = await testEnvironment.workItemRepository.findDependencies(itemA.work_item_id, {
        isActive: false, // Fetch only inactive links
      });

      logger.debug(
        'Test: should add, modify, and manage dependencies - Filtered DB dependencies. Active:',
        activeDeps.length,
        'Inactive:',
        inactiveDeps.length
      );

      // Assertions on the final DB state
      expect(activeDeps).toHaveLength(1);
      expect(activeDeps[0].depends_on_work_item_id).toBe(dep2.work_item_id);
      expect(activeDeps[0].dependency_type).toBe('linked');

      expect(inactiveDeps).toHaveLength(1);
      expect(inactiveDeps[0].depends_on_work_item_id).toBe(dep1.work_item_id);
      expect(inactiveDeps[0].dependency_type).toBe('finish-to-start'); // Verify original type was preserved
      logger.debug('Test: should add, modify, and manage dependencies - Finished');
    });
  });

  describe('Error Handling', () => {
    it('should handle updates to non-existent parent', async () => {
      // Test remains the same - uses itemA
      logger.debug('Test: should handle updates to non-existent parent - Starting');
      const nonExistentParentId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

      await expect(
        testEnvironment.workItemService.updateWorkItem(itemA.work_item_id, { parent_work_item_id: nonExistentParentId })
      ).rejects.toThrow(ValidationError);
      await expect(
        testEnvironment.workItemService.updateWorkItem(itemA.work_item_id, { parent_work_item_id: nonExistentParentId })
      ).rejects.toThrow(/not found or is inactive/);
      logger.debug('Test: should handle updates to non-existent parent - Finished');
    });

    it('should not create history for no-change updates', async () => {
      // Test remains the same - uses itemA
      logger.debug('Test: should not create history for no-change updates - Starting');
      const initialHistoryCount = (await testEnvironment.actionHistoryRepository.listRecentActions({})).length;

      // Fetch original item state AFTER setup
      const originalItem = await testEnvironment.workItemService.getWorkItemById(itemA.work_item_id);
      expect(originalItem).not.toBeNull();

      // Perform an update with no actual changes
      /* const result = await testEnvironment.workItemService.updateWorkItem(
        itemA.work_item_id,
        {}, // No core field updates
        undefined // No dependency updates
      );*/

      // Fetch the state again for comparison
      const finalItemState = await testEnvironment.workItemService.getWorkItemById(itemA.work_item_id);
      expect(finalItemState).toEqual(originalItem); // Expect entire object (including order_key etc.) to be unchanged

      // Verify history count hasn't increased beyond the initial setup actions
      const finalHistoryCount = (await testEnvironment.actionHistoryRepository.listRecentActions({})).length;
      // Count actions *after* the initial add actions for itemA, B, C, D
      const actionsAfterSetup = finalHistoryCount - initialHistoryCount;
      expect(actionsAfterSetup).toBe(0); // No new UPDATE action should have been created

      logger.debug('Test: should not create history for no-change updates - Finished');
    });
  });
});
