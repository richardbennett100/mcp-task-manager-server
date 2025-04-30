// src/services/WorkItemUpdateService.ts
import {
  WorkItemRepository,
  WorkItemData,
  WorkItemDependencyData,
} from '../repositories/WorkItemRepository.js';
import {
  ActionHistoryRepository,
  CreateActionHistoryInput,
  CreateUndoStepInput,
} from '../repositories/ActionHistoryRepository.js';
import { logger } from '../utils/logger.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { UpdateWorkItemInput, FullWorkItemData } from './WorkItemServiceTypes.js';
import { WorkItemUtilsService } from './WorkItemUtilsService.js';
import { WorkItemReadingService } from './WorkItemReadingService.js';

/**
 * Service responsible for updating work items
 */
export class WorkItemUpdateService {
  private workItemRepository: WorkItemRepository;
  private actionHistoryRepository: ActionHistoryRepository;
  private utilsService: WorkItemUtilsService;
  private readingService: WorkItemReadingService;

  constructor(
    workItemRepository: WorkItemRepository,
    actionHistoryRepository: ActionHistoryRepository
  ) {
    this.workItemRepository = workItemRepository;
    this.actionHistoryRepository = actionHistoryRepository;
    this.utilsService = new WorkItemUtilsService();
    this.readingService = new WorkItemReadingService(workItemRepository);
  }

  /**
   * Updates a work item and optionally its dependencies.
   */
  public async updateWorkItem(
    id: string,
    updates: UpdateWorkItemInput,
    dependenciesInput?: { depends_on_work_item_id: string; dependency_type?: 'finish-to-start' | 'linked' }[],
  ): Promise<FullWorkItemData> {
    logger.debug(`[WorkItemUpdateService] Updating work item ${id} with data:`, {updates, hasDependencies: dependenciesInput !== undefined});

    const updatedItem = await this.actionHistoryRepository.withTransaction(async (client) => {
        // FIXED: Use undefined to find item regardless of active status
        const existingItem = await this.workItemRepository.findById(id, undefined, client);
        if (!existingItem) throw new NotFoundError(`Work item with ID ${id} not found.`);

        // FIXED: Use undefined to find all dependencies/dependents
        const existingDependencies = await this.workItemRepository.findDependencies(id, undefined, client);
        const existingDependents = await this.workItemRepository.findDependents(id, undefined, client);
        const allRelatedExistingDependencies = [...existingDependencies, ...existingDependents];
        const uniqueRelatedExistingDependencies = Array.from(
            new Map(allRelatedExistingDependencies.map(
                dep => [`${dep.work_item_id}:${dep.depends_on_work_item_id}`, dep]
            )).values()
        );

        const updatePayload: Partial<WorkItemData> = { ...updates };
        delete updatePayload.is_active;

        const nameChanged = updates.name !== undefined && updates.name !== existingItem.name;
        const parentChanged = updates.parent_work_item_id !== undefined && 
                             updates.parent_work_item_id !== existingItem.parent_work_item_id;

        if (parentChanged && updates.parent_work_item_id !== null) {
            const newParentExists = await this.workItemRepository.findById(
                updates.parent_work_item_id!, { isActive: true }, client
            );
            if (!newParentExists) {
                throw new ValidationError(
                    `New parent work item with ID ${updates.parent_work_item_id} not found or is inactive.`
                );
            }
        }

        if ((nameChanged || parentChanged) && updates.shortname === undefined) {
            const newName = updates.name ?? existingItem.name;
            const newParentId = parentChanged ? 
                (updates.parent_work_item_id ?? null) : existingItem.parent_work_item_id;
            updatePayload.shortname = await this.utilsService.calculateShortname(
                newName, newParentId, id, client, this.workItemRepository
            );
        }
        
        if (parentChanged && updates.order_key === undefined) {
            const newParentId = updates.parent_work_item_id ?? null;
            updatePayload.order_key = await this.utilsService.calculateOrderKey(
                newParentId, null, client, this.workItemRepository
            );
        }

        const dependenciesToUpdateRepo: WorkItemDependencyData[] | undefined = dependenciesInput?.map(dep => ({
            work_item_id: id,
            depends_on_work_item_id: dep.depends_on_work_item_id,
            dependency_type: dep.dependency_type ?? 'finish-to-start',
            is_active: true,
        }));

        await this.workItemRepository.update(client, id, updatePayload, dependenciesToUpdateRepo);

        // FIXED: Find item regardless of active status after update
        const itemAfterUpdate = await this.workItemRepository.findById(id, undefined, client);
        if (!itemAfterUpdate) {
            throw new Error(`Failed to fetch item state after update for history recording: ${id}`);
        }
        
        // FIXED: Get all dependencies after update regardless of active status
        const depsAfterUpdate = [
            ...(await this.workItemRepository.findDependencies(id, undefined, client)),
            ...(await this.workItemRepository.findDependents(id, undefined, client))
        ];
        const uniqueDepsAfterUpdate = Array.from(
            new Map(depsAfterUpdate.map(
                dep => [`${dep.work_item_id}:${dep.depends_on_work_item_id}`, dep]
            )).values()
        );

        const actionDescription = `Updated work item "${itemAfterUpdate.name}"`;
        const actionData: CreateActionHistoryInput = {
            user_id: updates.userId ?? null, 
            action_type: 'UPDATE_WORK_ITEM', 
            work_item_id: id, 
            description: actionDescription,
        };

        const undoStepsData: CreateUndoStepInput[] = [];
        let stepOrder = 1;

        let itemChanged = false;
        for (const key of Object.keys(updatePayload)) {
            if (key === 'userId') continue;
            if (existingItem[key as keyof WorkItemData] !== itemAfterUpdate[key as keyof WorkItemData]) { 
                itemChanged = true; 
                break; 
            }
        }
        
        if (itemChanged) {
            undoStepsData.push({
                step_order: stepOrder++, 
                step_type: 'UPDATE', 
                table_name: 'work_items', 
                record_id: id, 
                old_data: existingItem as any, 
                new_data: itemAfterUpdate as any,
            });
        }

        if (dependenciesInput !== undefined) {
            // Compare uniqueRelatedExistingDependencies with uniqueDepsAfterUpdate
            const deactivatedDeps = uniqueRelatedExistingDependencies.filter(existingDep =>
                existingDep.is_active &&
                !uniqueDepsAfterUpdate.some(newDep => 
                    newDep.work_item_id === existingDep.work_item_id && 
                    newDep.depends_on_work_item_id === existingDep.depends_on_work_item_id && 
                    newDep.is_active
                )
            );
            
            const activatedDeps = uniqueDepsAfterUpdate.filter(newDep =>
                newDep.is_active &&
                !uniqueRelatedExistingDependencies.some(existingDep => 
                    existingDep.work_item_id === newDep.work_item_id && 
                    existingDep.depends_on_work_item_id === newDep.depends_on_work_item_id && 
                    existingDep.is_active
                )
            );

            deactivatedDeps.forEach(dep => {
                const recordId = `${dep.work_item_id}:${dep.depends_on_work_item_id}`;
                undoStepsData.push({
                    step_order: stepOrder++, 
                    step_type: 'UPDATE', 
                    table_name: 'work_item_dependencies', 
                    record_id: recordId, 
                    old_data: { ...dep, is_active: true } as any, 
                    new_data: { ...dep, is_active: false } as any,
                });
            });
            
            activatedDeps.forEach(dep => {
                const recordId = `${dep.work_item_id}:${dep.depends_on_work_item_id}`;
                const oldState = uniqueRelatedExistingDependencies.find(oldDep => 
                    oldDep.work_item_id === dep.work_item_id && 
                    oldDep.depends_on_work_item_id === dep.depends_on_work_item_id
                ) ?? { ...dep, is_active: false };
                
                undoStepsData.push({
                    step_order: stepOrder++, 
                    step_type: 'UPDATE', 
                    table_name: 'work_item_dependencies', 
                    record_id: recordId, 
                    old_data: oldState as any, 
                    new_data: dep as any,
                });
            });
        }

        if(undoStepsData.length > 0) { // Only create action if something actually changed
            const createdAction = await this.actionHistoryRepository.createActionInClient(actionData, client);
            for (const step of undoStepsData) {
                await this.actionHistoryRepository.createUndoStepInClient(
                    {...step, action_id: createdAction.action_id }, 
                    client
                );
            }

            const recentUndoActions = await this.actionHistoryRepository.findRecentUndoActionsInClient(client);
            for (const undoAction of recentUndoActions) {
                await this.actionHistoryRepository.markUndoActionAsRedone(
                    undoAction.action_id, 
                    createdAction.action_id, 
                    client
                );
            }
        } else {
            logger.info(`[WorkItemUpdateService] Update called for ${id}, but no changes detected. Skipping history.`);
        }

        logger.info(`[WorkItemUpdateService] Updated work item ${id} and recorded history (if changed).`);
        return itemAfterUpdate;
    });

    // FIXED: Get updated item without isActive filter
    const fullUpdatedItem = await this.readingService.getWorkItemById(updatedItem.work_item_id, undefined);
    if (!fullUpdatedItem) {
        throw new Error(`Failed to retrieve full details for updated item ${updatedItem.work_item_id}.`);
    }
    return fullUpdatedItem;
  }
}
