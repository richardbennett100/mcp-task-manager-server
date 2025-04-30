// src/services/WorkItemAddingService.ts
import { v4 as uuidv4 } from 'uuid';
import { PoolClient } from 'pg';
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
import { ValidationError } from '../utils/errors.js';
import { AddWorkItemInput } from './WorkItemServiceTypes.js';
import { WorkItemUtilsService } from './WorkItemUtilsService.js';

/**
 * Service responsible for adding work items
 */
export class WorkItemAddingService {
  private workItemRepository: WorkItemRepository;
  private actionHistoryRepository: ActionHistoryRepository;
  private utilsService: WorkItemUtilsService;

  constructor(
    workItemRepository: WorkItemRepository,
    actionHistoryRepository: ActionHistoryRepository
  ) {
    this.workItemRepository = workItemRepository;
    this.actionHistoryRepository = actionHistoryRepository;
    this.utilsService = new WorkItemUtilsService();
  }

  /**
   * Creates a new work item with optional dependencies
   */
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

    logger.debug(`[WorkItemAddingService] Starting transaction to add work item ${workItemId}`);

    try {
        const createdItem = await this.actionHistoryRepository.withTransaction(async (client) => {
            if (parentId) {
                const parentExists = await this.workItemRepository.findById(parentId, { isActive: true }, client);
                if (!parentExists) {
                    throw new ValidationError(`Parent work item with ID ${parentId} not found or is inactive.`);
                }
            }

            const calculatedShortname = input.shortname ?? 
              (await this.utilsService.calculateShortname(input.name, parentId, undefined, client, this.workItemRepository));
            const calculatedOrderKey = input.order_key ?? 
              (await this.utilsService.calculateOrderKey(parentId, null, client, this.workItemRepository));

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
                step_order: 1, 
                step_type: 'DELETE', 
                table_name: 'work_items', 
                record_id: item.work_item_id, 
                old_data: null, 
                new_data: item as any,
            });
            
            dependenciesToCreate.forEach((dep, index) => {
                undoStepsData.push({
                    step_order: 2 + index, 
                    step_type: 'DELETE', 
                    table_name: 'work_item_dependencies', 
                    record_id: `${dep.work_item_id}:${dep.depends_on_work_item_id}`, 
                    old_data: null, 
                    new_data: dep as any,
                });
            });

            const createdAction = await this.actionHistoryRepository.createActionInClient(actionData, client);
            for (const step of undoStepsData) {
                await this.actionHistoryRepository.createUndoStepInClient(
                    { ...step, action_id: createdAction.action_id }, 
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

            logger.info(`[WorkItemAddingService] Added work item ${workItemId} and recorded history`);
            return item;
        });
        
        return createdItem;
    } catch (error: unknown) {
        if (error instanceof ValidationError) {
            logger.warn(`[WorkItemAddingService] Validation error adding work item "${input.name}": ${error.message}`);
        } else {
            logger.error(`[WorkItemAddingService] Error adding work item "${input.name}":`, error);
        }
        throw error;
    }
  }
}
