// src/services/WorkItemDeleteService.ts
import {
    WorkItemRepository,
    WorkItemDependencyData,
  } from '../repositories/WorkItemRepository.js';
  import {
    ActionHistoryRepository,
    CreateActionHistoryInput,
    CreateUndoStepInput,
  } from '../repositories/ActionHistoryRepository.js';
  import { logger } from '../utils/logger.js';
  
  /**
   * Service responsible for deleting work items
   */
  export class WorkItemDeleteService {
    private workItemRepository: WorkItemRepository;
    private actionHistoryRepository: ActionHistoryRepository;
  
    constructor(
      workItemRepository: WorkItemRepository,
      actionHistoryRepository: ActionHistoryRepository
    ) {
      this.workItemRepository = workItemRepository;
      this.actionHistoryRepository = actionHistoryRepository;
    }
  
    /**
     * Soft deletes work items and their dependencies.
     */
    public async deleteWorkItem(ids: string[]): Promise<number> {
      if (!ids || ids.length === 0) {
        logger.warn('[WorkItemDeleteService] deleteWorkItem called with empty ID array.');
        return 0;
      }
      
      logger.warn(`[WorkItemDeleteService] Attempting to soft delete ${ids.length} work item(s) and cascade: ${ids.join(', ')}`);
      let totalDeletedCount = 0;
  
      await this.actionHistoryRepository.withTransaction(async (client) => {
          const itemsToDelete: Set<string> = new Set();
          const initialItems = [...ids];
          const queue: string[] = [...ids];
          const visited: Set<string> = new Set(ids);
  
          // Find all items to be deleted (including children)
          while (queue.length > 0) {
              const currentId = queue.shift()!;
              itemsToDelete.add(currentId);
              const children = await this.workItemRepository.findChildren(currentId, { isActive: false }, client);
              for (const child of children) {
                  if (!visited.has(child.work_item_id)) {
                      visited.add(child.work_item_id);
                      queue.push(child.work_item_id);
                  }
              }
          }
          const itemsToDeleteArray = Array.from(itemsToDelete);
  
          // Find dependencies to delete
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
              // No need to check source here, as findDependentsByItemList already ensures the source is in itemsToDeleteArray
              depsToDeleteCompositeKeys.add(`${dep.work_item_id}:${dep.depends_on_work_item_id}`);
          });
          const depsToDeleteCompositeKeysArray = Array.from(depsToDeleteCompositeKeys);
  
          // Get current data for undo history
          const itemsOldData = await this.workItemRepository.findByIds(itemsToDeleteArray, { isActive: true }, client);
          const depsToDeleteObjects = depsToDeleteCompositeKeysArray.map(keyString => {
              const [work_item_id, depends_on_work_item_id] = keyString.split(':');
              if (!work_item_id || !depends_on_work_item_id) {
                  throw new Error(`Invalid composite key string format: ${keyString}`);
              }
              return { work_item_id, depends_on_work_item_id };
          });
          const depsOldData = await this.workItemRepository.findDependenciesByCompositeKeys(
              depsToDeleteObjects, { isActive: true }, client
          );
  
          // Perform the soft deletions
          const activeItemIdsToDelete = itemsOldData.map(item => item.work_item_id);
          if (activeItemIdsToDelete.length > 0) {
              totalDeletedCount = await this.workItemRepository.softDelete(activeItemIdsToDelete, client);
              logger.info(`[WorkItemDeleteService] Soft deleted ${totalDeletedCount} work item(s).`);
          } else {
              totalDeletedCount = 0;
              logger.info(`[WorkItemDeleteService] No active work items found to soft delete from the cascade list.`);
          }
  
          const activeDepsToDeleteObjects = depsOldData.map(dep => ({ 
              work_item_id: dep.work_item_id, 
              depends_on_work_item_id: dep.depends_on_work_item_id 
          }));
          if (activeDepsToDeleteObjects.length > 0) {
              const deletedDepsCount = await this.workItemRepository.softDeleteDependenciesByCompositeKeys(
                  activeDepsToDeleteObjects, client
              );
              logger.info(`[WorkItemDeleteService] Soft deleted ${deletedDepsCount} active dependency link(s).`);
          } else {
              logger.info(`[WorkItemDeleteService] No active dependency links found to soft delete within the cascade.`);
          }
  
          // Record history for undoing
          if (totalDeletedCount > 0 || depsOldData.length > 0) {
              const actionDescription = `Deleted ${totalDeletedCount} work item(s) and related active links (cascade)`;
              const actionData: CreateActionHistoryInput = {
                  user_id: null, // Always null now that userId is removed
                  action_type: 'DELETE_WORK_ITEM_CASCADE',
                  work_item_id: initialItems.length === 1 ? initialItems[0] : null,
                  description: actionDescription,
              };
  
              const undoStepsData: CreateUndoStepInput[] = [];
              let stepOrder = 1;
              
              itemsOldData.forEach(item => {
                  undoStepsData.push({ 
                      step_order: stepOrder++, 
                      step_type: 'UPDATE', 
                      table_name: 'work_items', 
                      record_id: item.work_item_id, 
                      old_data: item as any, 
                      new_data: { ...item, is_active: false } as any 
                  });
              });
              
              depsOldData.forEach(dep => {
                  const depRecordId = `${dep.work_item_id}:${dep.depends_on_work_item_id}`;
                  undoStepsData.push({ 
                      step_order: stepOrder++, 
                      step_type: 'UPDATE', 
                      table_name: 'work_item_dependencies', 
                      record_id: depRecordId, 
                      old_data: dep as any, 
                      new_data: { ...dep, is_active: false } as any 
                  });
              });
  
              const createdAction = await this.actionHistoryRepository.createActionInClient(actionData, client);
              for (const step of undoStepsData) { 
                  await this.actionHistoryRepository.createUndoStepInClient(
                      {...step, action_id: createdAction.action_id }, client
                  );
              }
              
              const recentUndoActions = await this.actionHistoryRepository.findRecentUndoActionsInClient(client);
              for (const undoAction of recentUndoActions) {
                  await this.actionHistoryRepository.markUndoActionAsRedone(
                      undoAction.action_id, createdAction.action_id, client
                  );
              }
          } else {
              logger.info('[WorkItemDeleteService] No active items or links were deleted, skipping history recording.');
          }
      });
      
      return totalDeletedCount;
    }
  }