// src/services/WorkItemDeleteService.ts
import { PoolClient, Pool } from 'pg'; // Import Pool
import {
  WorkItemRepository, // Import main repo class
  ActionHistoryRepository, // Import main repo class
  WorkItemData, // Import WorkItemData
  WorkItemDependencyData, // Import WorkItemDependencyData
  CreateActionHistoryInput,
  CreateUndoStepInput,
} from '../repositories/index.js';
import { logger } from '../utils/logger.js';
import { WorkItemHistoryService } from './WorkItemHistoryService.js';
import { validate as uuidValidate } from 'uuid';

/**
 * Service responsible for deleting work items
 */
export class WorkItemDeleteService {
  private workItemRepository: WorkItemRepository;
  private actionHistoryRepository: ActionHistoryRepository;
  private historyService: WorkItemHistoryService;
  private pool: Pool; // Store pool instance

  constructor(workItemRepository: WorkItemRepository, actionHistoryRepository: ActionHistoryRepository) {
    this.workItemRepository = workItemRepository;
    this.actionHistoryRepository = actionHistoryRepository;
    // Defer historyService initialization to avoid circular dependency if HistoryService uses DeleteService
    // This assumes HistoryService does not directly depend on DeleteService methods during its own construction.
    // If it does, a different approach (like a setter method or passing factory function) might be needed.
    // For now, initializing later within methods or assuming no direct circular constructor dependency.
    // Let's initialize it here assuming no direct constructor cycle:
    this.historyService = new WorkItemHistoryService(workItemRepository, actionHistoryRepository);
    this.pool = workItemRepository.getPool(); // Get pool from repository
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

    let actualDeletedItemCount = 0;
    let totalDeactivatedDepsCount = 0;
    const deletedItemIds: string[] = []; // Track IDs actually deleted
    const deactivatedLinkKeys: { work_item_id: string; depends_on_work_item_id: string }[] = []; // Track links actually deactivated
    const itemsToDeleteBeforeState: WorkItemData[] = []; // Capture state BEFORE delete
    const linksToDeleteBeforeState: WorkItemDependencyData[] = []; // Capture state BEFORE delete

    // Determine all items to delete (including descendants) *before* the transaction
    const allItemIdsToDeleteSet: Set<string> = new Set();
    // Add initial IDs
    ids.forEach((id) => allItemIdsToDeleteSet.add(id));

    // Use a temporary client outside transaction just for finding descendants
    const tempClient = await this.pool.connect();
    try {
      const itemsToQuery = [...allItemIdsToDeleteSet]; // Start with the initial set
      const visited = new Set<string>(itemsToQuery); // Track visited to avoid cycles/redundancy
      const queue = [...itemsToQuery]; // Queue for BFS

      while (queue.length > 0) {
        const currentId = queue.shift()!;
        // Find ALL children (active or inactive), as we need to include them in the potential delete scope
        const children = await this.workItemRepository.findChildren(currentId, { isActive: undefined }); // Find all regardless of status

        for (const child of children) {
          if (!visited.has(child.work_item_id)) {
            visited.add(child.work_item_id);
            allItemIdsToDeleteSet.add(child.work_item_id); // Add descendant ID
            queue.push(child.work_item_id); // Add to queue for further traversal
          }
        }
      }
    } catch (descError) {
      logger.error('[WorkItemDeleteService] Error finding descendants before transaction:', descError);
      throw descError; // Rethrow to prevent proceeding
    } finally {
      tempClient.release();
    }
    const itemsToDeleteArray = Array.from(allItemIdsToDeleteSet);

    logger.debug(
      `[WorkItemDeleteService DEBUG] All item IDs identified for potential deletion (${itemsToDeleteArray.length}): ${itemsToDeleteArray.join(', ')}`
    );

    // Start transaction
    await this.actionHistoryRepository.withTransaction(async (client) => {
      // 1. Fetch ACTIVE items and links slated for deletion to capture their 'before' state
      if (itemsToDeleteArray.length > 0) {
        // Fetch only ACTIVE items that are in the potential delete list
        const itemsNow = await this.workItemRepository.findByIds(itemsToDeleteArray, { isActive: true }); // Use pool implicitly
        itemsToDeleteBeforeState.push(...itemsNow); // Store the full 'before' state of active items

        // Find active links involving these active items that will be deactivated
        const itemIdsToCaptureLinksFor = itemsToDeleteBeforeState.map((i) => i.work_item_id);
        if (itemIdsToCaptureLinksFor.length > 0) {
          const allLinksInvolvingItems = await this.findLinksToDeactivate(itemIdsToCaptureLinksFor, client);
          const activeLinksNow = allLinksInvolvingItems.filter((link) => link.is_active);
          linksToDeleteBeforeState.push(...activeLinksNow); // Store the full 'before' state of active links
        }
      }
      logger.debug(
        `[WorkItemDeleteService Tx DEBUG] Before State Captured: ${itemsToDeleteBeforeState.length} active items, ${linksToDeleteBeforeState.length} active links.`
      );

      // 2. Perform soft delete (items) - only operate on items captured in before state
      const itemIdsToDeleteNow = itemsToDeleteBeforeState.map((i) => i.work_item_id);
      if (itemIdsToDeleteNow.length > 0) {
        actualDeletedItemCount = await this.workItemRepository.softDelete(itemIdsToDeleteNow, client);
        // Only add IDs that were confirmed deleted (rowCount > 0)
        if (actualDeletedItemCount > 0) {
          deletedItemIds.push(...itemIdsToDeleteNow); // Assume all attempted were deleted if count > 0, repo logic might be simpler
        }
        logger.info(
          `[WorkItemDeleteService Tx] Repository reported ${actualDeletedItemCount} work item(s) soft deleted.`
        );
      } else {
        actualDeletedItemCount = 0;
        logger.info('[WorkItemDeleteService Tx] No *active* items found in the cascade list to attempt soft delete.');
      }

      // 3. Soft delete affected dependency links - only operate on links captured in before state
      const linkKeysToDeactivate = linksToDeleteBeforeState.map((link) => ({
        work_item_id: link.work_item_id,
        depends_on_work_item_id: link.depends_on_work_item_id,
      }));

      if (linkKeysToDeactivate.length > 0) {
        totalDeactivatedDepsCount = await this.workItemRepository.softDeleteDependenciesByCompositeKeys(
          linkKeysToDeactivate,
          client // softDeleteDeps requires client
        );
        // Only add keys confirmed deleted
        if (totalDeactivatedDepsCount > 0) {
          deactivatedLinkKeys.push(...linkKeysToDeactivate);
        }
        logger.info(`[WorkItemDeleteService Tx] Soft deleted ${totalDeactivatedDepsCount} active dependency link(s).`);
      } else {
        totalDeactivatedDepsCount = 0;
        logger.info('[WorkItemDeleteService Tx] No active dependency links found to soft delete.');
      }

      // 4. Record history only if something was actually deactivated
      if (actualDeletedItemCount > 0 || totalDeactivatedDepsCount > 0) {
        const actionDescription = `Deleted ${actualDeletedItemCount} work item(s) and deactivated ${totalDeactivatedDepsCount} related active links (cascade)`;
        const actionData: CreateActionHistoryInput = {
          action_type: 'DELETE_WORK_ITEM_CASCADE',
          // Use the first ID from the original request for the primary link, or null if multiple
          work_item_id: ids.length === 1 ? ids[0] : null,
          description: actionDescription,
        };

        const undoStepsData: CreateUndoStepInput[] = [];
        let stepOrder = 1;

        // Generate undo steps based on the captured 'before' state
        itemsToDeleteBeforeState.forEach((itemBefore) => {
          // old_data = state to restore TO (the state *before* the delete)
          const itemStateAfterUndo: WorkItemData = { ...itemBefore };
          // new_data = state that was created BY the delete action (minimal: just inactive flag)
          const itemStateBeforeUndo: Partial<WorkItemData> = { is_active: false };
          undoStepsData.push({
            step_order: stepOrder++,
            step_type: 'UPDATE',
            table_name: 'work_items',
            record_id: itemBefore.work_item_id,
            old_data: itemStateAfterUndo,
            new_data: itemStateBeforeUndo,
          });
        });

        linksToDeleteBeforeState.forEach((linkBefore) => {
          const depRecordId = `${linkBefore.work_item_id}:${linkBefore.depends_on_work_item_id}`;
          // old_data = state to restore TO (active link)
          const depStateAfterUndo: WorkItemDependencyData = { ...linkBefore };
          // new_data = state created BY the delete (inactive link)
          const depStateBeforeUndo: Partial<WorkItemDependencyData> = { is_active: false };
          undoStepsData.push({
            step_order: stepOrder++,
            step_type: 'UPDATE',
            table_name: 'work_item_dependencies',
            record_id: depRecordId,
            old_data: depStateAfterUndo,
            new_data: depStateBeforeUndo,
          });
        });

        // Log the generated steps
        logger.debug(`[WorkItemDeleteService Tx DEBUG] Preparing to create history action:`, actionData);
        logger.debug(` - actualDeletedItemCount: ${actualDeletedItemCount}`);
        logger.debug(` - totalDeactivatedDepsCount: ${totalDeactivatedDepsCount}`);
        logger.debug(
          ` - Generated undoStepsData (${undoStepsData.length} steps):`,
          JSON.stringify(undoStepsData, null, 2)
        );

        // Ensure steps were generated if items/links were deleted
        if (undoStepsData.length === 0 && (actualDeletedItemCount > 0 || totalDeactivatedDepsCount > 0)) {
          logger.error(
            `[WorkItemDeleteService Tx CRITICAL] Items/links were deleted but NO undo steps generated. Before state items: ${itemsToDeleteBeforeState.length}, links: ${linksToDeleteBeforeState.length}`
          );
          // Throw an error to rollback the transaction and prevent inconsistent state
          throw new Error('CRITICAL: Failed to generate undo steps for delete operation.');
        }

        // Create action and steps in DB (only if steps were generated)
        if (undoStepsData.length > 0) {
          const createdAction = await this.actionHistoryRepository.createActionInClient(actionData, client);
          for (const step of undoStepsData) {
            await this.actionHistoryRepository.createUndoStepInClient(
              { ...step, action_id: createdAction.action_id },
              client
            );
          }
          // Invalidate redo stack using the initialized historyService
          await this.historyService.invalidateRedoStack(client, createdAction.action_id);
          logger.info(`[WorkItemDeleteService Tx] Recorded history for delete action ${createdAction.action_id}.`);
        }
        // Removed the 'else' block that skipped history recording if no steps were generated,
        // as the throw above should prevent reaching here in that inconsistent state.
      } else {
        logger.info('[WorkItemDeleteService Tx] No active items or links were deleted, skipping history recording.');
      }
    }); // End Transaction

    logger.debug(`[WorkItemDeleteService] Returning count: ${actualDeletedItemCount} (based on repository rowCount)`);
    return actualDeletedItemCount;
  }

  /**
   * Finds all descendant work item IDs recursively. Uses the pool.
   * @param rootId The starting item ID.
   * @param onlyActive If true, only considers active items for traversal. If false, considers all.
   */
  private async findAllDescendantsRecursively(rootId: string, onlyActive: boolean): Promise<string[]> {
    if (!uuidValidate(rootId)) {
      return [];
    }
    const results: Set<string> = new Set();
    const queue: string[] = [rootId]; // Start queue with the root ID
    const visited: Set<string> = new Set([rootId]); // Mark root as visited initially

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      // Find children based on the active filter
      // Pass undefined for isActive filter if we want both active and inactive children
      const children = await this.workItemRepository.findChildren(currentId, {
        isActive: onlyActive ? true : undefined,
      });

      for (const child of children) {
        const childId = child.work_item_id;
        if (!visited.has(childId)) {
          visited.add(childId);
          results.add(childId); // Add the child ID to the results set
          queue.push(childId); // Add child to queue for further traversal
        }
      }
    }
    logger.debug(
      `[WorkItemDeleteService] Found ${results.size} descendants for item ${rootId} (onlyActive: ${onlyActive})`
    );
    return Array.from(results);
  }

  /** Helper to find all dependency links involving the items being deleted. Uses pool or provided client. */
  private async findLinksToDeactivate(
    itemIds: string[],
    clientOrPool?: PoolClient | Pool
  ): Promise<WorkItemDependencyData[]> {
    if (itemIds.length === 0) return [];
    const dbClient = clientOrPool ?? this.pool; // Can use client if provided for consistency within transaction
    // Find links where either the item OR the item it depends on is in the list of items being deleted
    const sql = `
       SELECT * FROM work_item_dependencies
       WHERE work_item_id = ANY($1::uuid[]) OR depends_on_work_item_id = ANY($1::uuid[]);
     `;
    const params = [itemIds];
    try {
      const result = await dbClient.query(sql, params);
      const allLinks = result.rows.map(this.workItemRepository.mapRowToWorkItemDependencyData);
      logger.debug(
        `[WorkItemDeleteService DEBUG] Found ${allLinks.length} total links involving items potentially being deleted.`
      );
      return allLinks;
    } catch (error: unknown) {
      logger.error(`[WorkItemDeleteService] Failed to find links to deactivate:`, error);
      throw error;
    }
  }
}
