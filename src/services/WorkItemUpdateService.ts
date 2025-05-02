// src/services/WorkItemUpdateService.ts
import {
  WorkItemRepository, // Import main repo class
  ActionHistoryRepository, // Import main repo class
  WorkItemData, // Import WorkItemData
  WorkItemDependencyData, // Import WorkItemDependencyData
  CreateActionHistoryInput,
  CreateUndoStepInput,
} from '../repositories/index.js'; // USE BARREL FILE
import { logger } from '../utils/logger.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { UpdateWorkItemInput, FullWorkItemData } from './WorkItemServiceTypes.js'; // Assuming this path is correct relative to services/
import { WorkItemUtilsService } from './WorkItemUtilsService.js';
import { WorkItemReadingService } from './WorkItemReadingService.js';
import { WorkItemHistoryService } from './WorkItemHistoryService.js';

/**
 * Service responsible for updating work items
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
    this.utilsService = new WorkItemUtilsService(
      workItemRepository // Pass repository instance here
    ); // Need repository for calculateShortname/OrderKey
    this.readingService = new WorkItemReadingService(workItemRepository);
    // Initialize history service
    this.historyService = new WorkItemHistoryService(workItemRepository, actionHistoryRepository);
  }

  /**
   * Updates a work item and optionally its dependencies.
   */
  public async updateWorkItem(
    id: string,
    updates: UpdateWorkItemInput,
    dependenciesInput?: {
      depends_on_work_item_id: string;
      dependency_type?: 'finish-to-start' | 'linked';
    }[]
  ): Promise<FullWorkItemData> {
    logger.debug(`[WorkItemUpdateService] Updating work item ${id} with data:`, {
      updates,
      hasDependencies: dependenciesInput !== undefined,
    });

    let itemBeforeUpdate: WorkItemData | undefined;
    const depsBeforeUpdateMap: Map<string, WorkItemDependencyData> = new Map();

    const updatedItem = await this.actionHistoryRepository.withTransaction(async (client) => {
      // 1. Fetch current state for comparison and undo steps
      itemBeforeUpdate = await this.workItemRepository.findById(id, { isActive: true }, client);
      if (!itemBeforeUpdate) throw new NotFoundError(`Active work item with ID ${id} not found.`);

      // Fetch *all* outgoing dependencies (active and inactive) before the update
      const existingDependenciesAll = await this.workItemRepository.findDependencies(
        id,
        { isActive: false }, // Fetch ALL states
        client
      );
      existingDependenciesAll.forEach((dep) => depsBeforeUpdateMap.set(`${id}:${dep.depends_on_work_item_id}`, dep));
      // DIAGNOSTIC LOGGING
      logger.debug(`[WorkItemUpdateService DIAG] Deps Before Update for ${id}:`, [...depsBeforeUpdateMap.entries()]);

      // 2. Prepare update payload
      const updatePayload: Partial<WorkItemData> = { ...updates };
      delete (updatePayload as any).is_active; // FIXME: Replace 'any' with specific type assertion if possible

      const nameChanged = updates.name !== undefined && updates.name !== itemBeforeUpdate.name;
      const parentChanged =
        updates.parent_work_item_id !== undefined &&
        updates.parent_work_item_id !== itemBeforeUpdate.parent_work_item_id;

      if (parentChanged && updates.parent_work_item_id !== null) {
        const newParentExists = await this.workItemRepository.findById(
          updates.parent_work_item_id!,
          { isActive: true },
          client
        );
        if (!newParentExists)
          throw new ValidationError(
            `New parent work item with ID ${updates.parent_work_item_id} not found or is inactive.`
          );
      }
      if ((nameChanged || parentChanged) && updates.shortname === undefined) {
        const newName = updates.name ?? itemBeforeUpdate.name;
        const newParentId = parentChanged
          ? (updates.parent_work_item_id ?? null)
          : itemBeforeUpdate.parent_work_item_id;
        updatePayload.shortname = await this.utilsService.calculateShortname(
          newName,
          newParentId,
          id,
          client
          // this.workItemRepository // Removed, accessed via this.utilsService
        );
      }
      if (parentChanged && updates.order_key === undefined) {
        const newParentId = updates.parent_work_item_id ?? null;
        updatePayload.order_key = await this.utilsService.calculateOrderKey(newParentId, null);
      }

      // 3. Construct desired dependency state (explicitly active)
      const newDependenciesDesiredState: WorkItemDependencyData[] | undefined =
        dependenciesInput?.map((dep) => ({
          work_item_id: id,
          depends_on_work_item_id: dep.depends_on_work_item_id,
          dependency_type: dep.dependency_type ?? 'finish-to-start',
          is_active: true, // Input always implies active
        })) ?? undefined; // Ensure it's undefined if input array is empty/not provided
      // DIAGNOSTIC LOGGING
      logger.debug(`[WorkItemUpdateService DIAG] Desired Deps State for ${id}:`, newDependenciesDesiredState);

      // 4. Perform the update via repository (handles item fields and dependency sync)
      await this.workItemRepository.update(
        client,
        id,
        updatePayload,
        newDependenciesDesiredState // Pass the desired state
      );

      // 5. Fetch final state after update for history diffing
      const itemAfterUpdate = await this.workItemRepository.findById(
        id,
        { isActive: true }, // Should still be active
        client
      );
      if (!itemAfterUpdate) throw new Error(`Failed to fetch item state after update for history recording: ${id}`);
      const depsAfterUpdate = await this.workItemRepository.findDependencies(
        id,
        { isActive: false }, // Fetch ALL states again
        client
      );
      const depsAfterUpdateMap = new Map(depsAfterUpdate.map((d) => [`${id}:${d.depends_on_work_item_id}`, d]));
      // DIAGNOSTIC LOGGING
      logger.debug(`[WorkItemUpdateService DIAG] Deps After Update Repo Call for ${id}:`, [
        ...depsAfterUpdateMap.entries(),
      ]);

      // 6. Generate Undo Steps
      const undoStepsData: CreateUndoStepInput[] = [];
      let stepOrder = 1;

      // Item changes - Check if relevant fields changed
      let itemEffectivelyChanged = false;
      if (itemBeforeUpdate && itemAfterUpdate) {
        const comparableKeys: (keyof WorkItemData)[] = [
          'parent_work_item_id',
          'name',
          'shortname',
          'description',
          'status',
          'priority',
          'order_key',
          'due_date',
          'is_active', // Although not directly updatable by payload, check for changes (e.g. from soft delete)
        ];
        for (const key of comparableKeys) {
          // Deep compare if the field is an object/array or could be null/undefined
          if (
            (typeof itemBeforeUpdate[key] === 'object' && itemBeforeUpdate[key] !== null) ||
            (typeof itemAfterUpdate[key] === 'object' && itemAfterUpdate[key] !== null)
          ) {
            if (JSON.stringify(itemBeforeUpdate[key]) !== JSON.stringify(itemAfterUpdate[key])) {
              itemEffectivelyChanged = true;
              break;
            }
          } else if (itemBeforeUpdate[key] !== itemAfterUpdate[key]) {
            itemEffectivelyChanged = true;
            break;
          }
        }
      }

      if (itemEffectivelyChanged) {
        logger.debug(`[WorkItemUpdateService DIAG] Item fields changed for ${id}.`);
        // old_data: State AFTER undo (state before original update)
        // new_data: State BEFORE undo (state after original update)
        undoStepsData.push({
          step_order: stepOrder++,
          step_type: 'UPDATE',
          table_name: 'work_items',
          record_id: id,
          old_data: itemBeforeUpdate as WorkItemData, // Using WorkItemData type assertion
          new_data: itemAfterUpdate as WorkItemData, // Using WorkItemData type assertion
        });
      } else {
        logger.debug(`[WorkItemUpdateService DIAG] Item fields did NOT change for ${id}.`);
      }

      // Dependency changes (only if dependenciesInput was provided)
      let dependenciesEffectivelyChanged = false; // Flag to track dep changes
      if (newDependenciesDesiredState !== undefined) {
        // Check against undefined, not null
        logger.debug(`[WorkItemUpdateService DIAG] Checking dependency changes for ${id}...`);
        // Check all keys from before and after states
        const allDepKeys = new Set([...depsBeforeUpdateMap.keys(), ...depsAfterUpdateMap.keys()]);

        for (const key of allDepKeys) {
          const oldDep = depsBeforeUpdateMap.get(key);
          const newDep = depsAfterUpdateMap.get(key);

          // Compare relevant fields for dependency changes (is_active, dependency_type)
          const areDepsDifferent =
            oldDep?.is_active !== newDep?.is_active || oldDep?.dependency_type !== newDep?.dependency_type;

          if (oldDep && !newDep) {
            // Was implicitly deactivated by not being in the newDependenciesInput list
            logger.debug(`[WorkItemUpdateService DIAG] Dependency ${key} DEACTIVATED.`);
            dependenciesEffectivelyChanged = true;
            // Undo is to bring it back (set is_active to true) - UPDATE step
            // old_data: State AFTER undo (dependency is active again)
            // new_data: State BEFORE undo (dependency was inactive)
            undoStepsData.push({
              step_order: stepOrder++,
              step_type: 'UPDATE',
              table_name: 'work_item_dependencies',
              record_id: key, // Use composite key as record_id
              old_data: oldDep as WorkItemDependencyData, // Using WorkItemDependencyData type assertion
              new_data: { ...oldDep, is_active: false } as WorkItemDependencyData, // State BEFORE undo
            });
          } else if (!oldDep && newDep) {
            // Was created/activated
            logger.debug(`[WorkItemUpdateService DIAG] Dependency ${key} ADDED/ACTIVATED.`);
            dependenciesEffectivelyChanged = true;
            // Undo is to deactivate it (set is_active to false) - UPDATE step
            // old_data: State AFTER undo (dependency is inactive)
            // new_data: State BEFORE undo (dependency is active)
            undoStepsData.push({
              step_order: stepOrder++,
              step_type: 'UPDATE',
              table_name: 'work_item_dependencies',
              record_id: key, // Use composite key as record_id
              old_data: { ...newDep, is_active: false } as WorkItemDependencyData, // State AFTER undo
              new_data: newDep as WorkItemDependencyData, // State BEFORE undo
            });
          } else if (oldDep && newDep && areDepsDifferent) {
            // State (is_active) or type changed
            logger.debug(
              `[WorkItemUpdateService DIAG] Dependency ${key} state/type CHANGED. Old: ${JSON.stringify(oldDep)}, New: ${JSON.stringify(newDep)}`
            );
            dependenciesEffectivelyChanged = true;
            // Undo is to revert to old state - UPDATE step
            // old_data: State AFTER undo (state before original update)
            // new_data: State BEFORE undo (state after original update)
            undoStepsData.push({
              step_order: stepOrder++,
              step_type: 'UPDATE',
              table_name: 'work_item_dependencies',
              record_id: key, // Use composite key as record_id
              old_data: oldDep as WorkItemDependencyData, // Using WorkItemDependencyData type assertion
              new_data: newDep as WorkItemDependencyData, // Using WorkItemDependencyData type assertion
            });
          } else {
            // Log unchanged deps only if needed for deep debug
            // logger.debug(`[WorkItemUpdateService DIAG] Dependency ${key} UNCHANGED.`);
          }
        }
      }

      // 7. Record History if changes occurred (item OR dependencies)
      if (itemEffectivelyChanged || dependenciesEffectivelyChanged) {
        logger.debug(`[WorkItemUpdateService DIAG] Effective changes detected for ${id}. Generating history.`);
        const actionDescription = `Updated work item "${itemAfterUpdate.name}"`;
        const actionData: CreateActionHistoryInput = {
          user_id: null, // User ID removed
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
        // invalidateRedoStack IS correctly called after UPDATE
        await this.historyService.invalidateRedoStack(client, createdAction.action_id);
        logger.info(`[WorkItemUpdateService] Recorded history for update of work item ${id}.`);
      } else {
        logger.info(
          `[WorkItemUpdateService] Update called for ${id}, but no effective changes detected (Item: ${itemEffectivelyChanged}, Deps: ${dependenciesEffectivelyChanged}). Skipping history.`
        );
      }

      return itemAfterUpdate;
    });

    // Fetch full details after transaction commits
    const fullUpdatedItem = await this.readingService.getWorkItemById(
      updatedItem.work_item_id,
      { isActive: true } // Fetch active item
    );
    if (!fullUpdatedItem) {
      // If the update somehow made the item inactive, try fetching inactive
      const inactiveItem = await this.readingService.getWorkItemById(updatedItem.work_item_id, { isActive: false });
      if (inactiveItem) return inactiveItem; // Return inactive if found

      // Otherwise, throw error
      logger.error(
        `[WorkItemUpdateService] Failed to retrieve full details for updated item ${updatedItem.work_item_id} (active or inactive).`
      );
      throw new Error(`Failed to retrieve full details for updated item ${updatedItem.work_item_id}.`);
    }
    return fullUpdatedItem;
  }
}
