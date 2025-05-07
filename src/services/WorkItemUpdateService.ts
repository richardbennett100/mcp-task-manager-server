// src/services/WorkItemUpdateService.ts
import {
  WorkItemRepository,
  ActionHistoryRepository,
  WorkItemData,
  WorkItemDependencyData,
  CreateActionHistoryInput,
  CreateUndoStepInput,
} from '../repositories/index.js';
import { logger } from '../utils/logger.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { UpdateWorkItemInput, FullWorkItemData } from './WorkItemServiceTypes.js';
import { WorkItemUtilsService } from './WorkItemUtilsService.js';
import { WorkItemReadingService } from './WorkItemReadingService.js';
import { WorkItemHistoryService } from './WorkItemHistoryService.js';
import { PoolClient } from 'pg';
// Removed unused imports for DependencyInput, WorkItemStatusEnum, WorkItemPriorityEnum, and z

/**
 * Service responsible for the (now deprecated) general update logic for work items.
 * Granular updates are handled by WorkItemFieldUpdateService and WorkItemDependencyUpdateService.
 */
export class WorkItemUpdateService {
  private workItemRepository: WorkItemRepository;
  private actionHistoryRepository: ActionHistoryRepository;
  private utilsService: WorkItemUtilsService;
  private readingService: WorkItemReadingService;
  private historyService: WorkItemHistoryService;

  constructor(workItemRepository: WorkItemRepository, actionHistoryRepository: ActionHistoryRepository) {
    this.workItemRepository = workItemRepository;
    this.actionHistoryRepository = actionHistoryRepository;
    this.utilsService = new WorkItemUtilsService(); // Corrected: Instantiate without args
    this.readingService = new WorkItemReadingService(workItemRepository);
    this.historyService = new WorkItemHistoryService(workItemRepository, actionHistoryRepository);
  }

  /**
   * [DEPRECATED - Use granular update tools/methods instead]
   * Updates a work item, handling potential reordering and dependencies (full replacement).
   */
  public async updateWorkItem(
    id: string,
    updates: UpdateWorkItemInput,
    dependenciesInput?: {
      depends_on_work_item_id: string;
      dependency_type?: 'finish-to-start' | 'linked';
    }[]
  ): Promise<FullWorkItemData> {
    logger.warn(`[WorkItemUpdateService - DEPRECATED] Call to updateWorkItem for ID ${id}.`);
    logger.debug(`[WorkItemUpdateService - DEPRECATED] Updating work item ${id} with data:`, {
      updates,
      hasDependencies: dependenciesInput !== undefined,
    });

    let itemBeforeUpdate: WorkItemData | undefined;
    let itemAfterUpdate: WorkItemData | undefined;
    const depsBeforeUpdateMap: Map<string, WorkItemDependencyData> = new Map();

    const { moveTo, moveAfter_work_item_id, moveBefore_work_item_id, ...coreUpdates } = updates;
    const positioningParamCount = [moveTo, moveAfter_work_item_id, moveBefore_work_item_id].filter(
      (p) => p !== undefined
    ).length;

    if (positioningParamCount > 1) {
      throw new ValidationError(
        'Provide only one positioning parameter: moveTo, moveAfter_work_item_id, or moveBefore_work_item_id.'
      );
    }

    await this.actionHistoryRepository.withTransaction(async (client: PoolClient) => {
      itemBeforeUpdate = await this.workItemRepository.findById(id, { isActive: true });
      if (!itemBeforeUpdate) throw new NotFoundError(`Active work item with ID ${id} not found.`);

      const existingDependenciesAll = await this.workItemRepository.findDependencies(id, { isActive: false });
      existingDependenciesAll.forEach((dep) => depsBeforeUpdateMap.set(`${id}:${dep.depends_on_work_item_id}`, dep));

      const updatePayload: Partial<WorkItemData> = { ...coreUpdates };
      delete (updatePayload as any).order_key; // Prevent accidental direct setting
      // REMOVED: delete (updatePayload as any).shortname;

      const originalParentId = itemBeforeUpdate.parent_work_item_id;
      const targetParentId =
        coreUpdates.parent_work_item_id === undefined ? originalParentId : coreUpdates.parent_work_item_id;
      const parentChanged = targetParentId !== originalParentId;

      if (parentChanged && targetParentId !== null) {
        const newParentExists = await this.workItemRepository.findById(targetParentId, { isActive: true });
        if (!newParentExists)
          throw new ValidationError(`New parent work item with ID ${targetParentId} not found or is inactive.`);
      }

      const requiresReorder = positioningParamCount > 0 || parentChanged;
      let calculatedOrderKey: string | null | undefined = undefined;

      if (requiresReorder) {
        logger.debug(
          `[WorkItemUpdateService - DEPRECATED] Reordering required for ${id}. ParentChanged=${parentChanged}, MoveParams=${positioningParamCount > 0}`
        );
        let keyBefore: string | null = null;
        let keyAfter: string | null = null;

        if (moveAfter_work_item_id) {
          const neighbours = await this.workItemRepository.findNeighbourOrderKeys(
            targetParentId,
            moveAfter_work_item_id,
            'after',
            client
          );
          keyBefore = neighbours.before;
          keyAfter = neighbours.after;
        } else if (moveBefore_work_item_id) {
          const neighbours = await this.workItemRepository.findNeighbourOrderKeys(
            targetParentId,
            moveBefore_work_item_id,
            'before',
            client
          );
          keyBefore = neighbours.before;
          keyAfter = neighbours.after;
        } else if (moveTo === 'start') {
          keyAfter = await this.workItemRepository.findSiblingEdgeOrderKey(targetParentId, 'first', client);
          keyBefore = null;
        } else {
          // Default to end if parent changed or moveTo === 'end' or no specific move
          keyBefore = await this.workItemRepository.findSiblingEdgeOrderKey(targetParentId, 'last', client);
          keyAfter = null;
        }
        calculatedOrderKey = this.utilsService.calculateOrderKey(keyBefore, keyAfter);
        if (calculatedOrderKey === null) {
          throw new Error(`Failed to calculate a valid order key for moving item "${id}"`);
        }
        updatePayload.order_key = calculatedOrderKey;
      }

      // REMOVED shortname recalculation logic
      // if (updatePayload.name && updatePayload.name !== itemBeforeUpdate.name) {
      //   const newShortname = await this.utilsService.calculateShortname(updatePayload.name, targetParentId, id);
      //   if (newShortname === null) {
      //     throw new Error(`Failed to generate unique shortname for new name: "${updatePayload.name}"`);
      //   }
      //   updatePayload.shortname = newShortname;
      // } else if (parentChanged) {
      //   // Recalculate shortname even if name didn't change, because context (parent) did
      //   const currentName = updatePayload.name ?? itemBeforeUpdate.name;
      //   const newShortname = await this.utilsService.calculateShortname(currentName, targetParentId, id);
      //   if (newShortname === null) {
      //     throw new Error(`Failed to generate unique shortname in new parent context: "${currentName}"`);
      //   }
      //   updatePayload.shortname = newShortname;
      // }

      const newDependenciesDesiredState: WorkItemDependencyData[] | undefined =
        dependenciesInput?.map((dep) => ({
          work_item_id: id,
          depends_on_work_item_id: dep.depends_on_work_item_id,
          dependency_type: dep.dependency_type ?? 'finish-to-start',
          is_active: true,
        })) ?? undefined;

      const hasCoreUpdates = Object.keys(coreUpdates).length > 0;
      const hasOrderKeyUpdate = calculatedOrderKey !== undefined;
      // REMOVED: const hasShortnameUpdate = updatePayload.shortname !== undefined && updatePayload.shortname !== itemBeforeUpdate.shortname;

      // Check if any actual change occurred
      if (!hasCoreUpdates && !hasOrderKeyUpdate && newDependenciesDesiredState === undefined) {
        logger.info(
          `[WorkItemUpdateService - DEPRECATED] No effective changes for item ${id}. Skipping update and history.`
        );
        itemAfterUpdate = itemBeforeUpdate; // Set after state to before state if no changes
      } else {
        // Call the repository update method (which now correctly handles dependency replacement)
        itemAfterUpdate = await this.workItemRepository.update(client, id, updatePayload, newDependenciesDesiredState);

        // Fetch dependencies *after* the update to create accurate undo steps
        const depsAfterUpdate = await this.workItemRepository.findDependencies(id, { isActive: false });
        const depsAfterUpdateMap = new Map(depsAfterUpdate.map((d) => [`${id}:${d.depends_on_work_item_id}`, d]));
        const undoStepsData: CreateUndoStepInput[] = [];
        let stepOrder = 1;
        let itemEffectivelyChanged = false;

        // --- Check if item core data effectively changed ---
        if (itemBeforeUpdate && itemAfterUpdate) {
          const comparableKeys: (keyof WorkItemData)[] = [
            'parent_work_item_id',
            'name',
            // 'shortname', // Removed
            'description',
            'status',
            'priority',
            'due_date',
            'is_active',
            'order_key',
          ];
          for (const key of comparableKeys) {
            if (JSON.stringify(itemBeforeUpdate[key]) !== JSON.stringify(itemAfterUpdate[key])) {
              itemEffectivelyChanged = true;
              break;
            }
          }
        }
        // --- ---

        // Create undo step for item update if changed
        if (itemEffectivelyChanged) {
          // Filter payload to only include changed fields for undo step
          const oldItemDataForUndo: Partial<WorkItemData> = {};
          const newItemDataForUndo: Partial<WorkItemData> = {};
          if (itemBeforeUpdate && itemAfterUpdate) {
            for (const key of Object.keys(updatePayload) as (keyof typeof updatePayload)[]) {
              if (
                key !== 'updated_at' &&
                JSON.stringify(itemBeforeUpdate[key]) !== JSON.stringify(itemAfterUpdate[key])
              ) {
                (oldItemDataForUndo as any)[key] = itemBeforeUpdate[key];
                (newItemDataForUndo as any)[key] = itemAfterUpdate[key];
              }
            }
            // Always include updated_at for undo
            oldItemDataForUndo.updated_at = itemBeforeUpdate.updated_at;
            newItemDataForUndo.updated_at = itemAfterUpdate.updated_at;
          }

          undoStepsData.push({
            step_order: stepOrder++,
            step_type: 'UPDATE',
            table_name: 'work_items',
            record_id: id,
            old_data: oldItemDataForUndo,
            new_data: newItemDataForUndo,
          });
        }

        // --- Create undo steps for dependency changes ---
        let dependenciesEffectivelyChanged = false;
        if (newDependenciesDesiredState !== undefined) {
          const allDepKeys = new Set([...depsBeforeUpdateMap.keys(), ...depsAfterUpdateMap.keys()]);
          for (const key of allDepKeys) {
            const oldDep = depsBeforeUpdateMap.get(key);
            const newDep = depsAfterUpdateMap.get(key);
            const oldDepExists = oldDep !== undefined;
            const newDepExists = newDep !== undefined;
            let stepGenerated = false;
            if (
              (oldDepExists && !newDepExists) || // Deletion
              (!oldDepExists && newDepExists) || // Creation
              (oldDepExists &&
                newDepExists && // Modification (active state or type)
                (oldDep.is_active !== newDep.is_active || oldDep.dependency_type !== newDep.dependency_type))
            ) {
              dependenciesEffectivelyChanged = true;
              stepGenerated = true;
            }
            if (stepGenerated && stepOrder <= 100) {
              // Limit steps for safety
              const stepType = 'UPDATE'; // Always treat as update for undo
              const recordId = key;
              // If it didn't exist before, the 'old' state for undo is inactive
              const oldDataForUndo = oldDep ?? { ...newDep!, is_active: false };
              // If it doesn't exist after, the 'new' state for undo is inactive
              const newDataForUndo = newDep ?? { ...oldDep!, is_active: false };

              undoStepsData.push({
                step_order: stepOrder++,
                step_type: stepType,
                table_name: 'work_item_dependencies',
                record_id: recordId,
                old_data: oldDataForUndo,
                new_data: newDataForUndo,
              });
            }
          }
        }
        // --- ---

        // Record history only if there were effective changes
        if (itemEffectivelyChanged || dependenciesEffectivelyChanged) {
          const actionDescription = `Updated work item "${itemAfterUpdate!.name}" (via deprecated method)`;
          const actionData: CreateActionHistoryInput = {
            action_type: 'UPDATE_WORK_ITEM',
            work_item_id: id,
            description: actionDescription,
          };
          const createdAction = await this.actionHistoryRepository.createActionInClient(actionData, client);
          for (const step of undoStepsData) {
            await this.actionHistoryRepository.createUndoStepInClient(
              { ...step, action_id: createdAction.action_id },
              client
            );
          }
          await this.historyService.invalidateRedoStack(client, createdAction.action_id);
          logger.info(`[WorkItemUpdateService - DEPRECATED] Recorded history for update of work item ${id}.`);
        } else {
          logger.info(
            `[WorkItemUpdateService - DEPRECATED] Update processed for ${id}, but no effective changes detected. Skipping history.`
          );
          itemAfterUpdate = itemBeforeUpdate; // Ensure state reflects no change
        }
      }
    }); // End Transaction

    const finalItemState = itemAfterUpdate ?? itemBeforeUpdate;
    if (!finalItemState) {
      logger.error(`[WorkItemUpdateService - DEPRECATED] CRITICAL: No item state available for ID ${id}.`);
      throw new Error(`Failed to determine final item state after update for ID ${id}.`);
    }
    const fullUpdatedItem = await this.readingService.getWorkItemById(finalItemState.work_item_id, {
      isActive: finalItemState.is_active,
    });
    if (!fullUpdatedItem) {
      logger.error(
        `[WorkItemUpdateService - DEPRECATED] Failed to retrieve full details for item ${finalItemState.work_item_id}.`
      );
      throw new Error(`Failed to retrieve full details for updated item ${finalItemState.work_item_id}.`);
    }
    return fullUpdatedItem;
  }
}
