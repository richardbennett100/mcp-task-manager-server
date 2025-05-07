// src/services/WorkItemPromoteService.ts
import { PoolClient } from 'pg';
import {
  WorkItemRepository,
  ActionHistoryRepository,
  type WorkItemData,
  type WorkItemDependencyData,
  type CreateActionHistoryInput,
  type CreateUndoStepInput,
} from '../repositories/index.js';
import { logger } from '../utils/logger.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { type FullWorkItemData } from './WorkItemServiceTypes.js';
import { WorkItemUtilsService } from './WorkItemUtilsService.js';
import { WorkItemReadingService } from './WorkItemReadingService.js';
import { WorkItemHistoryService } from './WorkItemHistoryService.js';
import { WorkItemDependencyUpdateService } from './WorkItemDependencyUpdateService.js'; // For adding dependency

/**
 * Service responsible for promoting a task to a project.
 */
export class WorkItemPromoteService {
  private workItemRepository: WorkItemRepository;
  private actionHistoryRepository: ActionHistoryRepository;
  private utilsService: WorkItemUtilsService;
  private readingService: WorkItemReadingService;
  private historyService: WorkItemHistoryService;
  private dependencyUpdateService: WorkItemDependencyUpdateService;

  constructor(workItemRepository: WorkItemRepository, actionHistoryRepository: ActionHistoryRepository) {
    this.workItemRepository = workItemRepository;
    this.actionHistoryRepository = actionHistoryRepository;
    this.utilsService = new WorkItemUtilsService(workItemRepository);
    this.readingService = new WorkItemReadingService(workItemRepository);
    this.historyService = new WorkItemHistoryService(workItemRepository, actionHistoryRepository);
    // Initialize dependencyUpdateService as it will be used
    this.dependencyUpdateService = new WorkItemDependencyUpdateService(workItemRepository, actionHistoryRepository);
  }

  public async promoteToProject(workItemId: string): Promise<FullWorkItemData> {
    logger.info(`[WorkItemPromoteService] Attempting to promote work item ${workItemId} to a project.`);

    let itemBeforePromotion: WorkItemData | undefined;
    let itemAfterPromotion: WorkItemData | null = null;
    let originalParentId: string | null = null;
    const undoStepsData: CreateUndoStepInput[] = [];
    let stepOrder = 1;

    await this.actionHistoryRepository.withTransaction(async (client: PoolClient) => {
      itemBeforePromotion = await this.workItemRepository.findById(workItemId, {
        isActive: true,
      });
      if (!itemBeforePromotion) {
        const inactiveItem = await this.workItemRepository.findById(workItemId, {
          isActive: false,
        });
        if (inactiveItem) {
          throw new ValidationError(`Work item with ID ${workItemId} is inactive and cannot be promoted.`);
        } else {
          throw new NotFoundError(`Work item with ID ${workItemId} not found.`);
        }
      }

      if (itemBeforePromotion.parent_work_item_id === null) {
        throw new ValidationError(`Work item ${workItemId} is already a top-level project.`);
      }
      originalParentId = itemBeforePromotion.parent_work_item_id;

      // 1. Update parent_work_item_id to null and recalculate order_key
      const newOrderKey = this.utilsService.calculateOrderKey(
        await this.workItemRepository.findSiblingEdgeOrderKey(null, 'last', client), // New parent is root
        null
      );
      if (newOrderKey === null) {
        throw new Error(`Failed to calculate a new order key for promoted project ${workItemId}.`);
      }

      // Recalculate shortname as it's now a root item
      const newShortname = await this.utilsService.calculateShortname(
        itemBeforePromotion.name,
        null, // New parent is null
        workItemId
      );
      if (newShortname === null) {
        throw new Error(
          `Failed to generate a unique shortname for the promoted project: "${itemBeforePromotion.name}"`
        );
      }

      const updatePayload: Partial<WorkItemData> = {
        parent_work_item_id: null,
        order_key: newOrderKey,
        shortname: newShortname,
      };

      itemAfterPromotion = await this.workItemRepository.updateFields(client, workItemId, updatePayload);

      if (!itemAfterPromotion) {
        logger.error(
          `[WorkItemPromoteService] Failed to update work item ${workItemId} during promotion. Before state:`,
          itemBeforePromotion
        );
        throw new NotFoundError(
          `Failed to update work item ${workItemId} during promotion, it might have been modified or deactivated concurrently.`
        );
      }

      // Add undo step for the main item update
      undoStepsData.push({
        step_order: stepOrder++,
        step_type: 'UPDATE',
        table_name: 'work_items',
        record_id: workItemId,
        old_data: {
          parent_work_item_id: itemBeforePromotion.parent_work_item_id,
          order_key: itemBeforePromotion.order_key,
          shortname: itemBeforePromotion.shortname,
          updated_at: itemBeforePromotion.updated_at,
        },
        new_data: {
          parent_work_item_id: itemAfterPromotion.parent_work_item_id,
          order_key: itemAfterPromotion.order_key,
          shortname: itemAfterPromotion.shortname,
          updated_at: itemAfterPromotion.updated_at,
        },
      });

      // 2. Add 'linked' dependency from original parent to the new project
      if (originalParentId) {
        const originalParentItem = await this.workItemRepository.findById(originalParentId, { isActive: true });
        if (!originalParentItem) {
          // This is unlikely if the task had this parent, but handle defensively
          logger.warn(
            `[WorkItemPromoteService] Original parent ${originalParentId} not found or inactive while creating link.`
          );
        } else {
          // Temporarily use the dependencyUpdateService's method.
          // This creates its own transaction and history entry which is not ideal within this larger transaction.
          // For a more robust solution, the core logic of addDependencies would be refactored
          // to accept a client and not create its own history entry when called internally.
          // For now, we accept this nested transaction for simplicity.
          // The history entry for this will be separate.
          logger.info(
            `[WorkItemPromoteService] Adding 'linked' dependency from original parent ${originalParentId} to new project ${workItemId}.`
          );

          // We need to capture the state *before* this specific dependency addition for its own undo.
          // The dependencyUpdateService.addDependencies already handles its own history.
          // However, for the *overall* "promote" action's undo, we need to know if this link was newly created.

          const depsBeforeLinkAdd = await this.workItemRepository.findDependencies(
            originalParentId,
            { isActive: false } // Get all, to see if it existed but was inactive
          );
          const linkExistedBefore = depsBeforeLinkAdd.find((d) => d.depends_on_work_item_id === workItemId);

          await this.dependencyUpdateService.addDependencies(originalParentId, [
            {
              depends_on_work_item_id: workItemId,
              dependency_type: 'linked',
            },
          ]);

          // For the "promote" undo: if the link was newly created by this step, its undo is to remove it.
          // If it was reactivated, its undo is to deactivate it.
          // The addDependencies service handles its own granular undo.
          // This specific step focuses on the "promote" action's perspective.
          const newLinkData: WorkItemDependencyData = {
            work_item_id: originalParentId,
            depends_on_work_item_id: workItemId,
            dependency_type: 'linked',
            is_active: true,
          };

          if (linkExistedBefore) {
            // Link was reactivated or type changed
            undoStepsData.push({
              step_order: stepOrder++,
              step_type: 'UPDATE',
              table_name: 'work_item_dependencies',
              record_id: `${originalParentId}:${workItemId}`,
              old_data: linkExistedBefore, // Original state (potentially inactive or different type)
              new_data: newLinkData, // State after addDependencies made it active and 'linked'
            });
          } else {
            // Link was newly created
            undoStepsData.push({
              step_order: stepOrder++,
              step_type: 'UPDATE', // Treat as update for undo (is_active: true -> false)
              table_name: 'work_item_dependencies',
              record_id: `${originalParentId}:${workItemId}`,
              old_data: { ...newLinkData, is_active: false }, // Old state was non-existent, so undo makes it inactive
              new_data: newLinkData, // New state is active
            });
          }
        }
      }

      // 3. Record Action History for the promotion
      const actionDescription = `Promoted task "${itemAfterPromotion.name}" to a project.`;
      const actionData: CreateActionHistoryInput = {
        action_type: 'PROMOTE_TO_PROJECT',
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
      logger.info(`[WorkItemPromoteService] Recorded history for promoting work item ${workItemId}.`);
    });

    const finalItemState = itemAfterPromotion ?? itemBeforePromotion;
    if (!finalItemState) {
      logger.error(
        `[WorkItemPromoteService] CRITICAL: No item state available after promotion logic for ID ${workItemId}.`
      );
      throw new Error(`Failed to determine final item state after promotion for ID ${workItemId}.`);
    }

    const fullPromotedItem = await this.readingService.getWorkItemById(finalItemState.work_item_id, {
      isActive: finalItemState.is_active,
    });
    if (!fullPromotedItem) {
      logger.error(`[WorkItemPromoteService] Failed to retrieve full details for item ${workItemId} after promotion.`);
      throw new Error(`Failed to retrieve full details for item ${workItemId} after promotion.`);
    }
    return fullPromotedItem;
  }
}
