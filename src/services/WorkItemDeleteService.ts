// src/services/WorkItemDeleteService.ts
import { PoolClient } from 'pg';
import {
  WorkItemRepository, // Import main repo class
  ActionHistoryRepository, // Import main repo class
  WorkItemData, // Import WorkItemData
  WorkItemDependencyData, // Import WorkItemDependencyData
  CreateActionHistoryInput,
  CreateUndoStepInput,
} from '../repositories/index.js'; // USE BARREL FILE
import { logger } from '../utils/logger.js';
import { WorkItemHistoryService } from './WorkItemHistoryService.js'; // Import HistoryService
import { validate as uuidValidate } from 'uuid';

/**
 * Service responsible for deleting work items
 */
export class WorkItemDeleteService {
  private workItemRepository: WorkItemRepository;
  private actionHistoryRepository: ActionHistoryRepository;
  private historyService: WorkItemHistoryService; // Add history service instance

  constructor(workItemRepository: WorkItemRepository, actionHistoryRepository: ActionHistoryRepository) {
    this.workItemRepository = workItemRepository;
    this.actionHistoryRepository = actionHistoryRepository;
    // Instantiate history service needed for invalidateRedoStack
    this.historyService = new WorkItemHistoryService(workItemRepository, actionHistoryRepository);
  }

  /**
   * Soft deletes work items and their dependencies recursively.
   * Returns the count of work items actually marked as inactive by the repository operation.
   */
  public async deleteWorkItem(ids: string[]): Promise<number> {
    if (!ids || ids.length === 0 || !ids.every(uuidValidate)) {
      logger.warn('[WorkItemDeleteService] deleteWorkItem called with empty or invalid ID array.');
      return 0;
    }

    logger.warn(
      `[WorkItemDeleteService] Attempting to soft delete ${ids.length} work item(s) and cascade: ${ids.join(', ')}`
    );
    let actualDeletedItemCount = 0; // Count reported by repo
    let totalDeletedDepsCount = 0; // Track deleted deps count
    let activeItemsInCascade: WorkItemData[] = []; // Store the active items found

    await this.actionHistoryRepository.withTransaction(async (client) => {
      const allItemIdsToDeleteSet: Set<string> = new Set(ids); // Start with initial IDs
      const queue: string[] = [...ids];
      const visitedForDescendants: Set<string> = new Set(ids);

      // 1. Find all descendant IDs recursively using BFS approach
      logger.debug('[WorkItemDeleteService] Finding all descendants...');
      while (queue.length > 0) {
        const currentId = queue.shift()!;
        // Fetch direct children IDs only (active or inactive for full cascade)
        const children = await this.workItemRepository.findChildren(
          currentId,
          { isActive: false }, // Find all children regardless of status
          client
        );
        for (const child of children) {
          if (!visitedForDescendants.has(child.work_item_id)) {
            visitedForDescendants.add(child.work_item_id);
            allItemIdsToDeleteSet.add(child.work_item_id); // Add descendant ID
            queue.push(child.work_item_id); // Add to queue to find its descendants
          }
        }
      }
      const itemsToDeleteArray = Array.from(allItemIdsToDeleteSet); // Now use the Set
      logger.debug(
        `[WorkItemDeleteService DIAG] Full cascade list (${itemsToDeleteArray.length} items) identified: ${itemsToDeleteArray.join(', ')}`
      );

      // 2. Find *all* dependency links involving these items (before deletion)
      const affectedLinks = await this.findLinksToDeactivate(itemsToDeleteArray, client);

      // 3. Get current state of ACTIVE items and links for undo history
      // Find which items in the full cascade list are currently active
      activeItemsInCascade = await this.workItemRepository.findByIds(itemsToDeleteArray, { isActive: true }, client);
      const activeItemsInCascadeCount = activeItemsInCascade.length; // Get the count
      logger.debug(
        `[WorkItemDeleteService DIAG] Found ${activeItemsInCascadeCount} active items in cascade list for deletion.`
      );

      const activeLinksCompositeKeys = affectedLinks
        .filter((dep) => dep.is_active) // Find links that are currently active
        .map((d) => ({
          work_item_id: d.work_item_id,
          depends_on_work_item_id: d.depends_on_work_item_id,
        }));
      const linksOldData =
        activeLinksCompositeKeys.length > 0
          ? await this.workItemRepository.findDependenciesByCompositeKeys(
              activeLinksCompositeKeys,
              { isActive: true }, // Get the state of currently active links
              client
            )
          : [];

      // 4. Perform the soft deletions only on the items identified as active
      const activeItemIdsToDelete = activeItemsInCascade.map((item) => item.work_item_id);

      // --- ADDED LOGGING HERE ---
      logger.debug(
        `[WorkItemDeleteService DIAG] Items identified in cascade (all):`,
        Array.from(allItemIdsToDeleteSet)
      );
      logger.debug(`[WorkItemDeleteService DIAG] Active items to delete (filtered):`, activeItemIdsToDelete);
      // --- END ADDED LOGGING ---

      logger.debug(
        `[WorkItemDeleteService DIAG] Attempting to soft delete these active item IDs: ${activeItemIdsToDelete.join(', ')}`
      );

      if (activeItemIdsToDelete.length > 0) {
        // Store the actual count returned by the repository method
        actualDeletedItemCount = await this.workItemRepository.softDelete(activeItemIdsToDelete, client);
        logger.info(`[WorkItemDeleteService] Repository reported ${actualDeletedItemCount} work item(s) soft deleted.`);
        // Check if the actual deleted count matches the expected count
        if (actualDeletedItemCount !== activeItemsInCascadeCount) {
          logger.warn(
            `[WorkItemDeleteService] Mismatch: Expected to delete ${activeItemsInCascadeCount} active items, but repository reported ${actualDeletedItemCount} deleted.`
          );
        }
      } else {
        actualDeletedItemCount = 0; // Ensure count is 0 if no active items
        logger.info('[WorkItemDeleteService] No active work items found in the cascade list to soft delete.');
      }

      if (activeLinksCompositeKeys.length > 0) {
        totalDeletedDepsCount = // Store the count
          await this.workItemRepository.softDeleteDependenciesByCompositeKeys(activeLinksCompositeKeys, client);
        logger.info(`[WorkItemDeleteService] Soft deleted ${totalDeletedDepsCount} active dependency link(s).`);
      } else {
        totalDeletedDepsCount = 0; // Ensure count is 0
        logger.info('[WorkItemDeleteService] No active dependency links found to soft delete within the cascade.');
      }

      // 5. Record history for undoing (only if something was actually changed)
      // Use the count of *active items found* in the description, as that's what the user conceptually deleted
      if (activeItemsInCascadeCount > 0 || totalDeletedDepsCount > 0) {
        const actionDescription = `Deleted ${activeItemsInCascadeCount} work item(s) and ${totalDeletedDepsCount} related active links (cascade)`;
        const actionData: CreateActionHistoryInput = {
          user_id: null, // User ID removed
          action_type: 'DELETE_WORK_ITEM_CASCADE',
          work_item_id: ids.length === 1 ? ids[0] : null,
          description: actionDescription,
        };

        const undoStepsData: CreateUndoStepInput[] = [];
        let stepOrder = 1;

        // Undo steps for items: Use the activeItemsInCascade data for old state
        activeItemsInCascade.forEach((item) => {
          // Only record undo step if this item was actually changed by softDelete?
          // For simplicity now, assume if it was found active and part of cascade,
          // an undo step is needed to restore it.
          // A more robust way might check if item.work_item_id is in the list of *actually* deleted IDs.
          // old_data: State AFTER undo (item is active again)
          // new_data: State BEFORE undo (item was inactive)
          const itemStateAfterUndo: WorkItemData = { ...item, is_active: true }; // State after undo (active)
          const itemStateBeforeUndo: WorkItemData = { ...item, is_active: false }; // State before undo (inactive)

          undoStepsData.push({
            step_order: stepOrder++,
            step_type: 'UPDATE', // Undo involves updating is_active back to true
            table_name: 'work_items',
            record_id: item.work_item_id,
            old_data: itemStateAfterUndo as WorkItemData, // Using WorkItemData type assertion
            new_data: itemStateBeforeUndo as WorkItemData, // Using WorkItemData type assertion
          });
        });

        // Undo steps for dependency links: Use linksOldData
        linksOldData.forEach((dep) => {
          const depRecordId = `${dep.work_item_id}:${dep.depends_on_work_item_id}`;
          // old_data: State AFTER undo (dependency is active again)
          // new_data: State BEFORE undo (dependency was inactive)
          const depStateAfterUndo: WorkItemDependencyData = { ...dep, is_active: true }; // State after undo (active)
          const depStateBeforeUndo: WorkItemDependencyData = { ...dep, is_active: false }; // State before undo (inactive)

          undoStepsData.push({
            step_order: stepOrder++,
            step_type: 'UPDATE', // Undo involves updating is_active back to true
            table_name: 'work_item_dependencies',
            record_id: depRecordId,
            old_data: depStateAfterUndo as WorkItemDependencyData, // Using WorkItemDependencyData type assertion
            new_data: depStateBeforeUndo as WorkItemDependencyData, // Using WorkItemDependencyData type assertion
          });
        });

        // Create action and steps in DB
        const createdAction = await this.actionHistoryRepository.createActionInClient(actionData, client);
        for (const step of undoStepsData) {
          await this.actionHistoryRepository.createUndoStepInClient(
            { ...step, action_id: createdAction.action_id },
            client
          );
        }

        // invalidateRedoStack IS correctly called after DELETE
        await this.historyService.invalidateRedoStack(client, createdAction.action_id);
        logger.info(`[WorkItemDeleteService] Recorded history for delete action ${createdAction.action_id}.`);
      } else {
        logger.info('[WorkItemDeleteService] No active items or links were deleted, skipping history recording.');
      }
    }); // End Transaction

    // FIX: Return the count reported by the repository, reflecting actual DB changes.
    logger.debug(`[WorkItemDeleteService] Returning count: ${actualDeletedItemCount} (based on repository rowCount)`);
    return actualDeletedItemCount;
  }

  /** Helper to find all dependency links (active or inactive) involving the items being deleted */
  private async findLinksToDeactivate(itemIds: string[], client: PoolClient): Promise<WorkItemDependencyData[]> {
    if (itemIds.length === 0) return [];

    // Find dependencies where itemIds are the source
    const outgoingDeps = await this.workItemRepository.findDependenciesByItemList(
      itemIds,
      { isActive: false }, // Check all links, regardless of status
      client
    );

    // Find dependencies where itemIds are the target
    const incomingDeps = await this.workItemRepository.findDependentsByItemList(
      itemIds,
      { isActive: false }, // Check all links, regardless of status
      client
    );

    // Combine and deduplicate
    const allLinksMap = new Map<string, WorkItemDependencyData>();
    [...outgoingDeps, ...incomingDeps].forEach((dep) => {
      const key = `${dep.work_item_id}:${dep.depends_on_work_item_id}`;
      if (!allLinksMap.has(key)) {
        allLinksMap.set(key, dep);
      }
    });
    logger.debug(
      `[WorkItemDeleteService] Identified ${allLinksMap.size} potentially affected dependency links for cascade delete.`
    );
    return Array.from(allLinksMap.values());
  }
}
