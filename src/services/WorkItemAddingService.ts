// src/services/WorkItemAddingService.ts
import { v4 as uuidv4 } from 'uuid';
import {
  WorkItemRepository,
  ActionHistoryRepository,
  WorkItemData, // Import WorkItemData
  WorkItemDependencyData, // Import WorkItemDependencyData
  CreateActionHistoryInput,
  CreateUndoStepInput,
} from '../repositories/index.js'; // USE BARREL FILE
import { logger } from '../utils/logger.js';
import { ValidationError } from '../utils/errors.js';
import { AddWorkItemInput } from './WorkItemServiceTypes.js'; // Assuming this path is correct
import { WorkItemUtilsService } from './WorkItemUtilsService.js';
import { WorkItemHistoryService } from './WorkItemHistoryService.js'; // Import HistoryService

/**
 * Service responsible for adding work items
 */
export class WorkItemAddingService {
  private workItemRepository: WorkItemRepository;
  private actionHistoryRepository: ActionHistoryRepository;
  private utilsService: WorkItemUtilsService;
  private historyService: WorkItemHistoryService; // Add history service instance

  constructor(workItemRepository: WorkItemRepository, actionHistoryRepository: ActionHistoryRepository) {
    this.workItemRepository = workItemRepository;
    this.actionHistoryRepository = actionHistoryRepository;
    this.utilsService = new WorkItemUtilsService(
      workItemRepository // Pass repository instance here
    ); // Need repository for calculateShortname/OrderKey
    this.historyService = new WorkItemHistoryService(workItemRepository, actionHistoryRepository);
  }

  /**
   * Creates a new work item with optional dependencies
   */
  public async addWorkItem(input: AddWorkItemInput): Promise<WorkItemData> {
    const workItemId = uuidv4();
    const now = new Date().toISOString();
    const parentId = input.parent_work_item_id ?? null;

    const dependenciesToCreate: WorkItemDependencyData[] =
      input.dependencies?.map((dep) => ({
        work_item_id: workItemId,
        depends_on_work_item_id: dep.depends_on_work_item_id,
        dependency_type: dep.dependency_type ?? 'finish-to-start',
        is_active: true, // New dependencies are active
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

        const calculatedShortname =
          input.shortname ?? (await this.utilsService.calculateShortname(input.name, parentId, undefined, client));
        const calculatedOrderKey = input.order_key ?? (await this.utilsService.calculateOrderKey(parentId, null));
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
          is_active: true, // New items are active by default
        };

        // Create item and dependencies
        const item = await this.workItemRepository.create(client, newItemData, dependenciesToCreate);

        // Record action history
        const actionDescription = `Added work item "${item.name}"`;
        const actionData: CreateActionHistoryInput = {
          user_id: null, // userId removed
          action_type: 'ADD_WORK_ITEM',
          work_item_id: item.work_item_id,
          description: actionDescription,
        };

        const undoStepsData: CreateUndoStepInput[] = [];
        // Undo step for the item itself: UPDATE to set is_active to false
        // old_data: State AFTER undo (item is inactive)
        // new_data: State BEFORE undo (item is active)
        const itemStateAfterUndo: WorkItemData = { ...item, is_active: false };
        undoStepsData.push({
          step_order: 1,
          step_type: 'UPDATE',
          table_name: 'work_items',
          record_id: item.work_item_id,
          old_data: itemStateAfterUndo as WorkItemData, // Using WorkItemData type assertion
          new_data: item as WorkItemData, // Using WorkItemData type assertion
        });

        // Undo steps for dependencies: UPDATEs to set is_active to false
        // old_data: State AFTER undo (dependency is inactive)
        // new_data: State BEFORE undo (dependency is active)
        dependenciesToCreate.forEach((dep, index) => {
          const depStateAfterUndo: WorkItemDependencyData = { ...dep, is_active: false };
          undoStepsData.push({
            step_order: 2 + index, // Ensure order after item step
            step_type: 'UPDATE',
            table_name: 'work_item_dependencies',
            record_id: `${dep.work_item_id}:${dep.depends_on_work_item_id}`, // Composite key
            old_data: depStateAfterUndo as WorkItemDependencyData, // Using WorkItemDependencyData type assertion
            new_data: dep as WorkItemDependencyData, // Using WorkItemDependencyData type assertion
          });
        });

        // Create action and steps in DB
        const createdAction = await this.actionHistoryRepository.createActionInClient(actionData, client);
        for (const step of undoStepsData) {
          await this.actionHistoryRepository.createUndoStepInClient(
            { ...step, action_id: createdAction.action_id },
            client
          );
        }

        // Invalidate the redo stack
        await this.historyService.invalidateRedoStack(client, createdAction.action_id);

        logger.info(`[WorkItemAddingService] Added work item ${workItemId} and recorded history`);
        return item; // Return the created item
      });

      return createdItem;
    } catch (error: unknown) {
      if (error instanceof ValidationError) {
        logger.warn(`[WorkItemAddingService] Validation error adding work item "${input.name}": ${error.message}`);
      } else {
        logger.error(`[WorkItemAddingService] Error adding work item "${input.name}":`, error);
      }
      throw error; // Re-throw the error
    }
  }
}
