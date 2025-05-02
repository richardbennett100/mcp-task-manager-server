// src/repositories/ActionHistoryRepository.ts
import { Pool, PoolClient } from 'pg';
import {
  ActionHistoryRepositoryBase,
  ActionHistoryData,
  UndoStepData,
  CreateActionHistoryInput,
  CreateUndoStepInput,
} from './ActionHistoryRepositoryBase.js';
import { ActionHistoryRepositoryActions } from './ActionHistoryRepositoryActions.js';
import { ActionHistoryRepositorySteps } from './ActionHistoryRepositorySteps.js';

/**
 * Main repository class for managing action history and undo/redo steps.
 * Composes functionality from specialized helper classes.
 */
export class ActionHistoryRepository extends ActionHistoryRepositoryBase {
  private actions: ActionHistoryRepositoryActions;
  private steps: ActionHistoryRepositorySteps;

  constructor(pool: Pool) {
    super(pool); // Pass pool to base
    this.actions = new ActionHistoryRepositoryActions(pool);
    this.steps = new ActionHistoryRepositorySteps(pool);
  }

  // --- Delegated Methods ---

  // Action Operations
  public createActionWithSteps(
    actionData: CreateActionHistoryInput,
    undoStepsData: CreateUndoStepInput[]
  ): Promise<ActionHistoryData> {
    // Note: createActionWithSteps is slightly different as it orchestrates both helpers
    return this.withTransaction(async (client) => {
      const createdAction = await this.actions.createActionInClient(actionData, client);
      if (undoStepsData.length > 0) {
        for (const step of undoStepsData) {
          await this.steps.createUndoStepInClient({ ...step, action_id: createdAction.action_id }, client);
        }
      }
      return createdAction; // Return the action data
    });
  }

  public createActionInClient(actionData: CreateActionHistoryInput, client: PoolClient): Promise<ActionHistoryData> {
    return this.actions.createActionInClient(actionData, client);
  }

  public findActionById(actionId: string): Promise<ActionHistoryData | undefined> {
    return this.actions.findActionById(actionId);
  }

  public findLastOriginalAction(): Promise<ActionHistoryData | undefined> {
    return this.actions.findLastOriginalAction();
  }

  public findLastUndoAction(): Promise<ActionHistoryData | undefined> {
    return this.actions.findLastUndoAction();
  }

  public findRecentUndoActionsInClient(client: PoolClient, limit?: number): Promise<ActionHistoryData[]> {
    return this.actions.findRecentUndoActionsInClient(client, limit);
  }

  public markActionAsUndone(actionId: string, undoActionId: string, client: PoolClient): Promise<void> {
    return this.actions.markActionAsUndone(actionId, undoActionId, client);
  }

  public markUndoActionAsRedone(
    undoActionId: string,
    redoOrInvalidatingActionId: string | null,
    client: PoolClient
  ): Promise<void> {
    return this.actions.markUndoActionAsRedone(undoActionId, redoOrInvalidatingActionId, client);
  }

  public markActionAsNotUndone(actionId: string, client: PoolClient): Promise<void> {
    return this.actions.markActionAsNotUndone(actionId, client);
  }

  public findOriginalActionIdForUndo(undoActionId: string): Promise<string | undefined> {
    return this.actions.findOriginalActionIdForUndo(undoActionId);
  }

  public listRecentActions(filter?: { work_item_id?: string | null; limit?: number }): Promise<ActionHistoryData[]> {
    return this.actions.listRecentActions(filter);
  }

  // Step Operations
  public createUndoStepInClient(
    stepData: CreateUndoStepInput & { action_id: string },
    client: PoolClient
  ): Promise<void> {
    return this.steps.createUndoStepInClient(stepData, client);
  }

  public findUndoStepsByActionId(actionId: string): Promise<UndoStepData[]> {
    return this.steps.findUndoStepsByActionId(actionId);
  }

  // withTransaction remains available via inheritance from ActionHistoryRepositoryBase
}
