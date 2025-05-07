// src/services/WorkItemDependencyUpdateService.ts
import {
  type WorkItemRepository,
  type ActionHistoryRepository,
  type WorkItemData,
  type WorkItemDependencyData,
  type CreateActionHistoryInput,
  type CreateUndoStepInput,
} from '../repositories/index.js';
import { logger } from '../utils/logger.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { type FullWorkItemData } from './WorkItemServiceTypes.js';
import { WorkItemReadingService } from './WorkItemReadingService.js';
import { WorkItemHistoryService } from './WorkItemHistoryService.js';
import { type PoolClient } from 'pg';
import { type DependencyInput } from '../tools/add_dependencies_params.js';

export class WorkItemDependencyUpdateService {
  private workItemRepository: WorkItemRepository;
  private actionHistoryRepository: ActionHistoryRepository;
  private readingService: WorkItemReadingService;
  private historyService: WorkItemHistoryService;

  constructor(workItemRepository: WorkItemRepository, actionHistoryRepository: ActionHistoryRepository) {
    this.workItemRepository = workItemRepository;
    this.actionHistoryRepository = actionHistoryRepository;
    this.readingService = new WorkItemReadingService(workItemRepository);
    this.historyService = new WorkItemHistoryService(workItemRepository, actionHistoryRepository);
  }

  public async addDependencies(
    workItemId: string,
    dependenciesToAddInput: DependencyInput[]
  ): Promise<FullWorkItemData> {
    logger.info(
      `[WorkItemDependencyUpdateService] Adding/updating ${dependenciesToAddInput.length} dependencies for work item ${workItemId}`
    );

    let itemReceivingDependencies: WorkItemData | undefined;
    const depsOfItemBeforeThisOperationMap: Map<string, WorkItemDependencyData> = new Map();

    if (!dependenciesToAddInput || dependenciesToAddInput.length === 0) {
      throw new ValidationError('No dependencies provided to add.');
    }
    const targetDepItemIds = dependenciesToAddInput.map((dep) => dep.depends_on_work_item_id);
    if (targetDepItemIds.includes(workItemId)) {
      throw new ValidationError('A work item cannot depend on itself.');
    }

    const existingDepsOfReceivingItem = await this.workItemRepository.findDependencies(workItemId, {
      isActive: undefined,
    });
    existingDepsOfReceivingItem.forEach((dep) =>
      depsOfItemBeforeThisOperationMap.set(dep.depends_on_work_item_id, dep)
    );

    await this.actionHistoryRepository.withTransaction(async (client: PoolClient) => {
      itemReceivingDependencies = await this.workItemRepository.findById(workItemId, { isActive: true }, client);
      if (!itemReceivingDependencies) {
        throw new NotFoundError(`Work item with ID ${workItemId} (to add dependencies to) not found or is inactive.`);
      }

      const targetWorkItemsData = await this.workItemRepository.findByIds(targetDepItemIds, { isActive: true }, client);
      const foundTargetIds = new Set(targetWorkItemsData.map((item) => item.work_item_id));
      const missingTargetIds = targetDepItemIds.filter((id) => !foundTargetIds.has(id));

      if (missingTargetIds.length > 0) {
        const inactiveTargets = await this.workItemRepository.findByIds(missingTargetIds, { isActive: false }, client);
        const trulyMissing = missingTargetIds.filter((id) => !inactiveTargets.some((it) => it.work_item_id === id));
        if (trulyMissing.length > 0) {
          throw new NotFoundError(`Target dependency work items not found: ${trulyMissing.join(', ')}`);
        } else {
          const inactiveFoundIds = missingTargetIds.filter((id) =>
            inactiveTargets.some((it) => it.work_item_id === id)
          );
          throw new ValidationError(`Target dependency work items are inactive: ${inactiveFoundIds.join(', ')}`);
        }
      }

      const dependenciesToUpsert: WorkItemDependencyData[] = dependenciesToAddInput.map((depInput) => ({
        work_item_id: workItemId,
        depends_on_work_item_id: depInput.depends_on_work_item_id,
        dependency_type: depInput.dependency_type ?? 'finish-to-start',
        is_active: true,
      }));

      await this.workItemRepository.addOrUpdateDependencies(client, workItemId, dependenciesToUpsert);

      const dependenciesAfterUpsert = await this.workItemRepository.findDependencies(
        workItemId,
        { isActive: undefined },
        client
      );
      const depsAfterUpsertMap = new Map<string, WorkItemDependencyData>();
      dependenciesAfterUpsert.forEach((dep) => depsAfterUpsertMap.set(dep.depends_on_work_item_id, dep));

      const undoStepsData: CreateUndoStepInput[] = [];
      let stepOrder = 1;
      let actualEffectiveChangesCount = 0;

      for (const intendedChange of dependenciesToUpsert) {
        const dependsOnId = intendedChange.depends_on_work_item_id;
        const stateBeforeThisOp = depsOfItemBeforeThisOperationMap.get(dependsOnId);
        const stateAfterThisOp = depsAfterUpsertMap.get(dependsOnId);

        let effectiveChangeMade = false;
        if (!stateAfterThisOp) {
          // This should ideally not happen if addOrUpdateDependencies guarantees an entry
          logger.warn(
            `[WorkItemDependencyUpdateService] Dependency ${workItemId} -> ${dependsOnId} was not found after upsert operation. Cannot determine effective change or create undo step accurately.`
          );
          continue;
        }

        if (!stateBeforeThisOp) {
          // Link was truly new
          effectiveChangeMade = true;
        } else {
          // Link existed before
          if (!stateBeforeThisOp.is_active && stateAfterThisOp.is_active) {
            // Was reactivated
            effectiveChangeMade = true;
          }
          if (
            stateBeforeThisOp.is_active &&
            stateAfterThisOp.is_active &&
            stateBeforeThisOp.dependency_type !== stateAfterThisOp.dependency_type
          ) {
            // Type changed on active link
            effectiveChangeMade = true;
          }
        }

        if (effectiveChangeMade) {
          actualEffectiveChangesCount++;
          const oldDataForUndoStep: Partial<WorkItemDependencyData> = stateBeforeThisOp
            ? { ...stateBeforeThisOp }
            : {
                work_item_id: workItemId,
                depends_on_work_item_id: dependsOnId,
                dependency_type: intendedChange.dependency_type,
                is_active: false, // If it was new, undoing makes it inactive/non-existent
              };

          undoStepsData.push({
            step_order: stepOrder++,
            step_type: 'UPDATE',
            table_name: 'work_item_dependencies',
            record_id: `${workItemId}:${dependsOnId}`,
            old_data: oldDataForUndoStep,
            new_data: { ...stateAfterThisOp },
          });
        }
      }

      if (actualEffectiveChangesCount > 0) {
        const actionDescription = `Added/updated ${actualEffectiveChangesCount} dependencies for work item "${itemReceivingDependencies.name}"`;
        const actionData: CreateActionHistoryInput = {
          action_type: 'ADD_DEPENDENCIES',
          work_item_id: workItemId,
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
        logger.info(
          `[WorkItemDependencyUpdateService] Recorded history for ${actualEffectiveChangesCount} dep changes for ${workItemId}.`
        );
      } else {
        logger.info(
          `[WorkItemDependencyUpdateService] addDependencies for ${workItemId}: No effective changes to dependencies detected for history record.`
        );
      }
    });

    const fullUpdatedItem = await this.readingService.getWorkItemById(workItemId, { isActive: undefined });
    if (!fullUpdatedItem) {
      throw new Error(`Failed to retrieve full details for item ${workItemId} after addDependencies.`);
    }
    return fullUpdatedItem;
  }

  // deleteDependencies method (ensure findDependenciesByCompositeKeys uses client)
  public async deleteDependencies(workItemId: string, dependsOnIdsToRemove: string[]): Promise<FullWorkItemData> {
    logger.info(
      `[WorkItemDependencyUpdateService] Deleting ${dependsOnIdsToRemove.length} dependencies from work item ${workItemId}`
    );

    let itemBeforeUpdate: WorkItemData | undefined;

    if (!dependsOnIdsToRemove || dependsOnIdsToRemove.length === 0) {
      throw new ValidationError('No dependency IDs provided to remove.');
    }

    await this.actionHistoryRepository.withTransaction(async (client: PoolClient) => {
      itemBeforeUpdate = await this.workItemRepository.findById(workItemId, { isActive: true }, client);
      if (!itemBeforeUpdate) {
        throw new NotFoundError(`Work item with ID ${workItemId} not found or is inactive.`);
      }

      const compositeKeysToFind = dependsOnIdsToRemove.map((targetId) => ({
        work_item_id: workItemId,
        depends_on_work_item_id: targetId,
      }));

      const activeDepsToDeleteDetails = await this.workItemRepository.findDependenciesByCompositeKeys(
        compositeKeysToFind,
        { isActive: true },
        client
      );

      const activeCompositeKeysToDelete = activeDepsToDeleteDetails.map((dep) => ({
        work_item_id: dep.work_item_id,
        depends_on_work_item_id: dep.depends_on_work_item_id,
      }));

      if (activeCompositeKeysToDelete.length === 0) {
        const allMatchingDeps = await this.workItemRepository.findDependenciesByCompositeKeys(
          compositeKeysToFind,
          { isActive: undefined },
          client
        );
        const nonExistentIds = dependsOnIdsToRemove.filter(
          (idToRemove) => !allMatchingDeps.some((dep) => dep.depends_on_work_item_id === idToRemove)
        );
        if (nonExistentIds.length > 0) {
          throw new ValidationError(`Cannot remove dependencies: Links to ${nonExistentIds.join(', ')} do not exist.`);
        }
        throw new ValidationError(
          `Cannot remove dependencies: Links to ${dependsOnIdsToRemove.join(', ')} are already inactive or do not exist.`
        );
      }

      const deletedCount = await this.workItemRepository.softDeleteDependenciesByCompositeKeys(
        activeCompositeKeysToDelete,
        client
      );
      logger.debug(`[WorkItemDependencyUpdateService] Repository reported ${deletedCount} dependencies soft deleted.`);

      const undoStepsData: CreateUndoStepInput[] = [];
      let stepOrder = 1;
      for (const depToDelete of activeDepsToDeleteDetails) {
        const oldDataForUndo: WorkItemDependencyData = { ...depToDelete };
        const newDataForUndo: Partial<WorkItemDependencyData> = {
          is_active: false,
        };
        undoStepsData.push({
          step_order: stepOrder++,
          step_type: 'UPDATE',
          table_name: 'work_item_dependencies',
          record_id: `${depToDelete.work_item_id}:${depToDelete.depends_on_work_item_id}`,
          old_data: oldDataForUndo,
          new_data: newDataForUndo,
        });
      }

      if (undoStepsData.length > 0) {
        const actionDescription = `Removed ${undoStepsData.length} dependencies from work item "${itemBeforeUpdate.name}"`;
        const actionData: CreateActionHistoryInput = {
          action_type: 'DELETE_DEPENDENCIES',
          work_item_id: workItemId,
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
        logger.info(
          `[WorkItemDependencyUpdateService] Recorded history for removing ${undoStepsData.length} dependencies from work item ${workItemId}.`
        );
      } else {
        logger.info(
          `[WorkItemDependencyUpdateService] deleteDependencies called for ${workItemId}, but no active matching dependencies were deactivated. Skipping history.`
        );
      }
    });

    const fullUpdatedItem = await this.readingService.getWorkItemById(workItemId, { isActive: undefined });
    if (!fullUpdatedItem) {
      logger.error(
        `[WorkItemDependencyUpdateService] Failed to retrieve full details for item ${workItemId} after deleting dependencies.`
      );
      throw new Error(`Failed to retrieve full details for item ${workItemId} after deleting dependencies.`);
    }
    return fullUpdatedItem;
  }
}
