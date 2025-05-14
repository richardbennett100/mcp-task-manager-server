// File: src/services/WorkItemPromoteService.ts
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
import { WorkItemDependencyUpdateService } from './WorkItemDependencyUpdateService.js';

/**
 * Service responsible for promoting a task to a project.
 */
export class WorkItemPromoteService {
  private workItemRepository: WorkItemRepository;
  private actionHistoryRepository: ActionHistoryRepository;
  // Removed utilsService instance variable
  private readingService: WorkItemReadingService;
  private historyService: WorkItemHistoryService;
  private dependencyUpdateService: WorkItemDependencyUpdateService;

  constructor(workItemRepository: WorkItemRepository, actionHistoryRepository: ActionHistoryRepository) {
    this.workItemRepository = workItemRepository;
    this.actionHistoryRepository = actionHistoryRepository;
    // Removed instantiation of WorkItemUtilsService
    this.readingService = new WorkItemReadingService(workItemRepository);
    this.historyService = new WorkItemHistoryService(workItemRepository, actionHistoryRepository);
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
      // MODIFIED: Call calculateOrderKey statically
      const newOrderKey = WorkItemUtilsService.calculateOrderKey(
        await this.workItemRepository.findSiblingEdgeOrderKey(null, 'last', client),
        null
      );
      if (newOrderKey === null) {
        throw new Error(`Failed to calculate a new order key for promoted project ${workItemId}.`);
      }

      const updatePayload: Partial<WorkItemData> = {
        parent_work_item_id: null,
        order_key: newOrderKey,
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

      undoStepsData.push({
        step_order: stepOrder++,
        step_type: 'UPDATE',
        table_name: 'work_items',
        record_id: workItemId,
        old_data: {
          parent_work_item_id: itemBeforePromotion.parent_work_item_id,
          order_key: itemBeforePromotion.order_key,
          updated_at: itemBeforePromotion.updated_at,
        },
        new_data: {
          parent_work_item_id: itemAfterPromotion.parent_work_item_id,
          order_key: itemAfterPromotion.order_key,
          updated_at: itemAfterPromotion.updated_at,
        },
      });

      if (originalParentId) {
        const originalParentItem = await this.workItemRepository.findById(originalParentId, { isActive: true }, client);
        if (!originalParentItem) {
          logger.warn(
            `[WorkItemPromoteService] Original parent ${originalParentId} not found or inactive while creating link.`
          );
        } else {
          logger.info(
            `[WorkItemPromoteService] Adding 'linked' dependency from original parent ${originalParentId} to new project ${workItemId}.`
          );

          const depsBeforeLinkAdd = await this.workItemRepository.findDependencies(
            originalParentId,
            { isActive: undefined }, // Get all to check existence
            client
          );
          const linkExistedBefore = depsBeforeLinkAdd.find((d) => d.depends_on_work_item_id === workItemId);

          // This call to addDependencies will create its own history entry.
          // For the "PROMOTE_TO_PROJECT" action's undo, we record the before/after state of this specific link.
          await this.dependencyUpdateService.addDependencies(originalParentId, [
            {
              depends_on_work_item_id: workItemId,
              dependency_type: 'linked',
            },
          ]);

          const newLinkData: WorkItemDependencyData = {
            work_item_id: originalParentId,
            depends_on_work_item_id: workItemId,
            dependency_type: 'linked',
            is_active: true,
          };

          if (linkExistedBefore) {
            undoStepsData.push({
              step_order: stepOrder++,
              step_type: 'UPDATE',
              table_name: 'work_item_dependencies',
              record_id: `${originalParentId}:${workItemId}`,
              old_data: linkExistedBefore,
              new_data: newLinkData,
            });
          } else {
            undoStepsData.push({
              step_order: stepOrder++,
              step_type: 'UPDATE',
              table_name: 'work_item_dependencies',
              record_id: `${originalParentId}:${workItemId}`,
              old_data: { ...newLinkData, is_active: false },
              new_data: newLinkData,
            });
          }
        }
      }

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
      isActive: finalItemState.is_active, // Use actual final active state
    });
    if (!fullPromotedItem) {
      logger.error(`[WorkItemPromoteService] Failed to retrieve full details for item ${workItemId} after promotion.`);
      throw new Error(`Failed to retrieve full details for item ${workItemId} after promotion.`);
    }
    return fullPromotedItem;
  }
}
