// src/services/WorkItemAddingService.ts
import { v4 as uuidv4 } from 'uuid';
import {
  WorkItemRepository,
  ActionHistoryRepository,
  WorkItemData,
  WorkItemDependencyData,
  CreateActionHistoryInput,
  CreateUndoStepInput,
} from '../repositories/index.js';
import { logger } from '../utils/logger.js';
import { ValidationError, NotFoundError } from '../utils/errors.js';
import { AddTaskArgs } from '../tools/add_task_params.js'; // Corrected import path name
import { WorkItemUtilsService } from './WorkItemUtilsService.js';
import { WorkItemHistoryService } from './WorkItemHistoryService.js';
import { PoolClient } from 'pg';

/**
 * Service responsible for adding work items
 */
export class WorkItemAddingService {
  private workItemRepository: WorkItemRepository;
  private actionHistoryRepository: ActionHistoryRepository;
  private utilsService: WorkItemUtilsService;
  private historyService: WorkItemHistoryService;

  constructor(workItemRepository: WorkItemRepository, actionHistoryRepository: ActionHistoryRepository) {
    this.workItemRepository = workItemRepository;
    this.actionHistoryRepository = actionHistoryRepository;
    this.utilsService = new WorkItemUtilsService(workItemRepository);
    this.historyService = new WorkItemHistoryService(workItemRepository, actionHistoryRepository);
  }

  /**
   * Creates a new work item with optional dependencies and positioning.
   * Handles fetching neighbour keys and calculating the final order key.
   * Expects AddTaskArgs which now REQUIRES parent_work_item_id for add_task tool.
   * The create_project tool ensures parent_work_item_id is null before calling this service's underlying logic if shared.
   * For now, assume separate calls or addWorkItem handles both cases via input type.
   * Let's adjust logic assuming addWorkItem is called correctly based on tool.
   */
  public async addWorkItem(input: AddTaskArgs): Promise<WorkItemData> {
    const workItemId = uuidv4();
    const now = new Date().toISOString();
    // parentId is now guaranteed by AddTaskArgs for the add_task tool case
    // If this method were also used by create_project, it would need adjustment or a separate method.
    // Assuming called correctly by the respective tools for now.
    const parentId = input.parent_work_item_id; // No longer needs '?? null'

    const dependenciesToCreate: WorkItemDependencyData[] =
      input.dependencies?.map(
        (dep: { depends_on_work_item_id: string; dependency_type?: 'finish-to-start' | 'linked' }) => ({
          work_item_id: workItemId,
          depends_on_work_item_id: dep.depends_on_work_item_id,
          dependency_type: dep.dependency_type ?? 'finish-to-start',
          is_active: true,
        })
      ) ?? [];

    logger.debug(`[WorkItemAddingService] Starting transaction to add work item ${workItemId}`);

    try {
      const createdItem = await this.actionHistoryRepository.withTransaction(async (client: PoolClient) => {
        // 1. Validate Parent (Always validate now since it's required for add_task)
        // If parentId was null (from create_project), this check is skipped
        if (parentId) {
          const parentExists = await this.workItemRepository.findById(parentId, { isActive: true });
          if (!parentExists) {
            throw new ValidationError(`Parent work item with ID ${parentId} not found or is inactive.`);
          }
        } else {
          // This case should ideally only be hit if called from create_project logic
          logger.debug(`[WorkItemAddingService] No parent ID provided, creating root item.`);
        }

        // 2. Determine Neighbour Keys for Order Key Calculation (Logic remains the same)
        let keyBefore: string | null = null;
        let keyAfter: string | null = null;

        if (input.insertAfter_work_item_id) {
          logger.debug(`[WorkItemAddingService] Finding neighbours to insert AFTER ${input.insertAfter_work_item_id}`);
          const neighbours = await this.workItemRepository.findNeighbourOrderKeys(
            parentId, // Use parentId (which could be null for root)
            input.insertAfter_work_item_id,
            'after',
            client
          );
          keyBefore = neighbours.before;
          keyAfter = neighbours.after;
        } else if (input.insertBefore_work_item_id) {
          logger.debug(
            `[WorkItemAddingService] Finding neighbours to insert BEFORE ${input.insertBefore_work_item_id}`
          );
          const neighbours = await this.workItemRepository.findNeighbourOrderKeys(
            parentId, // Use parentId (which could be null for root)
            input.insertBefore_work_item_id,
            'before',
            client
          );
          keyBefore = neighbours.before;
          keyAfter = neighbours.after;
        } else if (input.insertAt === 'start') {
          logger.debug(`[WorkItemAddingService] Finding edge key to insert at START for parent ${parentId ?? 'root'}`);
          keyAfter = await this.workItemRepository.findSiblingEdgeOrderKey(parentId, 'first', client);
          keyBefore = null;
        } else {
          logger.debug(`[WorkItemAddingService] Finding edge key to insert at END for parent ${parentId ?? 'root'}`);
          keyBefore = await this.workItemRepository.findSiblingEdgeOrderKey(parentId, 'last', client);
          keyAfter = null;
        }

        // 3. Calculate Order Key (Logic remains the same)
        const calculatedOrderKey = this.utilsService.calculateOrderKey(keyBefore, keyAfter);
        if (calculatedOrderKey === null) {
          logger.error(
            `[WorkItemAddingService] Failed to calculate order key. Input: ${JSON.stringify(input)}, ParentId: ${parentId}, Neighbour Keys: Before=${keyBefore}, After=${keyAfter}`
          );
          throw new Error(`Failed to calculate a valid order key for item "${input.name}"`);
        }

        // 4. Calculate Shortname (Logic remains the same)
        const calculatedShortname = await this.utilsService.calculateShortname(input.name, parentId, workItemId);

        // 5. Prepare New Item Data (Logic remains the same)
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

        // 6. Create Item and Dependencies in DB (Logic remains the same)
        const item = await this.workItemRepository.create(client, newItemData, dependenciesToCreate);

        // 7. Record Action History (Logic remains the same)
        const actionDescription = `Added work item "${item.name}"`;
        const actionData: CreateActionHistoryInput = {
          action_type: 'ADD_WORK_ITEM',
          work_item_id: item.work_item_id,
          description: actionDescription,
        };

        const undoStepsData: CreateUndoStepInput[] = [];
        const itemStateAfterUndo: WorkItemData = { ...item, is_active: false };
        undoStepsData.push({
          step_order: 1,
          step_type: 'UPDATE',
          table_name: 'work_items',
          record_id: item.work_item_id,
          old_data: itemStateAfterUndo,
          new_data: item,
        });

        dependenciesToCreate.forEach((dep, index) => {
          const depStateAfterUndo: WorkItemDependencyData = { ...dep, is_active: false };
          undoStepsData.push({
            step_order: 2 + index,
            step_type: 'UPDATE',
            table_name: 'work_item_dependencies',
            record_id: `${dep.work_item_id}:${dep.depends_on_work_item_id}`,
            old_data: depStateAfterUndo,
            new_data: dep,
          });
        });

        const createdAction = await this.actionHistoryRepository.createActionInClient(actionData, client);
        for (const step of undoStepsData) {
          await this.actionHistoryRepository.createUndoStepInClient(
            { ...step, action_id: createdAction.action_id },
            client
          );
        }
        await this.historyService.invalidateRedoStack(client, createdAction.action_id);

        logger.info(
          `[WorkItemAddingService] Added work item ${workItemId} with order_key ${calculatedOrderKey} and recorded history`
        );
        return item;
      });

      return createdItem;
    } catch (error: unknown) {
      if (error instanceof ValidationError || error instanceof NotFoundError) {
        logger.warn(
          `[WorkItemAddingService] Validation/Not Found error adding work item "${input.name}": ${error.message}`
        );
      } else {
        logger.error(`[WorkItemAddingService] Error adding work item "${input.name}":`, error);
      }
      throw error;
    }
  }
}
