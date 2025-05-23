// File: src/services/WorkItemPositionUpdateService.ts
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
import { WorkItemUtilsService } from './WorkItemUtilsService.js';
import { WorkItemReadingService } from './WorkItemReadingService.js';
import { WorkItemHistoryService } from './WorkItemHistoryService.js';
import { PoolClient } from 'pg';

/**
 * Service responsible for updating work item positions (order).
 */
export class WorkItemPositionUpdateService {
  private workItemRepository: WorkItemRepository;
  private actionHistoryRepository: ActionHistoryRepository;
  // Removed utilsService instance variable
  private readingService: WorkItemReadingService;
  private historyService: WorkItemHistoryService;

  constructor(workItemRepository: WorkItemRepository, actionHistoryRepository: ActionHistoryRepository) {
    this.workItemRepository = workItemRepository;
    this.actionHistoryRepository = actionHistoryRepository;
    // Removed instantiation of WorkItemUtilsService as its methods are static
    this.readingService = new WorkItemReadingService(workItemRepository);
    this.historyService = new WorkItemHistoryService(workItemRepository, actionHistoryRepository);
  }

  public async moveItemToStart(workItemId: string): Promise<FullWorkItemData> {
    logger.info(`[WorkItemPositionUpdateService] Moving work item ${workItemId} to start.`);
    let itemBeforeUpdate: WorkItemData | undefined;
    let itemAfterUpdate: WorkItemData | null = null;
    await this.actionHistoryRepository.withTransaction(async (client: PoolClient) => {
      itemBeforeUpdate = await this.workItemRepository.findById(workItemId, { isActive: true });
      if (!itemBeforeUpdate) {
        const inactiveItem = await this.workItemRepository.findById(workItemId, { isActive: false });
        if (inactiveItem) {
          throw new ValidationError(`Work item with ID ${workItemId} is inactive and cannot be moved.`);
        } else {
          throw new NotFoundError(`Work item with ID ${workItemId} not found.`);
        }
      }
      const parentId = itemBeforeUpdate.parent_work_item_id;
      const keyBefore = null;
      const keyAfter = await this.workItemRepository.findSiblingEdgeOrderKey(parentId, 'first', client);
      if (keyAfter === itemBeforeUpdate.order_key) {
        logger.info(`[WorkItemPositionUpdateService] Item ${workItemId} is already at the start. No update needed.`);
        itemAfterUpdate = itemBeforeUpdate; // Ensure itemAfterUpdate is set
        return;
      }
      // MODIFIED: Call calculateOrderKey statically
      const newOrderKey = WorkItemUtilsService.calculateOrderKey(keyBefore, keyAfter);
      if (newOrderKey === null) {
        throw new Error(`Failed to calculate a new order key for moving item ${workItemId} to start.`);
      }
      if (newOrderKey === itemBeforeUpdate.order_key) {
        logger.info(
          `[WorkItemPositionUpdateService] Calculated new order key for ${workItemId} is same as current. No effective change.`
        );
        itemAfterUpdate = itemBeforeUpdate; // Ensure itemAfterUpdate is set
        return;
      }
      const updatePayload: Partial<WorkItemData> = { order_key: newOrderKey };
      itemAfterUpdate = await this.workItemRepository.updateFields(client, workItemId, updatePayload);
      if (itemAfterUpdate === null) {
        logger.error(
          `[WorkItemPositionUpdateService] Failed to update order_key for ${workItemId}. Before state:`,
          itemBeforeUpdate
        );
        throw new NotFoundError(
          `Failed to update order_key for work item ${workItemId}, it might have been modified or deactivated concurrently.`
        );
      }
      const undoStepsData: CreateUndoStepInput[] = [
        {
          step_order: 1,
          step_type: 'UPDATE',
          table_name: 'work_items',
          record_id: workItemId,
          old_data: { order_key: itemBeforeUpdate.order_key, updated_at: itemBeforeUpdate.updated_at },
          new_data: { order_key: itemAfterUpdate.order_key, updated_at: itemAfterUpdate.updated_at },
        },
      ];
      const actionDescription = `Moved work item "${itemAfterUpdate.name}" to start of list.`;
      const actionData: CreateActionHistoryInput = {
        action_type: 'MOVE_ITEM',
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
      logger.info(`[WorkItemPositionUpdateService] Recorded history for moving work item ${workItemId} to start.`);
    });
    const finalItemState = itemAfterUpdate ?? itemBeforeUpdate;
    if (!finalItemState) {
      logger.error(
        `[WorkItemPositionUpdateService] CRITICAL: No item state available after moveItemToStart logic for ID ${workItemId}.`
      );
      throw new Error(`Failed to determine final item state after moveItemToStart for ID ${workItemId}.`);
    }
    const fullUpdatedItem = await this.readingService.getWorkItemById(finalItemState.work_item_id, {
      isActive: finalItemState.is_active,
    });
    if (!fullUpdatedItem) {
      logger.error(
        `[WorkItemPositionUpdateService] Failed to retrieve full details for item ${workItemId} after moveItemToStart.`
      );
      throw new Error(`Failed to retrieve full details for item ${workItemId} after moveItemToStart.`);
    }
    return fullUpdatedItem;
  }

  public async moveItemToEnd(workItemId: string): Promise<FullWorkItemData> {
    logger.info(`[WorkItemPositionUpdateService] Moving work item ${workItemId} to end.`);
    let itemBeforeUpdate: WorkItemData | undefined;
    let itemAfterUpdate: WorkItemData | null = null;
    await this.actionHistoryRepository.withTransaction(async (client: PoolClient) => {
      itemBeforeUpdate = await this.workItemRepository.findById(workItemId, { isActive: true });
      if (!itemBeforeUpdate) {
        const inactiveItem = await this.workItemRepository.findById(workItemId, { isActive: false });
        if (inactiveItem) {
          throw new ValidationError(`Work item with ID ${workItemId} is inactive and cannot be moved.`);
        } else {
          throw new NotFoundError(`Work item with ID ${workItemId} not found.`);
        }
      }
      const parentId = itemBeforeUpdate.parent_work_item_id;
      const keyBefore = await this.workItemRepository.findSiblingEdgeOrderKey(parentId, 'last', client);
      const keyAfter = null;
      if (keyBefore === itemBeforeUpdate.order_key) {
        logger.info(`[WorkItemPositionUpdateService] Item ${workItemId} is already at the end. No update needed.`);
        itemAfterUpdate = itemBeforeUpdate; // Ensure itemAfterUpdate is set
        return;
      }
      // MODIFIED: Call calculateOrderKey statically
      const newOrderKey = WorkItemUtilsService.calculateOrderKey(keyBefore, keyAfter);
      if (newOrderKey === null) {
        throw new Error(`Failed to calculate a new order key for moving item ${workItemId} to end.`);
      }
      if (newOrderKey === itemBeforeUpdate.order_key) {
        logger.info(
          `[WorkItemPositionUpdateService] Calculated new order key for ${workItemId} is same as current. No effective change.`
        );
        itemAfterUpdate = itemBeforeUpdate; // Ensure itemAfterUpdate is set
        return;
      }
      const updatePayload: Partial<WorkItemData> = { order_key: newOrderKey };
      itemAfterUpdate = await this.workItemRepository.updateFields(client, workItemId, updatePayload);
      if (itemAfterUpdate === null) {
        logger.error(
          `[WorkItemPositionUpdateService] Failed to update order_key for ${workItemId}. Before state:`,
          itemBeforeUpdate
        );
        throw new NotFoundError(
          `Failed to update order_key for work item ${workItemId}, it might have been modified or deactivated concurrently.`
        );
      }
      const undoStepsData: CreateUndoStepInput[] = [
        {
          step_order: 1,
          step_type: 'UPDATE',
          table_name: 'work_items',
          record_id: workItemId,
          old_data: { order_key: itemBeforeUpdate.order_key, updated_at: itemBeforeUpdate.updated_at },
          new_data: { order_key: itemAfterUpdate.order_key, updated_at: itemAfterUpdate.updated_at },
        },
      ];
      const actionDescription = `Moved work item "${itemAfterUpdate.name}" to end of list.`;
      const actionData: CreateActionHistoryInput = {
        action_type: 'MOVE_ITEM',
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
      logger.info(`[WorkItemPositionUpdateService] Recorded history for moving work item ${workItemId} to end.`);
    });
    const finalItemState = itemAfterUpdate ?? itemBeforeUpdate;
    if (!finalItemState) {
      logger.error(
        `[WorkItemPositionUpdateService] CRITICAL: No item state available after moveItemToEnd logic for ID ${workItemId}.`
      );
      throw new Error(`Failed to determine final item state after moveItemToEnd for ID ${workItemId}.`);
    }
    const fullUpdatedItem = await this.readingService.getWorkItemById(finalItemState.work_item_id, {
      isActive: finalItemState.is_active,
    });
    if (!fullUpdatedItem) {
      logger.error(
        `[WorkItemPositionUpdateService] Failed to retrieve full details for item ${workItemId} after moveItemToEnd.`
      );
      throw new Error(`Failed to retrieve full details for item ${workItemId} after moveItemToEnd.`);
    }
    return fullUpdatedItem;
  }

  public async moveItemAfter(workItemIdToMove: string, targetSiblingId: string): Promise<FullWorkItemData> {
    logger.info(`[WorkItemPositionUpdateService] Moving work item ${workItemIdToMove} after ${targetSiblingId}.`);
    let itemToMoveBefore: WorkItemData | undefined;
    let itemToMoveAfter: WorkItemData | null = null;
    if (workItemIdToMove === targetSiblingId) {
      throw new ValidationError('A work item cannot be moved relative to itself.');
    }
    await this.actionHistoryRepository.withTransaction(async (client: PoolClient) => {
      itemToMoveBefore = await this.workItemRepository.findById(workItemIdToMove, { isActive: true });
      if (!itemToMoveBefore) {
        throw new NotFoundError(`Work item to move (ID: ${workItemIdToMove}) not found or is inactive.`);
      }
      const targetSiblingItem = await this.workItemRepository.findById(targetSiblingId, { isActive: true });
      if (!targetSiblingItem) {
        throw new NotFoundError(`Target sibling work item (ID: ${targetSiblingId}) not found or is inactive.`);
      }
      if (itemToMoveBefore.parent_work_item_id !== targetSiblingItem.parent_work_item_id) {
        throw new ValidationError(`Work item ${workItemIdToMove} and target ${targetSiblingId} are not siblings.`);
      }
      const parentId = itemToMoveBefore.parent_work_item_id;
      const currentNeighboursOfItemToMove = await this.workItemRepository.findNeighbourOrderKeys(
        parentId,
        workItemIdToMove,
        'before', // Check item before current itemToMove
        client
      );
      // If the item currently before itemToMove is the targetSibling, it's already in place.
      if (currentNeighboursOfItemToMove.before === targetSiblingItem.order_key) {
        logger.info(
          `[WorkItemPositionUpdateService] Item ${workItemIdToMove} is already after ${targetSiblingId}. No update needed.`
        );
        itemToMoveAfter = itemToMoveBefore; // Ensure itemToMoveAfter is set
        return;
      }

      const keyBefore = targetSiblingItem.order_key; // itemToMove will be after this key
      const neighboursOfTarget = await this.workItemRepository.findNeighbourOrderKeys(
        parentId,
        targetSiblingId,
        'after', // We need the item that is currently after targetSiblingId
        client
      );
      const keyAfter = neighboursOfTarget.after; // itemToMove will be before this key

      // Special case: if itemToMove is currently keyAfter (i.e., it's the item immediately after targetSibling's own "after" item),
      // this means targetSibling is followed by itemToMove, which is followed by keyAfter.
      // Moving itemToMove between targetSibling and keyAfter might be a no-op or require specific handling
      // if keyAfter is itemToMove itself.
      // If itemToMove's current order_key IS keyAfter, it means itemToMove is already the item after targetSiblingItem's original 'after' item.
      // This condition seems complex, let's simplify: we want itemToMove between targetSiblingItem and whatever was after targetSiblingItem.
      let newOrderKey: string | null;
      if (itemToMoveBefore.order_key === keyAfter) {
        // itemToMove is currently the one after target's original "after" item.
        // This means we're moving itemToMove into the slot of keyAfter, relative to keyBefore (targetSiblingItem.order_key).
        // This case can happen if itemToMove is being moved "earlier" to be after targetSiblingId,
        // and keyAfter was the original position of itemToMove.
        // We need to find what's after itemToMove in its original position to correctly place it.
        const originalNeighboursOfItemToMove = await this.workItemRepository.findNeighbourOrderKeys(
          parentId,
          workItemIdToMove,
          'after',
          client
        );
        // MODIFIED: Call calculateOrderKey statically
        newOrderKey = WorkItemUtilsService.calculateOrderKey(keyBefore, originalNeighboursOfItemToMove.after);
      } else {
        // MODIFIED: Call calculateOrderKey statically
        newOrderKey = WorkItemUtilsService.calculateOrderKey(keyBefore, keyAfter);
      }

      if (newOrderKey === null) {
        throw new Error(`Failed to calculate an order key for moving ${workItemIdToMove} after ${targetSiblingId}.`);
      }
      if (newOrderKey === itemToMoveBefore.order_key) {
        logger.info(
          `[WorkItemPositionUpdateService] Calculated new order key for ${workItemIdToMove} is same as current. No effective change.`
        );
        itemToMoveAfter = itemToMoveBefore; // Ensure itemToMoveAfter is set
        return;
      }
      itemToMoveAfter = await this.workItemRepository.updateFields(client, workItemIdToMove, {
        order_key: newOrderKey,
      });

      if (itemToMoveAfter === null) {
        logger.error(
          `[WorkItemPositionUpdateService] Failed to update order_key for ${workItemIdToMove}. Before state:`,
          itemToMoveBefore
        );
        throw new NotFoundError(
          `Failed to update order_key for work item ${workItemIdToMove}, it might have been modified or deactivated concurrently.`
        );
      }
      const undoStepsData: CreateUndoStepInput[] = [
        {
          step_order: 1,
          step_type: 'UPDATE',
          table_name: 'work_items',
          record_id: workItemIdToMove,
          old_data: { order_key: itemToMoveBefore.order_key, updated_at: itemToMoveBefore.updated_at },
          new_data: { order_key: itemToMoveAfter.order_key, updated_at: itemToMoveAfter.updated_at },
        },
      ];
      const actionDescription = `Moved work item "${itemToMoveAfter.name}" after sibling "${targetSiblingItem.name}".`;
      const actionData: CreateActionHistoryInput = {
        action_type: 'MOVE_ITEM',
        work_item_id: workItemIdToMove,
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
        `[WorkItemPositionUpdateService] Recorded history for moving ${workItemIdToMove} after ${targetSiblingId}.`
      );
    });
    const finalItemState = itemToMoveAfter ?? itemToMoveBefore;
    if (!finalItemState) {
      logger.error(
        `[WorkItemPositionUpdateService] CRITICAL: No item state for ${workItemIdToMove} after moveItemAfter.`
      );
      throw new Error(`No final state for ${workItemIdToMove}.`);
    }
    const fullUpdatedItem = await this.readingService.getWorkItemById(finalItemState.work_item_id, {
      isActive: finalItemState.is_active,
    });
    if (!fullUpdatedItem) {
      logger.error(
        `[WorkItemPositionUpdateService] Failed to retrieve full details for item ${workItemIdToMove} after move.`
      );
      throw new Error(`Failed to retrieve full details for item ${workItemIdToMove}.`);
    }
    return fullUpdatedItem;
  }

  public async moveItemBefore(workItemIdToMove: string, targetSiblingId: string): Promise<FullWorkItemData> {
    logger.info(`[WorkItemPositionUpdateService] Moving work item ${workItemIdToMove} before ${targetSiblingId}.`);
    let itemToMoveBefore: WorkItemData | undefined;
    let itemToMoveAfter: WorkItemData | null = null;
    if (workItemIdToMove === targetSiblingId) {
      throw new ValidationError('A work item cannot be moved relative to itself.');
    }
    await this.actionHistoryRepository.withTransaction(async (client: PoolClient) => {
      itemToMoveBefore = await this.workItemRepository.findById(workItemIdToMove, { isActive: true });
      if (!itemToMoveBefore) {
        throw new NotFoundError(`Work item to move (ID: ${workItemIdToMove}) not found or is inactive.`);
      }
      const targetSiblingItem = await this.workItemRepository.findById(targetSiblingId, { isActive: true });
      if (!targetSiblingItem) {
        throw new NotFoundError(`Target sibling work item (ID: ${targetSiblingId}) not found or is inactive.`);
      }
      if (itemToMoveBefore.parent_work_item_id !== targetSiblingItem.parent_work_item_id) {
        throw new ValidationError(`Work item ${workItemIdToMove} and target ${targetSiblingId} are not siblings.`);
      }
      const parentId = itemToMoveBefore.parent_work_item_id;
      const currentNeighboursOfItemToMove = await this.workItemRepository.findNeighbourOrderKeys(
        parentId,
        workItemIdToMove,
        'after', // Check item after current itemToMove
        client
      );
      // If the item currently after itemToMove is the targetSibling, it's already in place.
      if (currentNeighboursOfItemToMove.after === targetSiblingItem.order_key) {
        logger.info(
          `[WorkItemPositionUpdateService] Item ${workItemIdToMove} is already before ${targetSiblingId}. No update needed.`
        );
        itemToMoveAfter = itemToMoveBefore; // Ensure itemToMoveAfter is set
        return;
      }

      const keyAfter = targetSiblingItem.order_key; // itemToMove will be before this key
      const neighboursOfTarget = await this.workItemRepository.findNeighbourOrderKeys(
        parentId,
        targetSiblingId,
        'before', // We need the item that is currently before targetSiblingId
        client
      );
      const keyBefore = neighboursOfTarget.before; // itemToMove will be after this key

      let newOrderKey: string | null;
      if (itemToMoveBefore.order_key === keyBefore) {
        // itemToMove is currently the one before target's original "before" item.
        const originalNeighboursOfItemToMove = await this.workItemRepository.findNeighbourOrderKeys(
          parentId,
          workItemIdToMove,
          'before',
          client
        );
        // MODIFIED: Call calculateOrderKey statically
        newOrderKey = WorkItemUtilsService.calculateOrderKey(originalNeighboursOfItemToMove.before, keyAfter);
      } else {
        // MODIFIED: Call calculateOrderKey statically
        newOrderKey = WorkItemUtilsService.calculateOrderKey(keyBefore, keyAfter);
      }

      if (newOrderKey === null) {
        throw new Error(`Failed to calculate an order key for moving ${workItemIdToMove} before ${targetSiblingId}.`);
      }
      if (newOrderKey === itemToMoveBefore.order_key) {
        logger.info(
          `[WorkItemPositionUpdateService] Calculated new order key for ${workItemIdToMove} is same as current. No effective change.`
        );
        itemToMoveAfter = itemToMoveBefore; // Ensure itemToMoveAfter is set
        return;
      }
      itemToMoveAfter = await this.workItemRepository.updateFields(client, workItemIdToMove, {
        order_key: newOrderKey,
      });

      if (itemToMoveAfter === null) {
        logger.error(
          `[WorkItemPositionUpdateService] Failed to update order_key for ${workItemIdToMove}. Before state:`,
          itemToMoveBefore
        );
        throw new NotFoundError(
          `Failed to update order_key for work item ${workItemIdToMove}, it might have been modified or deactivated concurrently.`
        );
      }
      const undoStepsData: CreateUndoStepInput[] = [
        {
          step_order: 1,
          step_type: 'UPDATE',
          table_name: 'work_items',
          record_id: workItemIdToMove,
          old_data: { order_key: itemToMoveBefore.order_key, updated_at: itemToMoveBefore.updated_at },
          new_data: { order_key: itemToMoveAfter.order_key, updated_at: itemToMoveAfter.updated_at },
        },
      ];
      const actionDescription = `Moved work item "${itemToMoveAfter.name}" before sibling "${targetSiblingItem.name}".`;
      const actionData: CreateActionHistoryInput = {
        action_type: 'MOVE_ITEM',
        work_item_id: workItemIdToMove,
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
        `[WorkItemPositionUpdateService] Recorded history for moving ${workItemIdToMove} before ${targetSiblingId}.`
      );
    });
    const finalItemState = itemToMoveAfter ?? itemToMoveBefore;
    if (!finalItemState) {
      logger.error(
        `[WorkItemPositionUpdateService] CRITICAL: No item state for ${workItemIdToMove} after moveItemBefore.`
      );
      throw new Error(`No final state for ${workItemIdToMove}.`);
    }
    const fullUpdatedItem = await this.readingService.getWorkItemById(finalItemState.work_item_id, {
      isActive: finalItemState.is_active,
    });
    if (!fullUpdatedItem) {
      logger.error(
        `[WorkItemPositionUpdateService] Failed to retrieve full details for item ${workItemIdToMove} after move.`
      );
      throw new Error(`Failed to retrieve full details for item ${workItemIdToMove}.`);
    }
    return fullUpdatedItem;
  }
}
