// src/services/WorkItemDependencyUpdateService.ts
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
import { FullWorkItemData } from './WorkItemServiceTypes.js';
import { WorkItemReadingService } from './WorkItemReadingService.js';
import { WorkItemHistoryService } from './WorkItemHistoryService.js';
import { PoolClient } from 'pg';
import { DependencyInput } from '../tools/add_dependencies_params.js';

/**
 * Service responsible for updating work item dependencies.
 */
export class WorkItemDependencyUpdateService {
  private workItemRepository: WorkItemRepository;
  private actionHistoryRepository: ActionHistoryRepository;
  private readingService: WorkItemReadingService; // Needed to return FullWorkItemData
  private historyService: WorkItemHistoryService; // For history

  constructor(workItemRepository: WorkItemRepository, actionHistoryRepository: ActionHistoryRepository) {
    this.workItemRepository = workItemRepository;
    this.actionHistoryRepository = actionHistoryRepository;
    this.readingService = new WorkItemReadingService(workItemRepository);
    this.historyService = new WorkItemHistoryService(workItemRepository, actionHistoryRepository);
  }

  /**
   * Adds or updates dependency links for a specific work item.
   */
  public async addDependencies(workItemId: string, dependenciesToAdd: DependencyInput[]): Promise<FullWorkItemData> {
    logger.info(
      `[WorkItemDependencyUpdateService] Adding/updating ${dependenciesToAdd.length} dependencies for work item ${workItemId}`
    );

    let itemBeforeUpdate: WorkItemData | undefined;
    const depsBeforeUpdateMap: Map<string, WorkItemDependencyData> = new Map();

    if (!dependenciesToAdd || dependenciesToAdd.length === 0) {
      throw new ValidationError('No dependencies provided to add.');
    }
    const targetDepIds = dependenciesToAdd.map((dep) => dep.depends_on_work_item_id);
    if (targetDepIds.includes(workItemId)) {
      throw new ValidationError('A work item cannot depend on itself.');
    }

    await this.actionHistoryRepository.withTransaction(async (client: PoolClient) => {
      itemBeforeUpdate = await this.workItemRepository.findById(workItemId, { isActive: true });
      if (!itemBeforeUpdate) {
        throw new NotFoundError(`Work item with ID ${workItemId} not found or is inactive.`);
      }

      const targetItems = await this.workItemRepository.findByIds(targetDepIds, { isActive: true });
      const foundTargetIds = new Set(targetItems.map((item) => item.work_item_id));
      const missingTargetIds = targetDepIds.filter((id) => !foundTargetIds.has(id));
      if (missingTargetIds.length > 0) {
        const inactiveTargets = await this.workItemRepository.findByIds(missingTargetIds, { isActive: false });
        const trulyMissing = missingTargetIds.filter((id) => !inactiveTargets.some((it) => it.work_item_id === id));
        if (trulyMissing.length > 0) {
          throw new NotFoundError(`Target dependency work items not found: ${trulyMissing.join(', ')}`);
        } else {
          throw new ValidationError(
            `Target dependency work items are inactive: ${missingTargetIds.filter((id) => inactiveTargets.some((it) => it.work_item_id === id)).join(', ')}`
          );
        }
      }

      const existingDeps = await this.workItemRepository.findDependencies(workItemId, { isActive: false });
      existingDeps.forEach((dep) => depsBeforeUpdateMap.set(dep.depends_on_work_item_id, dep));

      const depsToUpsert: WorkItemDependencyData[] = dependenciesToAdd.map((depInput) => ({
        work_item_id: workItemId,
        depends_on_work_item_id: depInput.depends_on_work_item_id,
        dependency_type: depInput.dependency_type ?? 'finish-to-start',
        is_active: true,
      }));

      await this.workItemRepository.addOrUpdateDependencies(client, workItemId, depsToUpsert);

      const depsAfterUpdate = await this.workItemRepository.findDependencies(workItemId, { isActive: false });
      const depsAfterUpdateMap = new Map<string, WorkItemDependencyData>();
      depsAfterUpdate.forEach((dep) => depsAfterUpdateMap.set(dep.depends_on_work_item_id, dep));

      const undoStepsData: CreateUndoStepInput[] = [];
      let stepOrder = 1;
      let dependenciesEffectivelyChanged = false;
      for (const depToAdd of depsToUpsert) {
        const targetId = depToAdd.depends_on_work_item_id;
        const oldDepState = depsBeforeUpdateMap.get(targetId);
        const newDepState = depsAfterUpdateMap.get(targetId);
        const wasAdded = !oldDepState;
        const wasReactivated = oldDepState && !oldDepState.is_active && newDepState?.is_active;
        const typeChanged = oldDepState && newDepState && oldDepState.dependency_type !== newDepState.dependency_type;
        const effectiveChange = wasAdded || wasReactivated || typeChanged;

        if (effectiveChange) {
          dependenciesEffectivelyChanged = true;
          const oldDataForUndo = oldDepState ?? null;
          const newDataForUndo = newDepState;
          if (!newDataForUndo) {
            logger.warn(
              `[WorkItemDependencyUpdateService] Dependency ${workItemId}:${targetId} was expected but not found after upsert for history generation.`
            );
            continue;
          }
          undoStepsData.push({
            step_order: stepOrder++,
            step_type: 'UPDATE',
            table_name: 'work_item_dependencies',
            record_id: `${workItemId}:${targetId}`,
            old_data: oldDataForUndo,
            new_data: newDataForUndo,
          });
        }
      }

      if (dependenciesEffectivelyChanged) {
        const actionDescription = `Added/updated ${undoStepsData.length} dependencies for work item "${itemBeforeUpdate.name}"`;
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
          `[WorkItemDependencyUpdateService] Recorded history for adding dependencies to work item ${workItemId}.`
        );
      } else {
        logger.info(
          `[WorkItemDependencyUpdateService] addDependencies called for ${workItemId}, but no effective changes detected. Skipping history.`
        );
      }
    });

    const fullUpdatedItem = await this.readingService.getWorkItemById(workItemId, { isActive: undefined });
    if (!fullUpdatedItem) {
      logger.error(
        `[WorkItemDependencyUpdateService] Failed to retrieve full details for item ${workItemId} after adding dependencies.`
      );
      throw new Error(`Failed to retrieve full details for item ${workItemId} after adding dependencies.`);
    }
    return fullUpdatedItem;
  }

  /**
   * Deletes (deactivates) specified dependency links for a work item.
   */
  public async deleteDependencies(workItemId: string, dependsOnIdsToRemove: string[]): Promise<FullWorkItemData> {
    logger.info(
      `[WorkItemDependencyUpdateService] Deleting ${dependsOnIdsToRemove.length} dependencies from work item ${workItemId}`
    );

    let itemBeforeUpdate: WorkItemData | undefined;

    if (!dependsOnIdsToRemove || dependsOnIdsToRemove.length === 0) {
      throw new ValidationError('No dependency IDs provided to remove.');
    }

    await this.actionHistoryRepository.withTransaction(async (client: PoolClient) => {
      itemBeforeUpdate = await this.workItemRepository.findById(workItemId, { isActive: true });
      if (!itemBeforeUpdate) {
        throw new NotFoundError(`Work item with ID ${workItemId} not found or is inactive.`);
      }

      const existingActiveDeps = await this.workItemRepository.findDependencies(workItemId, { isActive: true });
      const activeDepsMap = new Map<string, WorkItemDependencyData>();
      existingActiveDeps.forEach((dep) => activeDepsMap.set(dep.depends_on_work_item_id, dep));

      const compositeKeysToDelete: { work_item_id: string; depends_on_work_item_id: string }[] = [];
      const invalidIdsToRemove: string[] = [];
      const depsToDeleteDetails: WorkItemDependencyData[] = [];

      for (const targetId of dependsOnIdsToRemove) {
        const existingDep = activeDepsMap.get(targetId);
        if (existingDep) {
          compositeKeysToDelete.push({ work_item_id: workItemId, depends_on_work_item_id: targetId });
          depsToDeleteDetails.push(existingDep);
        } else {
          invalidIdsToRemove.push(targetId);
        }
      }

      if (invalidIdsToRemove.length > 0) {
        const inactiveDeps = await this.workItemRepository.findDependenciesByCompositeKeys(
          invalidIdsToRemove.map((id) => ({ work_item_id: workItemId, depends_on_work_item_id: id })),
          { isActive: false }
        );
        const trulyMissing = invalidIdsToRemove.filter(
          (id) => !inactiveDeps.some((d) => d.depends_on_work_item_id === id)
        );
        if (trulyMissing.length > 0) {
          throw new ValidationError(`Cannot remove dependencies: Links to ${trulyMissing.join(', ')} do not exist.`);
        } else {
          const inactiveFoundIds = invalidIdsToRemove.filter((id) =>
            inactiveDeps.some((d) => d.depends_on_work_item_id === id)
          );
          throw new ValidationError(
            `Cannot remove dependencies: Links to ${inactiveFoundIds.join(', ')} are already inactive.`
          );
        }
      }

      const deletedCount = await this.workItemRepository.softDeleteDependenciesByCompositeKeys(
        compositeKeysToDelete,
        client
      );
      logger.debug(`[WorkItemDependencyUpdateService] Repository reported ${deletedCount} dependencies soft deleted.`);

      const undoStepsData: CreateUndoStepInput[] = [];
      let stepOrder = 1;
      for (const depToDelete of depsToDeleteDetails) {
        const oldDataForUndo = depToDelete;
        const newDataForUndo: Partial<WorkItemDependencyData> = { is_active: false };
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
          `[WorkItemDependencyUpdateService] Recorded history for removing dependencies from work item ${workItemId}.`
        );
      } else if (compositeKeysToDelete.length > 0 && deletedCount === 0) {
        logger.warn(
          `[WorkItemDependencyUpdateService] deleteDependencies called for ${workItemId}, found matching active deps but repo reported 0 deleted.`
        );
      } else {
        logger.info(
          `[WorkItemDependencyUpdateService] deleteDependencies called for ${workItemId}, but no active matching dependencies found/deleted. Skipping history.`
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
