// src/services/WorkItemHistoryService.ts
import { PoolClient } from 'pg';
import {
  WorkItemRepository,
} from '../repositories/WorkItemRepository.js';
import {
  ActionHistoryRepository,
  CreateActionHistoryInput,
  ActionHistoryData,
} from '../repositories/ActionHistoryRepository.js';
import { logger } from '../utils/logger.js';
import { NotFoundError } from '../utils/errors.js';

/**
 * Service responsible for managing history, undo, and redo operations
 */
export class WorkItemHistoryService {
  private workItemRepository: WorkItemRepository;
  private actionHistoryRepository: ActionHistoryRepository;

  constructor(
    workItemRepository: WorkItemRepository,
    actionHistoryRepository: ActionHistoryRepository
  ) {
    this.workItemRepository = workItemRepository;
    this.actionHistoryRepository = actionHistoryRepository;
  }

  /**
   * Undoes the last action.
   */
  public async undoLastAction(): Promise<ActionHistoryData | null> {
      logger.info(`[WorkItemHistoryService] Attempting to undo last action.`);
      const originalActionToUndo = await this.actionHistoryRepository.findLastOriginalAction();
      
      if (!originalActionToUndo) { 
          logger.info('[WorkItemHistoryService] No action found to undo.'); 
          return null; 
      }
      
      const undoSteps = await this.actionHistoryRepository.findUndoStepsByActionId(originalActionToUndo.action_id);

      if (undoSteps.length === 0) {
           logger.warn(`[WorkItemHistoryService] Action ${originalActionToUndo.action_id} found to undo, but has no undo steps. Marking as undone.`);
           await this.actionHistoryRepository.withTransaction(async (client) => {
                 const undoActionData: CreateActionHistoryInput = {
                     user_id: null, // Always null now that userId is removed
                     action_type: 'UNDO_ACTION', 
                     work_item_id: originalActionToUndo.work_item_id, 
                     description: `Could not undo action (no steps): "${originalActionToUndo.description}"`,
                 };
                 const createdUndoAction = await this.actionHistoryRepository.createActionInClient(undoActionData, client);
                 await this.actionHistoryRepository.markActionAsUndone(originalActionToUndo.action_id, createdUndoAction.action_id, client);

                 const recentUndoActions = await this.actionHistoryRepository.findRecentUndoActionsInClient(client);
                 for (const undoAction of recentUndoActions) {
                      if (undoAction.action_id !== createdUndoAction.action_id) {
                         await this.actionHistoryRepository.markUndoActionAsRedone(undoAction.action_id, createdUndoAction.action_id, client);
                      }
                 }
           });
           return null;
      }

      const undoneAction = await this.actionHistoryRepository.withTransaction(async (client) => {
          logger.debug(`[WorkItemHistoryService] Executing ${undoSteps.length} undo steps for action ${originalActionToUndo.action_id} in reverse order`);
          const stepsInReverse = [...undoSteps].sort((a, b) => b.step_order - a.step_order);
          
          for (const step of stepsInReverse) {
              logger.debug(`[WorkItemHistoryService] Executing undo step ${step.step_order} (${step.step_type}) on ${step.table_name} record ${step.record_id}`);
              try {
                  if (step.step_type === 'UPDATE') {
                      if (!step.old_data) throw new Error(`Undo step ${step.undo_step_id} (UPDATE) is missing old_data.`);
                      await this.workItemRepository.updateRowState(client, step.table_name, step.old_data);
                  } else if (step.step_type === 'DELETE') {
                      if (!step.new_data) throw new Error(`Undo step ${step.undo_step_id} (DELETE reversal - INSERT) is missing new_data.`);
                      await this.workItemRepository.insertRow(client, step.table_name, step.new_data);
                  } else if (step.step_type === 'INSERT') {
                       if (!step.record_id) throw new Error(`Undo step ${step.undo_step_id} (INSERT reversal - DELETE) is missing record_id.`);
                       await this.workItemRepository.deleteRow(client, step.table_name, step.record_id);
                  } else { 
                      throw new Error(`Unknown undo step type: ${step.step_type}`); 
                  }
              } catch (stepError: unknown) {
                   logger.error(`[WorkItemHistoryService] Error executing undo step ${step.undo_step_id}:`, stepError);
                   if (stepError instanceof NotFoundError) {
                       throw new Error(`Undo failed: Row ${step.record_id} not found in ${step.table_name}.`);
                   }
                   if (stepError instanceof Error && stepError.message.includes('Conflict: Cannot insert row')) {
                       throw new Error(`Undo failed: Cannot insert row for step ${step.undo_step_id} because it already exists.`);
                   }
                   throw stepError;
              }
          }

           const undoActionData: CreateActionHistoryInput = {
               user_id: null, // Always null now that userId is removed
               action_type: 'UNDO_ACTION', 
               work_item_id: originalActionToUndo.work_item_id, 
               description: `Undid action: "${originalActionToUndo.description}"`,
           };
           const createdUndoAction = await this.actionHistoryRepository.createActionInClient(undoActionData, client);
           // Link the original action to this undo action
           await this.actionHistoryRepository.markActionAsUndone(originalActionToUndo.action_id, createdUndoAction.action_id, client);

           const recentUndoActions = await this.actionHistoryRepository.findRecentUndoActionsInClient(client);
           for (const undoAction of recentUndoActions) {
               if (undoAction.action_id !== createdUndoAction.action_id) {
                  await this.actionHistoryRepository.markUndoActionAsRedone(undoAction.action_id, createdUndoAction.action_id, client);
               }
           }
          return originalActionToUndo;
      });
      return undoneAction;
  }

  /**
   * Redoes the last undone action.
   */
  public async redoLastUndo(): Promise<ActionHistoryData | null> {
      logger.info(`[WorkItemHistoryService] Attempting to redo last undo action.`);
      const undoActionToRedo = await this.actionHistoryRepository.findLastUndoAction();
      
      if (!undoActionToRedo) { 
          logger.info('[WorkItemHistoryService] No undo action found to redo.'); 
          return null; 
      }

      // Find the original action that this UNDO_ACTION reversed
      const originalActionId = undoActionToRedo.undone_at_action_id;
      if (!originalActionId) {
          logger.error(`[WorkItemHistoryService] UNDO_ACTION ${undoActionToRedo.action_id} is missing the link to the original action it undid.`);
          return null;
      }
      
      const originalAction = await this.actionHistoryRepository.findActionById(originalActionId);
      if (!originalAction) { 
          logger.error(`[WorkItemHistoryService] UNDO_ACTION ${undoActionToRedo.action_id} refers to missing original action ${originalActionId}.`); 
          return null; 
      }

      const originalUndoSteps = await this.actionHistoryRepository.findUndoStepsByActionId(originalAction.action_id);

      if (originalUndoSteps.length === 0) {
          logger.warn(`[WorkItemHistoryService] Original action ${originalAction.action_id} has no undo steps. Cannot redo.`);
          await this.actionHistoryRepository.withTransaction(async (client) => {
              const redoActionData: CreateActionHistoryInput = {
                 user_id: null, // Always null now that userId is removed
                 action_type: 'REDO_ACTION', 
                 work_item_id: originalAction.work_item_id, 
                 description: `Could not redo action (no steps): "${originalAction.description}"`,
              };
              const createdRedoAction = await this.actionHistoryRepository.createActionInClient(redoActionData, client);
              // Mark the UNDO action as redone by this new REDO action
              await this.actionHistoryRepository.markUndoActionAsRedone(undoActionToRedo.action_id, createdRedoAction.action_id, client);
          });
          return null;
      }

      const redoneAction = await this.actionHistoryRepository.withTransaction(async (client) => {
          logger.debug(`[WorkItemHistoryService] Executing redo logic (${originalUndoSteps.length} steps) for original action ${originalAction.action_id}`);
          const stepsInOrder = [...originalUndoSteps].sort((a, b) => a.step_order - b.step_order);
          
          for (const step of stepsInOrder) {
              logger.debug(`[WorkItemHistoryService] Executing redo logic for step ${step.step_order} (${step.step_type}) on ${step.table_name} record ${step.record_id}`);
              try {
                  if (step.step_type === 'UPDATE') {
                      if (!step.new_data) throw new Error(`Undo step ${step.undo_step_id} (UPDATE) is missing new_data for redo.`);
                      await this.workItemRepository.updateRowState(client, step.table_name, step.new_data);
                  } else if (step.step_type === 'DELETE') { // Original action was ADD
                      if (!step.record_id) throw new Error(`Undo step ${step.undo_step_id} (DELETE reversal) is missing record_id for redo.`);
                      await this.workItemRepository.deleteRow(client, step.table_name, step.record_id);
                  } else if (step.step_type === 'INSERT') { // Original action was DELETE
                      if (!step.old_data) throw new Error(`Undo step ${step.undo_step_id} (INSERT reversal) is missing old_data for redo.`);
                      await this.workItemRepository.insertRow(client, step.table_name, step.old_data);
                  } else { 
                      throw new Error(`Unknown redo step type: ${step.step_type}`); 
                  }
              } catch (stepError: unknown) {
                  logger.error(`[WorkItemHistoryService] Error executing redo step logic ${step.undo_step_id}:`, stepError);
                  if (stepError instanceof Error && stepError.message.includes('Conflict: Cannot insert row')) {
                      throw new Error(`Redo failed: Cannot re-create row for step ${step.step_order} because it already exists.`);
                  }
                  throw stepError;
              }
          }

          const redoActionData: CreateActionHistoryInput = {
              user_id: null, // Always null now that userId is removed
              action_type: 'REDO_ACTION', 
              work_item_id: originalAction.work_item_id, 
              description: `Redid action: "${originalAction.description}"`,
          };
          const createdRedoAction = await this.actionHistoryRepository.createActionInClient(redoActionData, client);
          // Mark the UNDO action as redone by this REDO action
          await this.actionHistoryRepository.markUndoActionAsRedone(undoActionToRedo.action_id, createdRedoAction.action_id, client);
          return originalAction;
      });
      
      return redoneAction;
  }
}