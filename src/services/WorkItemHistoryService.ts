// src/services/WorkItemHistoryService.ts
import { PoolClient } from 'pg';
import {
  WorkItemRepository, // Import main repo class
  ActionHistoryRepository, // Import main repo class
  ActionHistoryData,
  UndoStepData,
  CreateActionHistoryInput,
} from '../repositories/index.js'; // USE BARREL FILE
import { logger } from '../utils/logger.js';

/**
 * Service responsible for managing history, undo, and redo operations
 */
export class WorkItemHistoryService {
  private workItemRepository: WorkItemRepository;
  private actionHistoryRepository: ActionHistoryRepository;

  constructor(workItemRepository: WorkItemRepository, actionHistoryRepository: ActionHistoryRepository) {
    this.workItemRepository = workItemRepository;
    this.actionHistoryRepository = actionHistoryRepository;
  }

  /**
   * Undoes the last action.
   */
  public async undoLastAction(): Promise<ActionHistoryData | null> {
    logger.info('[WorkItemHistoryService] Attempting to undo last action.');
    const originalActionToUndo = await this.actionHistoryRepository.findLastOriginalAction();

    if (!originalActionToUndo) {
      logger.info('[WorkItemHistoryService] No original action found to undo.');
      return null;
    }
    logger.debug(
      `[WorkItemHistoryService] Found original action to undo: ${originalActionToUndo.action_id} (${originalActionToUndo.action_type})`
    );

    const undoSteps = await this.actionHistoryRepository.findUndoStepsByActionId(originalActionToUndo.action_id);

    if (undoSteps.length === 0) {
      logger.warn(
        `[WorkItemHistoryService] Action ${originalActionToUndo.action_id} has no undo steps. Marking as undone.`
      );
      await this.actionHistoryRepository.withTransaction(async (client) => {
        const undoActionData: CreateActionHistoryInput = {
          user_id: null, // User ID removed
          action_type: 'UNDO_ACTION',
          work_item_id: originalActionToUndo.work_item_id,
          description: `Could not undo action (no steps): "${originalActionToUndo.description}"`,
        };
        const createdUndoAction = await this.actionHistoryRepository.createActionInClient(undoActionData, client);
        await this.actionHistoryRepository.markActionAsUndone(
          originalActionToUndo.action_id,
          createdUndoAction.action_id,
          client
        );
      });
      // Return the original action marked as undone
      return { ...originalActionToUndo, is_undone: true };
    }

    // Execute undo steps within a transaction
    let executedSuccessfully = false;
    try {
      await this.actionHistoryRepository.withTransaction(async (client) => {
        logger.debug(
          `[WorkItemHistoryService] Executing ${undoSteps.length} undo steps for action ${originalActionToUndo.action_id} in reverse order`
        );
        const stepsInReverse = [...undoSteps].sort((a, b) => b.step_order - a.step_order);

        for (const step of stepsInReverse) {
          await this.executeUndoStep(client, step, originalActionToUndo.action_id);
        }

        const undoActionData: CreateActionHistoryInput = {
          user_id: null, // User ID removed
          action_type: 'UNDO_ACTION',
          work_item_id: originalActionToUndo.work_item_id,
          description: `Undid action: "${originalActionToUndo.description}"`,
        };
        const createdUndoAction = await this.actionHistoryRepository.createActionInClient(undoActionData, client);

        await this.actionHistoryRepository.markActionAsUndone(
          originalActionToUndo.action_id,
          createdUndoAction.action_id,
          client
        );

        logger.info(`[WorkItemHistoryService] Successfully undid action ${originalActionToUndo.action_id}`);
        executedSuccessfully = true;
      });
    } catch (transactionError) {
      logger.error(
        `[WorkItemHistoryService] Transaction failed during undo for action ${originalActionToUndo.action_id}:`,
        transactionError
      );
      throw transactionError; // Re-throw the original error
    }

    if (executedSuccessfully) {
      const finalState = await this.actionHistoryRepository.findActionById(originalActionToUndo.action_id);
      return finalState ?? null;
    } else {
      return null; // Transaction failed
    }
  }

  /**
   * Redoes the last undone action.
   */
  public async redoLastUndo(): Promise<ActionHistoryData | null> {
    logger.info('[WorkItemHistoryService] Attempting to redo last undo action.');
    const undoActionToRedo = await this.actionHistoryRepository.findLastUndoAction();

    if (!undoActionToRedo) {
      logger.info('[WorkItemHistoryService] No undo action found to redo.');
      return null;
    }
    logger.debug(`[WorkItemHistoryService] Found UNDO action to redo: ${undoActionToRedo.action_id}`);

    const originalActionId = await this.actionHistoryRepository.findOriginalActionIdForUndo(undoActionToRedo.action_id);

    if (!originalActionId) {
      logger.error(
        `[WorkItemHistoryService] Cannot redo UNDO_ACTION ${undoActionToRedo.action_id} because the link is missing or broken.`
      );
      return null;
    }

    logger.debug(
      `[WorkItemHistoryService] Found original action ${originalActionId} linked to UNDO action ${undoActionToRedo.action_id}.`
    );
    const originalAction = await this.actionHistoryRepository.findActionById(originalActionId);

    if (!originalAction) {
      logger.error(
        `[WorkItemHistoryService] UNDO_ACTION ${undoActionToRedo.action_id} refers to missing original action ${originalActionId}. Cannot redo.`
      );
      return null;
    }

    const originalUndoSteps = await this.actionHistoryRepository.findUndoStepsByActionId(originalAction.action_id);

    if (originalUndoSteps.length === 0) {
      logger.warn(
        `[WorkItemHistoryService] Original action ${originalAction.action_id} has no undo steps. Cannot redo reliably. Marking UNDO as redone.`
      );
      await this.actionHistoryRepository.withTransaction(async (client) => {
        const redoActionData: CreateActionHistoryInput = {
          user_id: null, // User ID removed
          action_type: 'REDO_ACTION',
          work_item_id: originalAction.work_item_id,
          description: `Could not redo action (original had no steps): "${originalAction.description}"`,
        };
        const createdRedoAction = await this.actionHistoryRepository.createActionInClient(redoActionData, client);
        await this.actionHistoryRepository.markActionAsNotUndone(originalAction.action_id, client);
        await this.actionHistoryRepository.markUndoActionAsRedone(
          undoActionToRedo.action_id,
          createdRedoAction.action_id,
          client
        );
      });
      const finalState = await this.actionHistoryRepository.findActionById(originalAction.action_id);
      return finalState ?? null;
    }

    let executedSuccessfully = false;
    try {
      await this.actionHistoryRepository.withTransaction(async (client) => {
        logger.debug(
          `[WorkItemHistoryService] Re-executing ${originalUndoSteps.length} original steps (redo) for action ${originalAction.action_id}`
        );
        const stepsInOrder = [...originalUndoSteps].sort((a, b) => a.step_order - b.step_order);

        for (const step of stepsInOrder) {
          await this.executeRedoStep(client, step, originalAction.action_id);
        }

        const redoActionData: CreateActionHistoryInput = {
          user_id: null, // User ID removed
          action_type: 'REDO_ACTION',
          work_item_id: originalAction.work_item_id,
          description: `Redid action: "${originalAction.description}"`,
        };
        const createdRedoAction = await this.actionHistoryRepository.createActionInClient(redoActionData, client);

        await this.actionHistoryRepository.markActionAsNotUndone(originalAction.action_id, client);
        await this.actionHistoryRepository.markUndoActionAsRedone(
          undoActionToRedo.action_id,
          createdRedoAction.action_id,
          client
        );

        logger.info(`[WorkItemHistoryService] Successfully redid action ${originalAction.action_id}`);
        executedSuccessfully = true;
      });
    } catch (transactionError) {
      logger.error(
        `[WorkItemHistoryService] Transaction failed during redo for action ${originalAction.action_id}:`,
        transactionError
      );
      throw transactionError; // Re-throw the original error
    }

    if (executedSuccessfully) {
      const finalStateOriginalAction = await this.actionHistoryRepository.findActionById(originalAction.action_id);
      return finalStateOriginalAction ?? null;
    } else {
      return null; // Transaction failed
    }
  }

  // Helper to execute a single undo step
  private async executeUndoStep(client: PoolClient, step: UndoStepData, originalActionId: string): Promise<void> {
    logger.debug(
      `[WorkItemHistoryService] Executing undo step ${step.step_order} (${step.step_type}) on ${step.table_name} record ${step.record_id} for action ${originalActionId}`
    );
    try {
      if (step.step_type === 'UPDATE') {
        // Undo action by applying the 'old_data' state (state before original action)
        if (step.old_data === null) throw new Error(`Undo step ${step.undo_step_id} (UPDATE) is missing old_data.`);
        await this.workItemRepository.updateRowState(client, step.table_name, step.old_data);
      } else {
        // With the soft-delete-only history model and UPDATE step types,
        // these cases should ideally not be reached for core operations.
        logger.warn(
          `[WorkItemHistoryService] Encountered unexpected undo step type "${step.step_type}" for action ${originalActionId}. ` +
            `This step type should ideally not be generated for core work item/dependency actions under the soft-delete history model.`
        );

        // Keeping the code for DELETE/INSERT step types as a fallback or for
        // potential other (non-core) actions, but logging a warning.
        if (step.step_type === 'DELETE') {
          // This case was previously used for undoing ADD.
          if (!step.record_id) throw new Error(`Undo step ${step.undo_step_id} (DELETE) is missing record_id.`);
          // If hard deletes are strictly disallowed in application logic, the call below should be removed.
          await this.workItemRepository.deleteRow(client, step.table_name, step.record_id);
        } else if (step.step_type === 'INSERT') {
          // This case was previously used for undoing DELETE.
          if (step.old_data === null) throw new Error(`Undo step ${step.undo_step_id} (INSERT) is missing old_data.`);
          // If hard inserts are strictly disallowed in application logic, the call below should be removed.
          await this.workItemRepository.insertRow(client, step.table_name, step.old_data);
        } else {
          throw new Error(`Unknown or unexpected undo step type: ${step.step_type}`);
        }
      }
    } catch (stepError: unknown) {
      logger.error(
        `[WorkItemHistoryService] Error executing undo step ${step.undo_step_id} for action ${originalActionId}:`,
        stepError
      );
      throw stepError; // Propagate error to rollback transaction
    }
  }

  // Helper to execute the logic for redoing a single original step
  private async executeRedoStep(client: PoolClient, step: UndoStepData, originalActionId: string): Promise<void> {
    logger.debug(
      `[WorkItemHistoryService] Re-executing ${step.step_order} (${step.step_type}) on ${step.table_name} record ${step.record_id} from original action ${originalActionId}`
    );
    try {
      if (step.step_type === 'UPDATE') {
        // Redo action by applying the 'new_data' state (state after original action)
        if (step.new_data === null)
          throw new Error(`Redo step ${step.undo_step_id} (UPDATE) is missing new_data for redo.`);
        await this.workItemRepository.updateRowState(client, step.table_name, step.new_data);
      } else {
        // With the soft-delete-only history model and UPDATE step types,
        // these cases should ideally not be reached for core operations.
        logger.warn(
          `[WorkItemHistoryService] Encountered unexpected redo step type "${step.step_type}" for action ${originalActionId}. ` +
            `This step type should ideally not be generated for core work item/dependency actions under the soft-delete history model.`
        );

        // Keeping the code for DELETE/INSERT step types as a fallback, but logging a warning.
        if (step.step_type === 'DELETE') {
          // This case was previously used for redoing ADD.
          if (step.new_data === null)
            throw new Error(`Redo step ${step.undo_step_id} (DELETE reversal - INSERT) is missing new_data.`);
          // If hard inserts are strictly disallowed in application logic, the call below should be removed.
          await this.workItemRepository.insertRow(client, step.table_name, step.new_data);
        } else if (step.step_type === 'INSERT') {
          // This case was previously used for redoing DELETE.
          if (step.new_data === null) {
            throw new Error(
              `Redo step ${step.undo_step_id} (INSERT reversal - expecting new_data for soft delete) is missing new_data.`
            );
          }
          // If hard deletes are strictly disallowed in application logic, the call below should be removed.
          // The logic to apply new_data via updateRowState is now in the 'UPDATE' branch
          // and should be used instead of any delete/insert here.
          logger.warn(
            `[WorkItemHistoryService] executeRedoStep: Encountered INSERT step type. This case should now be handled by the UPDATE logic for soft deletes.`
          );
          // If this branch is ever reached, it indicates a history generation issue.
          // Depending on requirements, could throw error or attempt updateRowState here.
        } else {
          throw new Error(`Unknown or unexpected redo step type: ${step.step_type}`);
        }
      }
    } catch (stepError: unknown) {
      logger.error(
        `[WorkItemHistoryService] Error executing redo logic for undo_step ${step.undo_step_id} (original action ${originalActionId}):`,
        stepError
      );
      throw stepError; // Propagate error to rollback transaction
    }
  }

  /**
   * Marks any remaining active UNDO actions as undone (invalidated) by a new action.
   * IMPORTANT: This should only be called after a *new original action* (ADD, UPDATE, DELETE)
   * is successfully committed, not after UNDO or REDO itself.
   */
  public async invalidateRedoStack(client: PoolClient, newActionId: string): Promise<void> {
    // Find UNDO actions that are currently active (is_undone = FALSE)
    const recentUndoActions = await this.actionHistoryRepository.findRecentUndoActionsInClient(client);

    let invalidationCount = 0;
    for (const undoAction of recentUndoActions) {
      if (undoAction.action_id !== newActionId) {
        await this.actionHistoryRepository.markUndoActionAsRedone(undoAction.action_id, newActionId, client);
        invalidationCount++;
      }
    }
    if (invalidationCount > 0) {
      logger.debug(
        `[WorkItemHistoryService] Invalidated ${invalidationCount} potential redo(s) due to new action ${newActionId}.`
      );
    }
  }
}
