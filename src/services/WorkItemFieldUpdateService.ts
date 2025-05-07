// src/services/WorkItemFieldUpdateService.ts
import {
  WorkItemRepository,
  ActionHistoryRepository,
  WorkItemData,
  CreateActionHistoryInput,
  CreateUndoStepInput,
} from '../repositories/index.js';
import { logger } from '../utils/logger.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { FullWorkItemData } from './WorkItemServiceTypes.js';
// WorkItemUtilsService no longer needed here after removing calculateShortname
// import { WorkItemUtilsService } from './WorkItemUtilsService.js';
import { WorkItemReadingService } from './WorkItemReadingService.js';
import { WorkItemHistoryService } from './WorkItemHistoryService.js';
import { PoolClient } from 'pg';
import { WorkItemStatusEnum, WorkItemPriorityEnum } from '../tools/add_task_params.js';
import { z } from 'zod';

type WorkItemStatus = z.infer<typeof WorkItemStatusEnum>;
type WorkItemPriority = z.infer<typeof WorkItemPriorityEnum>;

/**
 * Service responsible for updating individual fields of work items.
 */
export class WorkItemFieldUpdateService {
  private workItemRepository: WorkItemRepository;
  private actionHistoryRepository: ActionHistoryRepository;
  // private utilsService: WorkItemUtilsService; // Removed - no longer needed
  private readingService: WorkItemReadingService;
  private historyService: WorkItemHistoryService;

  constructor(workItemRepository: WorkItemRepository, actionHistoryRepository: ActionHistoryRepository) {
    this.workItemRepository = workItemRepository;
    this.actionHistoryRepository = actionHistoryRepository;
    // this.utilsService = new WorkItemUtilsService(); // Removed instantiation
    this.readingService = new WorkItemReadingService(workItemRepository);
    this.historyService = new WorkItemHistoryService(workItemRepository, actionHistoryRepository);
  }

  public async setStatus(workItemId: string, status: WorkItemStatus): Promise<FullWorkItemData> {
    logger.info(`[WorkItemFieldUpdateService] Setting status to '${status}' for work item ${workItemId}`);
    let itemBeforeUpdate: WorkItemData | undefined;
    let itemAfterUpdate: WorkItemData | null = null;
    await this.actionHistoryRepository.withTransaction(async (client: PoolClient) => {
      itemBeforeUpdate = await this.workItemRepository.findById(workItemId, { isActive: true });
      if (!itemBeforeUpdate) {
        const inactiveItem = await this.workItemRepository.findById(workItemId, { isActive: false });
        if (inactiveItem) {
          throw new ValidationError(`Work item with ID ${workItemId} is inactive.`);
        } else {
          throw new NotFoundError(`Work item with ID ${workItemId} not found.`);
        }
      }
      if (itemBeforeUpdate.status === status) {
        logger.info(`[WorkItemFieldUpdateService] Status for ${workItemId} is already '${status}'. No update needed.`);
        // itemAfterUpdate will remain null, finalItemState logic will use itemBeforeUpdate
        return;
      }
      const updatePayload: Partial<WorkItemData> = { status: status };
      itemAfterUpdate = await this.workItemRepository.updateFields(client, workItemId, updatePayload);
      if (itemAfterUpdate === null) {
        logger.error(
          `[WorkItemFieldUpdateService] Failed to update status for ${workItemId}. Before state:`,
          itemBeforeUpdate
        );
        throw new NotFoundError(
          `Failed to update status for work item ${workItemId}, it might have been modified or deactivated concurrently.`
        );
      }
      const undoStepsData: CreateUndoStepInput[] = [
        {
          step_order: 1,
          step_type: 'UPDATE',
          table_name: 'work_items',
          record_id: workItemId,
          old_data: { status: itemBeforeUpdate.status, updated_at: itemBeforeUpdate.updated_at },
          new_data: { status: itemAfterUpdate.status, updated_at: itemAfterUpdate.updated_at },
        },
      ];
      const actionDescription = `Set status to '${status}' for work item "${itemAfterUpdate.name}"`;
      const actionData: CreateActionHistoryInput = {
        action_type: 'SET_STATUS',
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
      logger.info(`[WorkItemFieldUpdateService] Recorded history for setting status on work item ${workItemId}.`);
    });
    const finalItemState = itemAfterUpdate ?? itemBeforeUpdate;
    if (!finalItemState) {
      logger.error(
        `[WorkItemFieldUpdateService] CRITICAL: No item state available after setStatus logic for ID ${workItemId}.`
      );
      throw new Error(`Failed to determine final item state after setStatus for ID ${workItemId}.`);
    }
    const fullUpdatedItem = await this.readingService.getWorkItemById(finalItemState.work_item_id, {
      isActive: finalItemState.is_active,
    });
    if (!fullUpdatedItem) {
      logger.error(
        `[WorkItemFieldUpdateService] Failed to retrieve full details for item ${workItemId} after setting status.`
      );
      throw new Error(`Failed to retrieve full details for item ${workItemId} after setting status.`);
    }
    return fullUpdatedItem;
  }

  public async setName(workItemId: string, name: string): Promise<FullWorkItemData> {
    logger.info(`[WorkItemFieldUpdateService] Setting name to "${name}" for work item ${workItemId}`);
    let itemBeforeUpdate: WorkItemData | undefined;
    let itemAfterUpdate: WorkItemData | null = null;
    await this.actionHistoryRepository.withTransaction(async (client: PoolClient) => {
      itemBeforeUpdate = await this.workItemRepository.findById(workItemId, { isActive: true });
      if (!itemBeforeUpdate) {
        const inactiveItem = await this.workItemRepository.findById(workItemId, { isActive: false });
        if (inactiveItem) {
          throw new ValidationError(`Work item with ID ${workItemId} is inactive and cannot be renamed.`);
        } else {
          throw new NotFoundError(`Work item with ID ${workItemId} not found.`);
        }
      }
      if (itemBeforeUpdate.name === name) {
        logger.info(`[WorkItemFieldUpdateService] Name for ${workItemId} is already "${name}". No update needed.`);
        return;
      }
      // REMOVED shortname calculation
      // const newShortname = await this.utilsService.calculateShortname(
      //   name,
      //   itemBeforeUpdate.parent_work_item_id,
      //   workItemId
      // );
      // if (newShortname === null) {
      //   throw new Error(`Failed to generate a unique shortname for the new name: "${name}"`);
      // }
      const updatePayload: Partial<WorkItemData> = { name: name }; // REMOVED: shortname: newShortname
      itemAfterUpdate = await this.workItemRepository.updateFields(client, workItemId, updatePayload);
      if (itemAfterUpdate === null) {
        logger.error(
          `[WorkItemFieldUpdateService] Failed to update name for ${workItemId}. Before state:`,
          itemBeforeUpdate
        );
        throw new NotFoundError(
          `Failed to update name for work item ${workItemId}, it might have been modified or deactivated concurrently.`
        );
      }
      const undoStepsData: CreateUndoStepInput[] = [
        {
          step_order: 1,
          step_type: 'UPDATE',
          table_name: 'work_items',
          record_id: workItemId,
          old_data: {
            // Exclude shortname
            name: itemBeforeUpdate.name,
            // shortname: itemBeforeUpdate.shortname,
            updated_at: itemBeforeUpdate.updated_at,
          },
          new_data: {
            // Exclude shortname
            name: itemAfterUpdate.name,
            // shortname: itemAfterUpdate.shortname,
            updated_at: itemAfterUpdate.updated_at,
          },
        },
      ];
      // Adjusted description
      const actionDescription = `Set name to "${itemAfterUpdate.name}" for work item (was: "${itemBeforeUpdate.name}")`;
      const actionData: CreateActionHistoryInput = {
        action_type: 'SET_NAME',
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
      logger.info(`[WorkItemFieldUpdateService] Recorded history for setting name on work item ${workItemId}.`);
    });
    const finalItemState = itemAfterUpdate ?? itemBeforeUpdate;
    if (!finalItemState) {
      logger.error(
        `[WorkItemFieldUpdateService] CRITICAL: No item state available after setName logic for ID ${workItemId}.`
      );
      throw new Error(`Failed to determine final item state after setName for ID ${workItemId}.`);
    }
    const fullUpdatedItem = await this.readingService.getWorkItemById(finalItemState.work_item_id, {
      isActive: finalItemState.is_active,
    });
    if (!fullUpdatedItem) {
      logger.error(
        `[WorkItemFieldUpdateService] Failed to retrieve full details for item ${workItemId} after setting name.`
      );
      throw new Error(`Failed to retrieve full details for item ${workItemId} after setting name.`);
    }
    return fullUpdatedItem;
  }

  public async setDescription(workItemId: string, description: string | null): Promise<FullWorkItemData> {
    logger.info(`[WorkItemFieldUpdateService] Setting description for work item ${workItemId}.`);
    let itemBeforeUpdate: WorkItemData | undefined;
    let itemAfterUpdate: WorkItemData | null = null;
    await this.actionHistoryRepository.withTransaction(async (client: PoolClient) => {
      itemBeforeUpdate = await this.workItemRepository.findById(workItemId, { isActive: true });
      if (!itemBeforeUpdate) {
        const inactiveItem = await this.workItemRepository.findById(workItemId, { isActive: false });
        if (inactiveItem) {
          throw new ValidationError(`Work item with ID ${workItemId} is inactive and cannot be modified.`);
        } else {
          throw new NotFoundError(`Work item with ID ${workItemId} not found.`);
        }
      }
      if (itemBeforeUpdate.description === description) {
        logger.info(`[WorkItemFieldUpdateService] Description for ${workItemId} is already same. No update needed.`);
        return;
      }
      const updatePayload: Partial<WorkItemData> = { description: description };
      itemAfterUpdate = await this.workItemRepository.updateFields(client, workItemId, updatePayload);
      if (itemAfterUpdate === null) {
        logger.error(
          `[WorkItemFieldUpdateService] Failed to update description for ${workItemId}. Before state:`,
          itemBeforeUpdate
        );
        throw new NotFoundError(
          `Failed to update description for work item ${workItemId}, it might have been modified or deactivated concurrently.`
        );
      }
      const undoStepsData: CreateUndoStepInput[] = [
        {
          step_order: 1,
          step_type: 'UPDATE',
          table_name: 'work_items',
          record_id: workItemId,
          old_data: { description: itemBeforeUpdate.description, updated_at: itemBeforeUpdate.updated_at },
          new_data: { description: itemAfterUpdate.description, updated_at: itemAfterUpdate.updated_at },
        },
      ];
      const actionDescription =
        description === null
          ? `Cleared description for work item "${itemAfterUpdate.name}" (was: "${itemBeforeUpdate.description ? itemBeforeUpdate.description.substring(0, 30) + '...' : 'empty'}")`
          : `Set description for work item "${itemAfterUpdate.name}"`;
      const actionData: CreateActionHistoryInput = {
        action_type: 'SET_DESCRIPTION',
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
      logger.info(`[WorkItemFieldUpdateService] Recorded history for setting description on work item ${workItemId}.`);
    });
    const finalItemState = itemAfterUpdate ?? itemBeforeUpdate;
    if (!finalItemState) {
      logger.error(
        `[WorkItemFieldUpdateService] CRITICAL: No item state available after setDescription logic for ID ${workItemId}.`
      );
      throw new Error(`Failed to determine final item state after setDescription for ID ${workItemId}.`);
    }
    const fullUpdatedItem = await this.readingService.getWorkItemById(finalItemState.work_item_id, {
      isActive: finalItemState.is_active,
    });
    if (!fullUpdatedItem) {
      logger.error(
        `[WorkItemFieldUpdateService] Failed to retrieve full details for item ${workItemId} after setting description.`
      );
      throw new Error(`Failed to retrieve full details for item ${workItemId} after setting description.`);
    }
    return fullUpdatedItem;
  }

  public async setPriority(workItemId: string, priority: WorkItemPriority): Promise<FullWorkItemData> {
    logger.info(`[WorkItemFieldUpdateService] Setting priority to '${priority}' for work item ${workItemId}`);
    let itemBeforeUpdate: WorkItemData | undefined;
    let itemAfterUpdate: WorkItemData | null = null;
    await this.actionHistoryRepository.withTransaction(async (client: PoolClient) => {
      itemBeforeUpdate = await this.workItemRepository.findById(workItemId, { isActive: true });
      if (!itemBeforeUpdate) {
        const inactiveItem = await this.workItemRepository.findById(workItemId, { isActive: false });
        if (inactiveItem) {
          throw new ValidationError(`Work item with ID ${workItemId} is inactive and cannot be modified.`);
        } else {
          throw new NotFoundError(`Work item with ID ${workItemId} not found.`);
        }
      }
      if (itemBeforeUpdate.priority === priority) {
        logger.info(
          `[WorkItemFieldUpdateService] Priority for ${workItemId} is already '${priority}'. No update needed.`
        );
        return;
      }
      const updatePayload: Partial<WorkItemData> = { priority: priority };
      itemAfterUpdate = await this.workItemRepository.updateFields(client, workItemId, updatePayload);
      if (itemAfterUpdate === null) {
        logger.error(
          `[WorkItemFieldUpdateService] Failed to update priority for ${workItemId}. Before state:`,
          itemBeforeUpdate
        );
        throw new NotFoundError(
          `Failed to update priority for work item ${workItemId}, it might have been modified or deactivated concurrently.`
        );
      }
      const undoStepsData: CreateUndoStepInput[] = [
        {
          step_order: 1,
          step_type: 'UPDATE',
          table_name: 'work_items',
          record_id: workItemId,
          old_data: { priority: itemBeforeUpdate.priority, updated_at: itemBeforeUpdate.updated_at },
          new_data: { priority: itemAfterUpdate.priority, updated_at: itemAfterUpdate.updated_at },
        },
      ];
      const actionDescription = `Set priority to '${priority}' for work item "${itemAfterUpdate.name}"`;
      const actionData: CreateActionHistoryInput = {
        action_type: 'SET_PRIORITY',
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
      logger.info(`[WorkItemFieldUpdateService] Recorded history for setting priority on work item ${workItemId}.`);
    });
    const finalItemState = itemAfterUpdate ?? itemBeforeUpdate;
    if (!finalItemState) {
      logger.error(
        `[WorkItemFieldUpdateService] CRITICAL: No item state available after setPriority logic for ID ${workItemId}.`
      );
      throw new Error(`Failed to determine final item state after setPriority for ID ${workItemId}.`);
    }
    const fullUpdatedItem = await this.readingService.getWorkItemById(finalItemState.work_item_id, {
      isActive: finalItemState.is_active,
    });
    if (!fullUpdatedItem) {
      logger.error(
        `[WorkItemFieldUpdateService] Failed to retrieve full details for item ${workItemId} after setting priority.`
      );
      throw new Error(`Failed to retrieve full details for item ${workItemId} after setting priority.`);
    }
    return fullUpdatedItem;
  }

  /**
   * Sets or clears the due date for a specific work item.
   */
  public async setDueDate(workItemId: string, dueDate: string | null): Promise<FullWorkItemData> {
    logger.info(`[WorkItemFieldUpdateService] Setting due_date for work item ${workItemId}.`);

    let itemBeforeUpdate: WorkItemData | undefined;
    let itemAfterUpdate: WorkItemData | null = null;

    await this.actionHistoryRepository.withTransaction(async (client: PoolClient) => {
      itemBeforeUpdate = await this.workItemRepository.findById(workItemId, { isActive: true });
      if (!itemBeforeUpdate) {
        const inactiveItem = await this.workItemRepository.findById(workItemId, { isActive: false });
        if (inactiveItem) {
          throw new ValidationError(`Work item with ID ${workItemId} is inactive and cannot be modified.`);
        } else {
          throw new NotFoundError(`Work item with ID ${workItemId} not found.`);
        }
      }

      const currentDueDateNormalized = itemBeforeUpdate.due_date
        ? new Date(itemBeforeUpdate.due_date).toISOString()
        : null;
      const newDueDateNormalized = dueDate ? new Date(dueDate).toISOString() : null;

      if (currentDueDateNormalized === newDueDateNormalized) {
        logger.info(
          `[WorkItemFieldUpdateService] Due date for ${workItemId} is already same or equivalent. No update needed.`
        );
        return; // itemAfterUpdate remains null, handled by finalItemState
      }

      const updatePayload: Partial<WorkItemData> = {
        due_date: newDueDateNormalized, // Use the normalized version for DB
      };

      itemAfterUpdate = await this.workItemRepository.updateFields(client, workItemId, updatePayload);
      if (itemAfterUpdate === null) {
        logger.error(
          `[WorkItemFieldUpdateService] Failed to update due_date for ${workItemId}. Before state:`,
          itemBeforeUpdate
        );
        throw new NotFoundError(
          `Failed to update due_date for work item ${workItemId}, it might have been modified or deactivated concurrently.`
        );
      }

      const undoStepsData: CreateUndoStepInput[] = [
        {
          step_order: 1,
          step_type: 'UPDATE',
          table_name: 'work_items',
          record_id: workItemId,
          old_data: { due_date: itemBeforeUpdate.due_date, updated_at: itemBeforeUpdate.updated_at },
          new_data: { due_date: itemAfterUpdate.due_date, updated_at: itemAfterUpdate.updated_at },
        },
      ];

      const actionDescription =
        newDueDateNormalized === null
          ? `Cleared due date for work item "${itemAfterUpdate.name}" (was: ${currentDueDateNormalized ?? 'not set'})`
          : `Set due date to '${newDueDateNormalized}' for work item "${itemAfterUpdate.name}"`;
      const actionData: CreateActionHistoryInput = {
        action_type: 'SET_DUE_DATE',
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
      logger.info(`[WorkItemFieldUpdateService] Recorded history for setting due_date on work item ${workItemId}.`);
    });

    const finalItemState = itemAfterUpdate ?? itemBeforeUpdate;
    if (!finalItemState) {
      logger.error(
        `[WorkItemFieldUpdateService] CRITICAL: No item state available after setDueDate logic for ID ${workItemId}.`
      );
      throw new Error(`Failed to determine final item state after setDueDate for ID ${workItemId}.`);
    }

    const fullUpdatedItem = await this.readingService.getWorkItemById(finalItemState.work_item_id, {
      isActive: finalItemState.is_active,
    });
    if (!fullUpdatedItem) {
      logger.error(
        `[WorkItemFieldUpdateService] Failed to retrieve full details for item ${workItemId} after setting due_date.`
      );
      throw new Error(`Failed to retrieve full details for item ${workItemId} after setting due_date.`);
    }
    return fullUpdatedItem;
  }
}
