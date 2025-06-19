// File: src/services/WorkItemHistoryService.ts
// src/services/WorkItemHistoryService.ts
import { PoolClient } from 'pg';
import {
  WorkItemRepository,
  ActionHistoryRepository,
  ActionHistoryData,
  UndoStepData,
  CreateActionHistoryInput,
  WorkItemData, // Need this for type casting old/new data
  WorkItemDependencyData, // Need this for type casting old/new data
} from '../repositories/index.js';
import { logger } from '../utils/logger.js';
import { validate as uuidValidate } from 'uuid';

/**
 * Service responsible for managing history, undo, and redo operations
 */
export class WorkItemHistoryService {
  private workItemRepository: WorkItemRepository; // Keep for potential future use if needed
  private actionHistoryRepository: ActionHistoryRepository;

  constructor(workItemRepository: WorkItemRepository, actionHistoryRepository: ActionHistoryRepository) {
    this.workItemRepository = workItemRepository;
    this.actionHistoryRepository = actionHistoryRepository;
  }

  // --- undoLastAction and redoLastUndo remain the same ---
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
      // This case should ideally not happen if step generation is correct, but handle defensively.
      logger.warn(
        `[WorkItemHistoryService] Action ${originalActionToUndo.action_id} has no undo steps despite being an original action. Cannot perform undo. Marking as undone.`
      );
      let markedAction: ActionHistoryData | undefined;
      try {
        await this.actionHistoryRepository.withTransaction(async (client) => {
          const undoActionData: CreateActionHistoryInput = {
            action_type: 'UNDO_ACTION',
            work_item_id: originalActionToUndo.work_item_id,
            description: `Could not undo action (no steps generated): "${originalActionToUndo.description}"`,
          };
          const createdUndoAction = await this.actionHistoryRepository.createActionInClient(undoActionData, client);
          // Still mark original as undone to prevent repeated attempts
          await this.actionHistoryRepository.markActionAsUndone(
            originalActionToUndo.action_id,
            createdUndoAction.action_id,
            client
          );
          markedAction = await this.actionHistoryRepository.findActionById(originalActionToUndo.action_id);
        });
        return markedAction ?? null; // Return the marked action, but functionally nothing changed in data
      } catch (transactionError) {
        logger.error(
          `[WorkItemHistoryService] Transaction failed while marking action ${originalActionToUndo.action_id} as undone (no steps):`,
          transactionError
        );
        throw transactionError;
      }
    }

    let executedSuccessfully = false;
    try {
      await this.actionHistoryRepository.withTransaction(async (client) => {
        logger.debug(
          `[WorkItemHistoryService] Executing ${undoSteps.length} undo steps for action ${originalActionToUndo.action_id} in reverse order`
        );
        // Steps should be executed in reverse order for UNDO
        const stepsInReverse = [...undoSteps].sort((a, b) => b.step_order - a.step_order);

        for (const step of stepsInReverse) {
          await this.executeUndoStep(client, step, originalActionToUndo.action_id);
        }

        // Record the UNDO action itself
        const undoActionData: CreateActionHistoryInput = {
          action_type: 'UNDO_ACTION',
          work_item_id: originalActionToUndo.work_item_id,
          description: `Undid action: "${originalActionToUndo.description}"`,
        };
        const createdUndoAction = await this.actionHistoryRepository.createActionInClient(undoActionData, client);

        // Mark the original action as undone, linking it to this UNDO action
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
      throw transactionError; // Let the caller handle the transaction error
    }

    // Return the original action's final state (now marked as undone) if successful
    if (executedSuccessfully) {
      const finalState = await this.actionHistoryRepository.findActionById(originalActionToUndo.action_id);
      return finalState ?? null;
    } else {
      // Should not be reachable if transaction error is thrown, but included for completeness
      return null;
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

    // Find the original action that this UNDO action undid
    const originalAction = await this.actionHistoryRepository.findActionLinkedByUndo(undoActionToRedo.action_id);

    if (!originalAction) {
      // This might happen if history is corrupted or the UNDO action was invalidated
      logger.error(
        `[WorkItemHistoryService] Cannot redo UNDO_ACTION ${undoActionToRedo.action_id}. Could not find the original action it undid. Marking UNDO as redone/invalidated.`
      );
      // Mark the UNDO action as 'undone' (invalidated) to prevent further attempts
      await this.actionHistoryRepository.withTransaction(async (client) => {
        await this.actionHistoryRepository.markUndoActionAsRedone(undoActionToRedo.action_id, null, client);
      });
      return null;
    }
    logger.debug(
      `[WorkItemHistoryService] Found original action ${originalAction.action_id} linked to UNDO action ${undoActionToRedo.action_id}.`
    );

    // Get the undo steps associated with the *original* action
    const originalUndoSteps = await this.actionHistoryRepository.findUndoStepsByActionId(originalAction.action_id);

    if (originalUndoSteps.length === 0) {
      // If the original action had no steps, we can't reliably redo it.
      logger.warn(
        `[WorkItemHistoryService] Original action ${originalAction.action_id} has no undo steps. Cannot redo reliably. Marking UNDO as redone.`
      );
      let finalState: ActionHistoryData | undefined;
      try {
        await this.actionHistoryRepository.withTransaction(async (client) => {
          // Create a REDO action record indicating the issue
          const redoActionData: CreateActionHistoryInput = {
            action_type: 'REDO_ACTION',
            work_item_id: originalAction.work_item_id,
            description: `Could not redo action (original had no steps): "${originalAction.description}"`,
          };
          const createdRedoAction = await this.actionHistoryRepository.createActionInClient(redoActionData, client);
          // Mark the original action as *not* undone anymore
          await this.actionHistoryRepository.markActionAsNotUndone(originalAction.action_id, client);
          // Mark the UNDO action as redone/invalidated, linking it to the REDO action
          await this.actionHistoryRepository.markUndoActionAsRedone(
            undoActionToRedo.action_id,
            createdRedoAction.action_id,
            client
          );
          finalState = await this.actionHistoryRepository.findActionById(originalAction.action_id);
        });
        // Return the original action's state (now marked as not undone)
        return finalState ?? null;
      } catch (transactionError) {
        logger.error(
          `[WorkItemHistoryService] Transaction failed while marking UNDO ${undoActionToRedo.action_id} as redone (original had no steps):`,
          transactionError
        );
        throw transactionError;
      }
    }

    // Proceed with redoing the steps
    let executedSuccessfully = false;
    try {
      await this.actionHistoryRepository.withTransaction(async (client) => {
        logger.debug(
          `[WorkItemHistoryService] Re-executing ${originalUndoSteps.length} original steps (redo) for action ${originalAction.action_id}`
        );
        // Steps should be executed in their original order for REDO
        const stepsInOrder = [...originalUndoSteps].sort((a, b) => a.step_order - b.step_order);

        for (const step of stepsInOrder) {
          await this.executeRedoStep(client, step, originalAction.action_id);
        }

        // Record the REDO action
        const redoActionData: CreateActionHistoryInput = {
          action_type: 'REDO_ACTION',
          work_item_id: originalAction.work_item_id,
          description: `Redid action: "${originalAction.description}"`,
        };
        const createdRedoAction = await this.actionHistoryRepository.createActionInClient(redoActionData, client);

        // Mark the original action as NOT undone anymore
        await this.actionHistoryRepository.markActionAsNotUndone(originalAction.action_id, client);
        // Mark the UNDO action as redone, linking it to this REDO action
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
      throw transactionError;
    }

    // Return the original action's final state (now marked as not undone) if successful
    if (executedSuccessfully) {
      const finalStateOriginalAction = await this.actionHistoryRepository.findActionById(originalAction.action_id);
      return finalStateOriginalAction ?? null;
    } else {
      return null;
    }
  }

  /**
   * Builds the SQL SET clauses and parameters for an UPDATE statement based on the provided data object.
   * @param dataObject The object containing the data to apply (either old_data for undo or new_data for redo).
   * @param tableName The name of the table being updated.
   * @returns An object containing the SET clause strings and the corresponding parameter array.
   */
  private buildUpdateQueryParts(
    dataObject: Partial<WorkItemData> | Partial<WorkItemDependencyData> | null,
    tableName: string
  ): { setClauses: string[]; params: unknown[] } {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1; // Start parameter index at 1

    if (!dataObject) {
      logger.warn(`[WorkItemHistoryService] buildUpdateQueryParts called with null dataObject for table ${tableName}`);
      return { setClauses: [], params: [] };
    }

    // Add updated_at for work_items table if it's not explicitly in the dataObject
    // This ensures updated_at is always set on undo/redo for work_items
    if (tableName === 'work_items' && !Object.prototype.hasOwnProperty.call(dataObject, 'updated_at')) {
      // Using CURRENT_TIMESTAMP ensures atomicity within the transaction
      setClauses.push(`"updated_at" = CURRENT_TIMESTAMP`);
    }

    for (const key in dataObject) {
      if (Object.prototype.hasOwnProperty.call(dataObject, key)) {
        // Skip primary key columns, they define the WHERE clause, not SET clause
        if (
          (tableName === 'work_items' && key === 'work_item_id') ||
          (tableName === 'work_item_dependencies' && (key === 'work_item_id' || key === 'depends_on_work_item_id'))
        ) {
          continue;
        }
        // Skip created_at for work_items as it should not change
        if (tableName === 'work_items' && key === 'created_at') {
          continue;
        }
        // Skip updated_at if we already added CURRENT_TIMESTAMP
        if (
          tableName === 'work_items' &&
          key === 'updated_at' &&
          setClauses.includes(`"updated_at" = CURRENT_TIMESTAMP`)
        ) {
          continue;
        }

        // ADDITION: Skip 'depends_on_status' when updating 'work_item_dependencies' table
        if (tableName === 'work_item_dependencies' && key === 'depends_on_status') {
          continue;
        }

        // Use type assertion to access properties safely
        const value = (dataObject as Record<string, unknown>)[key];
        setClauses.push(`"${key}" = $${paramIndex++}`);
        // Handle potential undefined values, converting them to null for DB
        params.push(value === undefined ? null : value);
      }
    }

    return { setClauses, params };
  }

  /**
   * Executes a single undo step, applying the 'old_data' state.
   */
  private async executeUndoStep(client: PoolClient, step: UndoStepData, originalActionId: string): Promise<void> {
    logger.debug(
      `[WorkItemHistoryService] Executing undo step ${step.step_order} (${step.step_type}) on ${step.table_name} record ${step.record_id} for action ${originalActionId}`
    );
    try {
      // For UNDO, we apply the state defined in `old_data`
      if (step.step_type !== 'UPDATE' || !step.old_data) {
        throw new Error(
          `Unsupported undo step type or missing old_data for step ${step.undo_step_id} in action ${originalActionId}`
        );
      }

      // Build the update query based on the old_data
      const { setClauses, params: updateParams } = this.buildUpdateQueryParts(step.old_data, step.table_name);

      if (setClauses.length === 0) {
        logger.warn(`[WorkItemHistoryService] Undo step ${step.undo_step_id} had no fields to apply in old_data.`);
        return; // Nothing to do for this step
      }

      let sql = `UPDATE "${step.table_name}" SET ${setClauses.join(', ')} WHERE `;
      const whereParams: unknown[] = [];
      let pkParamStartIndex = updateParams.length + 1;

      // Construct WHERE clause based on table PK
      if (step.table_name === 'work_items' && uuidValidate(step.record_id)) {
        sql += `"work_item_id" = $${pkParamStartIndex++}`;
        whereParams.push(step.record_id);
      } else if (
        step.table_name === 'work_item_dependencies' &&
        typeof step.record_id === 'string' &&
        step.record_id.includes(':')
      ) {
        const [workItemId, dependsOnId] = step.record_id.split(':');
        if (uuidValidate(workItemId) && uuidValidate(dependsOnId)) {
          sql += `"work_item_id" = $${pkParamStartIndex++} AND "depends_on_work_item_id" = $${pkParamStartIndex++}`;
          whereParams.push(workItemId, dependsOnId);
        } else {
          throw new Error(`Invalid composite key in undo step record_id: ${step.record_id}`);
        }
      } else {
        throw new Error(`Unsupported table or invalid record_id for undo step: ${step.table_name} / ${step.record_id}`);
      }

      // Combine parameters
      const allParams = [...updateParams, ...whereParams];

      logger.debug(`[WorkItemHistoryService DEBUG] Undo SQL: ${sql} Params: ${JSON.stringify(allParams)}`);
      const result = await client.query(sql, allParams);
      logger.debug(
        `[WorkItemHistoryService DEBUG] Undo step execution result rowCount: ${result.rowCount} for ${step.table_name} ${step.record_id}`
      );
      // Warn if no rows were updated (record might have been deleted/changed outside history)
      if (result.rowCount === 0) {
        logger.warn(`[WorkItemHistoryService] Undo step for ${step.table_name} ${step.record_id} affected 0 rows.`);
      }
    } catch (stepError: unknown) {
      logger.error(
        `[WorkItemHistoryService] Error executing undo step ${step.undo_step_id} for action ${originalActionId}:`,
        stepError
      );
      throw stepError; // Propagate error to rollback transaction
    }
  }

  /**
   * Executes a single redo step, applying the 'new_data' state.
   */
  private async executeRedoStep(client: PoolClient, step: UndoStepData, originalActionId: string): Promise<void> {
    logger.debug(
      `[WorkItemHistoryService] Re-executing redo step ${step.step_order} (${step.step_type}) on ${step.table_name} record ${step.record_id} from original action ${originalActionId}`
    );
    try {
      // For REDO, we apply the state defined in `new_data`
      if (step.step_type !== 'UPDATE' || !step.new_data) {
        throw new Error(
          `Unsupported redo step type or missing new_data for step ${step.undo_step_id} in action ${originalActionId}`
        );
      }

      // Build the update query based on the new_data
      const { setClauses, params: updateParams } = this.buildUpdateQueryParts(step.new_data, step.table_name);

      if (setClauses.length === 0) {
        logger.warn(`[WorkItemHistoryService] Redo step ${step.undo_step_id} had no fields to apply in new_data.`);
        return; // Nothing to do for this step
      }

      let sql = `UPDATE "${step.table_name}" SET ${setClauses.join(', ')} WHERE `;
      const whereParams: unknown[] = [];
      let pkParamStartIndex = updateParams.length + 1;

      // Construct WHERE clause based on table PK
      if (step.table_name === 'work_items' && uuidValidate(step.record_id)) {
        sql += `"work_item_id" = $${pkParamStartIndex++}`;
        whereParams.push(step.record_id);
      } else if (
        step.table_name === 'work_item_dependencies' &&
        typeof step.record_id === 'string' &&
        step.record_id.includes(':')
      ) {
        const [workItemId, dependsOnId] = step.record_id.split(':');
        if (uuidValidate(workItemId) && uuidValidate(dependsOnId)) {
          sql += `"work_item_id" = $${pkParamStartIndex++} AND "depends_on_work_item_id" = $${pkParamStartIndex++}`;
          whereParams.push(workItemId, dependsOnId);
        } else {
          throw new Error(`Invalid composite key in redo step record_id: ${step.record_id}`);
        }
      } else {
        throw new Error(`Unsupported table or invalid record_id for redo step: ${step.table_name} / ${step.record_id}`);
      }

      // Combine parameters
      const allParams = [...updateParams, ...whereParams];

      logger.debug(`[WorkItemHistoryService DEBUG] Redo SQL: ${sql} Params: ${JSON.stringify(allParams)}`);
      const result = await client.query(sql, allParams);
      logger.debug(
        `[WorkItemHistoryService DEBUG] Redo step execution result rowCount: ${result.rowCount} for ${step.table_name} ${step.record_id}`
      );
      // Warn if no rows were updated
      if (result.rowCount === 0) {
        logger.warn(`[WorkItemHistoryService] Redo step for ${step.table_name} ${step.record_id} affected 0 rows.`);
      }
    } catch (stepError: unknown) {
      logger.error(
        `[WorkItemHistoryService] Error executing redo logic for undo_step ${step.undo_step_id} (original action ${originalActionId}):`,
        stepError
      );
      throw stepError;
    }
  }

  /**
   * Marks any pending UNDO actions (that haven't been redone/invalidated) as undone
   * by the new action ID, effectively clearing the redo stack.
   */
  public async invalidateRedoStack(client: PoolClient, newActionId: string): Promise<void> {
    // Find UNDO actions that are currently NOT undone (meaning they are available for redo)
    const recentUndoActions = await this.actionHistoryRepository.findRecentUndoActionsInClient(client);
    let invalidationCount = 0;
    for (const undoAction of recentUndoActions) {
      // Check if the action is an UNDO action and is NOT already undone (i.e., it's eligible for redo)
      // Also ensure we don't invalidate the action we just created
      if (undoAction.action_id !== newActionId && !undoAction.is_undone) {
        // Mark this UNDO action as "undone" (invalidated) by the new action
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
