// src/services/WorkItemService.ts
import { v4 as uuidv4 } from 'uuid';
import { PoolClient } from 'pg'; // Need PoolClient type for transactions
import {
  WorkItemRepository,
  WorkItemData,
  WorkItemDependencyData,
} from '../repositories/WorkItemRepository.js';
import {
  ActionHistoryRepository,
  CreateActionHistoryInput,
  CreateUndoStepInput,
  ActionHistoryData,
} from '../repositories/ActionHistoryRepository.js';
import { logger } from '../utils/logger.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';

// --- Input/Output Interfaces ---

export interface AddWorkItemInput {
  parent_work_item_id?: string | null;
  name: string;
  description?: string | null;
  priority?: 'high' | 'medium' | 'low';
  status?: 'todo' | 'in-progress' | 'review' | 'done';
  due_date?: string | null;
  order_key?: string | null;
  shortname?: string | null;
  dependencies?: { depends_on_work_item_id: string; dependency_type?: 'finish-to-start' | 'linked' }[];
  userId?: string;
}

export interface UpdateWorkItemInput {
  parent_work_item_id?: string | null;
  name?: string;
  description?: string | null;
  priority?: 'high' | 'medium' | 'low';
  status?: 'todo' | 'in-progress' | 'review' | 'done';
  due_date?: string | null;
  order_key?: string | null;
  shortname?: string | null;
  userId?: string;
}

export interface ListWorkItemsFilter {
  parent_work_item_id?: string | null;
  rootsOnly?: boolean;
  status?: WorkItemData['status'];
  isActive?: boolean;
}

export interface FullWorkItemData extends WorkItemData {
  dependencies: WorkItemDependencyData[];
  dependents: WorkItemDependencyData[];
  children: WorkItemData[];
}

// --- Service Implementation ---

export class WorkItemService {
  private workItemRepository: WorkItemRepository;
  private actionHistoryRepository: ActionHistoryRepository;

  constructor(
    workItemRepository: WorkItemRepository,
    actionHistoryRepository: ActionHistoryRepository
  ) {
    this.workItemRepository = workItemRepository;
    this.actionHistoryRepository = actionHistoryRepository;
  }

  public async addWorkItem(input: AddWorkItemInput): Promise<WorkItemData> {
    const workItemId = uuidv4();
    const now = new Date().toISOString();
    const parentId = input.parent_work_item_id ?? null;

    const dependenciesToCreate: WorkItemDependencyData[] = input.dependencies?.map(dep => ({
        work_item_id: workItemId,
        depends_on_work_item_id: dep.depends_on_work_item_id,
        dependency_type: dep.dependency_type ?? 'finish-to-start',
        is_active: true,
    })) ?? [];

    logger.debug(`[WorkItemService] Starting transaction to add work item ${workItemId}`);

    try {
        const createdItem = await this.actionHistoryRepository.withTransaction(async (client) => {

            if (parentId) {
                const parentExists = await this.workItemRepository.findById(parentId, { isActive: true }, client);
                if (!parentExists) {
                    throw new ValidationError(`Parent work item with ID ${parentId} not found or is inactive.`);
                }
            }

            const calculatedShortname = input.shortname ?? (await this._calculateShortname(input.name, parentId, undefined, client));
            const calculatedOrderKey = input.order_key ?? (await this._calculateOrderKey(parentId, null, client));

             const newItemData: WorkItemData = {
               work_item_id: workItemId,
               parent_work_item_id: parentId,
               name: input.name,
               shortname: calculatedShortname,
               description: input.description ?? null,
               status: input.status ?? 'todo',
               priority: input.priority ?? 'medium',
               order_key: calculatedOrderKey,
               created_at: now,
               updated_at: now,
               due_date: input.due_date ?? null,
               is_active: true,
             };

            const item = await this.workItemRepository.create(client, newItemData, dependenciesToCreate);

            const actionDescription = `Added work item "${item.name}"`;
            const actionData: CreateActionHistoryInput = {
                user_id: input.userId ?? null,
                action_type: 'ADD_WORK_ITEM',
                work_item_id: item.work_item_id,
                description: actionDescription,
            };

            const undoStepsData: CreateUndoStepInput[] = [];
            undoStepsData.push({
                step_order: 1, step_type: 'DELETE', table_name: 'work_items', record_id: item.work_item_id, old_data: null, new_data: item as any,
            });
            dependenciesToCreate.forEach((dep, index) => {
                 undoStepsData.push({
                     step_order: 2 + index, step_type: 'DELETE', table_name: 'work_item_dependencies', record_id: `${dep.work_item_id}:${dep.depends_on_work_item_id}`, old_data: null, new_data: dep as any,
                 });
            });

            const createdAction = await this.actionHistoryRepository.createActionInClient(actionData, client);
            for (const step of undoStepsData) {
                 await this.actionHistoryRepository.createUndoStepInClient({...step, action_id: createdAction.action_id }, client);
            }

            const recentUndoActions = await this.actionHistoryRepository.findRecentUndoActionsInClient(client);
            for (const undoAction of recentUndoActions) {
                 await this.actionHistoryRepository.markUndoActionAsRedone(undoAction.action_id, createdAction.action_id, client);
            }

            logger.info(`[WorkItemService] Added work item ${workItemId} and recorded history`);
            return item;
        });
        return createdItem;
    } catch (error: unknown) {
      if (error instanceof ValidationError) {
          logger.warn(`[WorkItemService] Validation error adding work item "${input.name}": ${error.message}`);
      } else {
          logger.error(`[WorkItemService] Error adding work item "${input.name}":`, error);
      }
      throw error;
    }
  }

  public async getWorkItemById(id: string, filter?: { isActive?: boolean }): Promise<FullWorkItemData | null> {
    logger.debug(`[WorkItemService] Getting work item by ID: ${id} with filter:`, filter);
    const item = await this.workItemRepository.findById(id, filter); // No client needed for standalone read

    if (!item) {
      logger.warn(`[WorkItemService] Work item ${id} not found or filtered out.`);
      return null;
    }

    // No client needed for standalone reads
    const [dependencies, dependents, children] = await Promise.all([
      this.workItemRepository.findDependencies(id, { isActive: true, dependsOnActive: true }),
      this.workItemRepository.findDependents(id, { isActive: true, dependentIsActive: true }),
      this.workItemRepository.findChildren(id, { isActive: true }),
    ]);

    const fullData: FullWorkItemData = { ...item, dependencies, dependents, children };
    return fullData;
  }


  public async listWorkItems(filter: ListWorkItemsFilter): Promise<WorkItemData[]> {
    logger.debug(`[WorkItemService] Listing work items with filter:`, filter);
    try {
      const isActiveFilter = filter.isActive === undefined ? true : filter.isActive;
      const parentId = filter.parent_work_item_id === undefined ? undefined : filter.parent_work_item_id ?? null;

      let items: WorkItemData[];

      // No client needed for standalone reads
      if (filter.rootsOnly === true || parentId === null) {
        items = await this.workItemRepository.findRoots({ isActive: isActiveFilter });
        logger.info(`[WorkItemService] Listed ${items.length} root items (active: ${isActiveFilter}).`);
      } else if (parentId !== undefined && typeof parentId === 'string') {
        items = await this.workItemRepository.findChildren(parentId, { isActive: isActiveFilter });
         logger.info(`[WorkItemService] Listed ${items.length} children for parent ${parentId} (active: ${isActiveFilter}).`);
      } else {
         logger.info(`[WorkItemService] Listing all items (active: ${isActiveFilter}).`);
         items = await this.workItemRepository.findAll({ isActive: isActiveFilter });
      }

      if (filter.status) {
        items = items.filter((item) => item.status === filter.status);
      }
      return items;
    } catch (error: unknown) {
      logger.error(`[WorkItemService] Error listing work items:`, error);
      throw error;
    }
  }


  public async updateWorkItem(
    id: string,
    updates: UpdateWorkItemInput,
    dependenciesInput?: { depends_on_work_item_id: string; dependency_type?: 'finish-to-start' | 'linked' }[],
  ): Promise<FullWorkItemData> {
    logger.debug(`[WorkItemService] Updating work item ${id} with data:`, {updates, hasDependencies: dependenciesInput !== undefined});

    const updatedItem = await this.actionHistoryRepository.withTransaction(async (client) => {

        const existingItem = await this.workItemRepository.findById(id, { isActive: false }, client);
        if (!existingItem) throw new NotFoundError(`Work item with ID ${id} not found.`);

         const existingDependencies = await this.workItemRepository.findDependencies(id, { isActive: false }, client);
         const existingDependents = await this.workItemRepository.findDependents(id, { isActive: false }, client);
         const allRelatedExistingDependencies = [...existingDependencies, ...existingDependents];
         const uniqueRelatedExistingDependencies = Array.from(new Map(allRelatedExistingDependencies.map(dep => [`${dep.work_item_id}:${dep.depends_on_work_item_id}`, dep])).values());

        const updatePayload: Partial<WorkItemData> = { ...updates };
        delete updatePayload.is_active;

        const nameChanged = updates.name !== undefined && updates.name !== existingItem.name;
        const parentChanged = updates.parent_work_item_id !== undefined && updates.parent_work_item_id !== existingItem.parent_work_item_id;

        if (parentChanged && updates.parent_work_item_id !== null) {
             const newParentExists = await this.workItemRepository.findById(updates.parent_work_item_id!, { isActive: true }, client);
             if (!newParentExists) throw new ValidationError(`New parent work item with ID ${updates.parent_work_item_id} not found or is inactive.`);
        }

        if ((nameChanged || parentChanged) && updates.shortname === undefined) {
          const newName = updates.name ?? existingItem.name;
          const newParentId = parentChanged ? (updates.parent_work_item_id ?? null) : existingItem.parent_work_item_id; // FIX: Corrected to existingItem.parent_work_item_id
          updatePayload.shortname = await this._calculateShortname(newName, newParentId, id, client);
        }
        if (parentChanged && updates.order_key === undefined) {
           const newParentId = updates.parent_work_item_id ?? null;
           updatePayload.order_key = await this._calculateOrderKey(newParentId, null, client);
        }

        const dependenciesToUpdateRepo: WorkItemDependencyData[] | undefined = dependenciesInput?.map(dep => ({
            work_item_id: id,
            depends_on_work_item_id: dep.depends_on_work_item_id,
            dependency_type: dep.dependency_type ?? 'finish-to-start',
            is_active: true,
        }));

        await this.workItemRepository.update(client, id, updatePayload, dependenciesToUpdateRepo);

         const itemAfterUpdate = await this.workItemRepository.findById(id, { isActive: false }, client);
         if (!itemAfterUpdate) throw new Error(`Failed to fetch item state after update for history recording: ${id}`);
         // Fetch dependencies state AFTER the update for history recording
         // Fetch all related dependencies (active/inactive) after the update
         const depsAfterUpdate = [
            ...(await this.workItemRepository.findDependencies(id, { isActive: false }, client)),
            ...(await this.workItemRepository.findDependents(id, { isActive: false }, client))
         ];
         const uniqueDepsAfterUpdate = Array.from(new Map(depsAfterUpdate.map(dep => [`${dep.work_item_id}:${dep.depends_on_work_item_id}`, dep])).values());


        const actionDescription = `Updated work item "${itemAfterUpdate.name}"`;
        const actionData: CreateActionHistoryInput = {
            user_id: updates.userId ?? null, action_type: 'UPDATE_WORK_ITEM', work_item_id: id, description: actionDescription,
        };

        const undoStepsData: CreateUndoStepInput[] = [];
        let stepOrder = 1;

        let itemChanged = false;
        for (const key of Object.keys(updatePayload)) {
            if (key === 'userId') continue;
            if (existingItem[key as keyof WorkItemData] !== itemAfterUpdate[key as keyof WorkItemData]) { itemChanged = true; break; }
        }
        if (itemChanged) {
            undoStepsData.push({
                step_order: stepOrder++, step_type: 'UPDATE', table_name: 'work_items', record_id: id, old_data: existingItem as any, new_data: itemAfterUpdate as any,
            });
        }

        if (dependenciesInput !== undefined) {
             // Compare uniqueRelatedExistingDependencies with uniqueDepsAfterUpdate
             const deactivatedDeps = uniqueRelatedExistingDependencies.filter(existingDep =>
                 existingDep.is_active &&
                 !uniqueDepsAfterUpdate.some(newDep => newDep.work_item_id === existingDep.work_item_id && newDep.depends_on_work_item_id === existingDep.depends_on_work_item_id && newDep.is_active)
             );
              const activatedDeps = uniqueDepsAfterUpdate.filter(newDep =>
                  newDep.is_active &&
                  !uniqueRelatedExistingDependencies.some(existingDep => existingDep.work_item_id === newDep.work_item_id && existingDep.depends_on_work_item_id === newDep.depends_on_work_item_id && existingDep.is_active)
              );

             deactivatedDeps.forEach(dep => {
                  const recordId = `${dep.work_item_id}:${dep.depends_on_work_item_id}`;
                  undoStepsData.push({
                       step_order: stepOrder++, step_type: 'UPDATE', table_name: 'work_item_dependencies', record_id: recordId, old_data: { ...dep, is_active: true } as any, new_data: { ...dep, is_active: false } as any,
                  });
             });
             activatedDeps.forEach(dep => {
                  const recordId = `${dep.work_item_id}:${dep.depends_on_work_item_id}`;
                  const oldState = uniqueRelatedExistingDependencies.find(oldDep => oldDep.work_item_id === dep.work_item_id && oldDep.depends_on_work_item_id === dep.depends_on_work_item_id) ?? { ...dep, is_active: false };
                  undoStepsData.push({
                       step_order: stepOrder++, step_type: 'UPDATE', table_name: 'work_item_dependencies', record_id: recordId, old_data: oldState as any, new_data: dep as any,
                  });
             });
        }

        if(undoStepsData.length > 0) { // Only create action if something actually changed
            const createdAction = await this.actionHistoryRepository.createActionInClient(actionData, client);
            for (const step of undoStepsData) {
                await this.actionHistoryRepository.createUndoStepInClient({...step, action_id: createdAction.action_id }, client);
            }

            const recentUndoActions = await this.actionHistoryRepository.findRecentUndoActionsInClient(client);
            for (const undoAction of recentUndoActions) {
                await this.actionHistoryRepository.markUndoActionAsRedone(undoAction.action_id, createdAction.action_id, client);
            }
        } else {
             logger.info(`[WorkItemService] Update called for ${id}, but no changes detected. Skipping history.`);
        }

        logger.info(`[WorkItemService] Updated work item ${id} and recorded history (if changed).`);
        return itemAfterUpdate;
    });

     const fullUpdatedItem = await this.getWorkItemById(updatedItem.work_item_id, { isActive: false });
     if (!fullUpdatedItem) throw new Error(`Failed to retrieve full details for updated item ${updatedItem.work_item_id}.`);
     return fullUpdatedItem;
  }

  public async deleteWorkItem(ids: string[], userId?: string): Promise<number> {
    if (!ids || ids.length === 0) {
      logger.warn('[WorkItemService] deleteWorkItem called with empty ID array.'); return 0;
    }
    logger.warn(`[WorkItemService] Attempting to soft delete ${ids.length} work item(s) and cascade: ${ids.join(', ')}`);
    let totalDeletedCount = 0;

    await this.actionHistoryRepository.withTransaction(async (client) => {
        const itemsToDelete: Set<string> = new Set();
        const initialItems = [...ids];
        const queue: string[] = [...ids];
        const visited: Set<string> = new Set(ids);

        while (queue.length > 0) {
            const currentId = queue.shift()!;
            itemsToDelete.add(currentId);
            const children = await this.workItemRepository.findChildren(currentId, { isActive: false }, client);
            for (const child of children) {
                if (!visited.has(child.work_item_id)) {
                    visited.add(child.work_item_id); queue.push(child.work_item_id);
                }
            }
        }
        const itemsToDeleteArray = Array.from(itemsToDelete);

         const allDeps = await this.workItemRepository.findDependenciesByItemList(itemsToDeleteArray, { isActive: false }, client);
         const allDependents = await this.workItemRepository.findDependentsByItemList(itemsToDeleteArray, { isActive: false }, client);

         const depsToDeleteCompositeKeys: Set<string> = new Set();
         // Add links where BOTH ends are being deleted
         allDeps.forEach(dep => {
             if (itemsToDelete.has(dep.depends_on_work_item_id)) { // Check if target is also being deleted
                  depsToDeleteCompositeKeys.add(`${dep.work_item_id}:${dep.depends_on_work_item_id}`);
             }
         });
         allDependents.forEach((dep: WorkItemDependencyData) => {
             // No need to check source here, as findDependentsByItemList already ensures the source (dep.work_item_id) is in itemsToDeleteArray
             depsToDeleteCompositeKeys.add(`${dep.work_item_id}:${dep.depends_on_work_item_id}`);
         });
        const depsToDeleteCompositeKeysArray = Array.from(depsToDeleteCompositeKeys);

        const itemsOldData = await this.workItemRepository.findByIds(itemsToDeleteArray, { isActive: true }, client);
         const depsToDeleteObjects = depsToDeleteCompositeKeysArray.map(keyString => {
             const [work_item_id, depends_on_work_item_id] = keyString.split(':');
             if (!work_item_id || !depends_on_work_item_id) throw new Error(`Invalid composite key string format: ${keyString}`);
             return { work_item_id, depends_on_work_item_id };
         });
        const depsOldData = await this.workItemRepository.findDependenciesByCompositeKeys(depsToDeleteObjects, { isActive: true }, client);

        const activeItemIdsToDelete = itemsOldData.map(item => item.work_item_id);
        if (activeItemIdsToDelete.length > 0) {
             totalDeletedCount = await this.workItemRepository.softDelete(activeItemIdsToDelete, client);
             logger.info(`[WorkItemService] Soft deleted ${totalDeletedCount} work item(s).`);
        } else { totalDeletedCount = 0; logger.info(`[WorkItemService] No active work items found to soft delete from the cascade list.`);}

        const activeDepsToDeleteObjects = depsOldData.map(dep => ({ work_item_id: dep.work_item_id, depends_on_work_item_id: dep.depends_on_work_item_id }));
        if (activeDepsToDeleteObjects.length > 0) {
            const deletedDepsCount = await this.workItemRepository.softDeleteDependenciesByCompositeKeys(activeDepsToDeleteObjects, client);
             logger.info(`[WorkItemService] Soft deleted ${deletedDepsCount} active dependency link(s).`);
        } else { logger.info(`[WorkItemService] No active dependency links found to soft delete within the cascade.`); }

        if (totalDeletedCount > 0 || depsOldData.length > 0) {
            const actionDescription = `Deleted ${totalDeletedCount} work item(s) and related active links (cascade)`;
            const actionData: CreateActionHistoryInput = {
                user_id: userId ?? null, action_type: 'DELETE_WORK_ITEM_CASCADE', work_item_id: initialItems.length === 1 ? initialItems[0] : null, description: actionDescription,
            };

            const undoStepsData: CreateUndoStepInput[] = []; let stepOrder = 1;
            itemsOldData.forEach(item => {
                 undoStepsData.push({ step_order: stepOrder++, step_type: 'UPDATE', table_name: 'work_items', record_id: item.work_item_id, old_data: item as any, new_data: { ...item, is_active: false } as any });
            });
             depsOldData.forEach(dep => {
                 const depRecordId = `${dep.work_item_id}:${dep.depends_on_work_item_id}`;
                 undoStepsData.push({ step_order: stepOrder++, step_type: 'UPDATE', table_name: 'work_item_dependencies', record_id: depRecordId, old_data: dep as any, new_data: { ...dep, is_active: false } as any });
             });

            const createdAction = await this.actionHistoryRepository.createActionInClient(actionData, client);
             for (const step of undoStepsData) { await this.actionHistoryRepository.createUndoStepInClient({...step, action_id: createdAction.action_id }, client); }
             const recentUndoActions = await this.actionHistoryRepository.findRecentUndoActionsInClient(client);
             for (const undoAction of recentUndoActions) { await this.actionHistoryRepository.markUndoActionAsRedone(undoAction.action_id, createdAction.action_id, client); }
        } else { logger.info('[WorkItemService] No active items or links were deleted, skipping history recording.'); }
    });
    return totalDeletedCount;
  }

  // --- New History/Undo/Redo Methods ---

  public async undoLastAction(userId?: string): Promise<ActionHistoryData | null> {
      logger.info(`[WorkItemService] Attempting to undo last action for user ${userId ?? 'unknown'}.`);
      const originalActionToUndo = await this.actionHistoryRepository.findLastOriginalAction();
      if (!originalActionToUndo) { logger.info('[WorkItemService] No action found to undo.'); return null; }
      const undoSteps = await this.actionHistoryRepository.findUndoStepsByActionId(originalActionToUndo.action_id);

      if (undoSteps.length === 0) {
           logger.warn(`[WorkItemService] Action ${originalActionToUndo.action_id} found to undo, but has no undo steps. Marking as undone.`);
           await this.actionHistoryRepository.withTransaction(async (client) => {
                 const undoActionData: CreateActionHistoryInput = {
                     user_id: userId ?? null, action_type: 'UNDO_ACTION', work_item_id: originalActionToUndo.work_item_id, description: `Could not undo action (no steps): "${originalActionToUndo.description}"`,
                 };
                 const createdUndoAction = await this.actionHistoryRepository.createActionInClient(undoActionData, client);
                 await this.actionHistoryRepository.markActionAsUndone(originalActionToUndo.action_id, createdUndoAction.action_id, client);

                 const recentUndoActions = await this.actionHistoryRepository.findRecentUndoActionsInClient(client);
                 for (const undoAction of recentUndoActions) {
                      if (undoAction.action_id !== createdUndoAction.action_id) {
                         await this.actionHistoryRepository.markUndoActionAsRedone(undoAction.action_id, createdUndoAction.action_id, client);
                      }
                 }
           });
           return null;
      }

      const undoneAction = await this.actionHistoryRepository.withTransaction(async (client) => {
          logger.debug(`[WorkItemService] Executing ${undoSteps.length} undo steps for action ${originalActionToUndo.action_id} in reverse order`);
          const stepsInReverse = [...undoSteps].sort((a, b) => b.step_order - a.step_order);
          for (const step of stepsInReverse) {
              logger.debug(`[WorkItemService] Executing undo step ${step.step_order} (${step.step_type}) on ${step.table_name} record ${step.record_id}`);
              try {
                  if (step.step_type === 'UPDATE') {
                      if (!step.old_data) throw new Error(`Undo step ${step.undo_step_id} (UPDATE) is missing old_data.`);
                      await this.workItemRepository.updateRowState(client, step.table_name, step.old_data);
                  } else if (step.step_type === 'DELETE') {
                      if (!step.new_data) throw new Error(`Undo step ${step.undo_step_id} (DELETE reversal - INSERT) is missing new_data.`);
                      await this.workItemRepository.insertRow(client, step.table_name, step.new_data);
                  } else if (step.step_type === 'INSERT') {
                       if (!step.record_id) throw new Error(`Undo step ${step.undo_step_id} (INSERT reversal - DELETE) is missing record_id.`);
                       await this.workItemRepository.deleteRow(client, step.table_name, step.record_id);
                  } else { throw new Error(`Unknown undo step type: ${step.step_type}`); }
              } catch (stepError: unknown) {
                   logger.error(`[WorkItemService] Error executing undo step ${step.undo_step_id}:`, stepError);
                   if (stepError instanceof NotFoundError) throw new Error(`Undo failed: Row ${step.record_id} not found in ${step.table_name}.`);
                   if (stepError instanceof Error && stepError.message.includes('Conflict: Cannot insert row')) throw new Error(`Undo failed: Cannot insert row for step ${step.undo_step_id} because it already exists.`);
                   throw stepError;
              }
          }

           const undoActionData: CreateActionHistoryInput = {
               user_id: userId ?? null, action_type: 'UNDO_ACTION', work_item_id: originalActionToUndo.work_item_id, description: `Undid action: "${originalActionToUndo.description}"`,
           };
           const createdUndoAction = await this.actionHistoryRepository.createActionInClient(undoActionData, client);
           // Link the original action to this undo action
           await this.actionHistoryRepository.markActionAsUndone(originalActionToUndo.action_id, createdUndoAction.action_id, client);

           const recentUndoActions = await this.actionHistoryRepository.findRecentUndoActionsInClient(client);
           for (const undoAction of recentUndoActions) {
               if (undoAction.action_id !== createdUndoAction.action_id) {
                  await this.actionHistoryRepository.markUndoActionAsRedone(undoAction.action_id, createdUndoAction.action_id, client);
               }
           }
          return originalActionToUndo;
      });
      return undoneAction;
  }

   public async redoLastUndo(userId?: string): Promise<ActionHistoryData | null> {
        logger.info(`[WorkItemService] Attempting to redo last undo action for user ${userId ?? 'unknown'}.`);
        const undoActionToRedo = await this.actionHistoryRepository.findLastUndoAction();
        if (!undoActionToRedo) { logger.info('[WorkItemService] No undo action found to redo.'); return null; }

        // Find the original action that this UNDO_ACTION reversed
        // The original action ID is stored on the UNDO action when it's marked as undone
        const originalActionId = undoActionToRedo.undone_at_action_id;
        if (!originalActionId) {
            logger.error(`[WorkItemService] UNDO_ACTION ${undoActionToRedo.action_id} is missing the link (undone_at_action_id) to the original action it undid.`);
            return null;
        }
        const originalAction = await this.actionHistoryRepository.findActionById(originalActionId);
        if (!originalAction) { logger.error(`[WorkItemService] UNDO_ACTION ${undoActionToRedo.action_id} refers to missing original action ${originalActionId}.`); return null; }

        const originalUndoSteps = await this.actionHistoryRepository.findUndoStepsByActionId(originalAction.action_id);

         if (originalUndoSteps.length === 0) {
             logger.warn(`[WorkItemService] Original action ${originalAction.action_id} (referenced by undo ${undoActionToRedo.action_id}) has no undo steps. Cannot redo.`);
              await this.actionHistoryRepository.withTransaction(async (client) => {
                  const redoActionData: CreateActionHistoryInput = {
                     user_id: userId ?? null, action_type: 'REDO_ACTION', work_item_id: originalAction.work_item_id, description: `Could not redo action (no steps): "${originalAction.description}"`,
                 };
                 const createdRedoAction = await this.actionHistoryRepository.createActionInClient(redoActionData, client);
                 // Mark the UNDO action as redone by this new REDO action
                 await this.actionHistoryRepository.markUndoActionAsRedone(undoActionToRedo.action_id, createdRedoAction.action_id, client);
              });
             return null;
         }

        const redoneAction = await this.actionHistoryRepository.withTransaction(async (client) => {
             logger.debug(`[WorkItemService] Executing redo logic (${originalUndoSteps.length} steps) for original action ${originalAction.action_id}`);
             const stepsInOrder = [...originalUndoSteps].sort((a, b) => a.step_order - b.step_order);
             for (const step of stepsInOrder) {
                logger.debug(`[WorkItemService] Executing redo logic for step ${step.step_order} (${step.step_type}) on ${step.table_name} record ${step.record_id}`);
                 try {
                     if (step.step_type === 'UPDATE') {
                        if (!step.new_data) throw new Error(`Undo step ${step.undo_step_id} (UPDATE) is missing new_data for redo.`);
                        await this.workItemRepository.updateRowState(client, step.table_name, step.new_data);
                     } else if (step.step_type === 'DELETE') { // Original action was ADD
                         if (!step.record_id) throw new Error(`Undo step ${step.undo_step_id} (DELETE reversal) is missing record_id for redo.`); // FIX: Corrected step.record_id
                         await this.workItemRepository.deleteRow(client, step.table_name, step.record_id); // FIX: Corrected step.record_id
                     } else if (step.step_type === 'INSERT') { // Original action was DELETE
                         if (!step.old_data) throw new Error(`Undo step ${step.undo_step_id} (INSERT reversal) is missing old_data for redo.`);
                          await this.workItemRepository.insertRow(client, step.table_name, step.old_data);
                     } else { throw new Error(`Unknown redo step type: ${step.step_type}`); }
                 } catch (stepError: unknown) {
                     logger.error(`[WorkItemService] Error executing redo step logic ${step.undo_step_id}:`, stepError);
                      if (stepError instanceof Error && stepError.message.includes('Conflict: Cannot insert row')) throw new Error(`Redo failed: Cannot re-create row for step ${step.step_order} because it already exists.`);
                     throw stepError;
                 }
             }

             const redoActionData: CreateActionHistoryInput = {
                 user_id: userId ?? null, action_type: 'REDO_ACTION', work_item_id: originalAction.work_item_id, description: `Redid action: "${originalAction.description}"`,
             };
             const createdRedoAction = await this.actionHistoryRepository.createActionInClient(redoActionData, client);
             // Mark the UNDO action as redone by this REDO action
             await this.actionHistoryRepository.markUndoActionAsRedone(undoActionToRedo.action_id, createdRedoAction.action_id, client);
             return originalAction;
        });
        return redoneAction;
   }

   // Added private methods for calculating shortname and order key
   private async _calculateShortname(
       name: string,
       parentId: string | null,
       currentItemId: string | undefined, // Add this parameter
       client: PoolClient // Keep client parameter for repository calls
   ): Promise<string | null> {
       logger.warn('[WorkItemService] _calculateShortname needs implementation!');
       // TODO: Implement shortname calculation logic here
       // This might involve checking siblings' shortnames for uniqueness within the parent context
       // and generating a short, unique identifier based on the name.
       // For now, returning null as a placeholder.
       return null;
   }

   private async _calculateOrderKey(
       parentId: string | null,
       beforeItemId: string | null, // Assuming this is needed for insertion point, currently unused in calls
       client: PoolClient // Keep client parameter for repository calls
   ): Promise<string | null> {
        logger.warn('[WorkItemService] _calculateOrderKey needs implementation!');
       // TODO: Implement order key calculation logic here
       // This typically involves fetching adjacent sibling order keys and generating a new one
       // that fits lexicographically between them.
       // The WorkItemRepository has a getAdjacentOrderKeys method that is a placeholder.
       // You'll need to implement that repository method and use it here.
       // For now, returning null as a placeholder.
       return null;
   }


}