// src/repositories/ActionHistoryRepositoryActions.ts
import { Pool, PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import {
  ActionHistoryRepositoryBase,
  ActionHistoryData,
  CreateActionHistoryInput,
  CreateUndoStepInput,
} from './ActionHistoryRepositoryBase.js';
import { ActionHistoryRepositorySteps } from './ActionHistoryRepositorySteps.js'; // Need Steps helper

/**
 * Handles operations related to the action_history table.
 */
export class ActionHistoryRepositoryActions extends ActionHistoryRepositoryBase {
  private stepsHelper: ActionHistoryRepositorySteps;

  constructor(pool: Pool) {
    super(pool);
    // Instantiate the steps helper internally or receive it
    this.stepsHelper = new ActionHistoryRepositorySteps(pool);
  }

  /** Creates a new action history record and its associated undo steps atomically. */
  public async createActionWithSteps(
    actionData: CreateActionHistoryInput,
    undoStepsData: CreateUndoStepInput[]
  ): Promise<ActionHistoryData> {
    return this.withTransaction(async (client) => {
      const createdAction = await this.createActionInClient(actionData, client);
      if (undoStepsData.length > 0) {
        for (const step of undoStepsData) {
          // Use the steps helper method
          await this.stepsHelper.createUndoStepInClient({ ...step, action_id: createdAction.action_id }, client);
        }
      }
      logger.info(
        `[ActionHistoryRepositoryActions] Created action ${
          createdAction.action_id
        } with ${undoStepsData.length} steps (Transaction committed).`
      );
      return createdAction;
    });
  }

  /** Creates a new action history record within an existing transaction. */
  public async createActionInClient(
    actionData: CreateActionHistoryInput,
    client: PoolClient
  ): Promise<ActionHistoryData> {
    const now = new Date().toISOString();
    const actionId = uuidv4();
    const insertActionSql = ` INSERT INTO action_history (action_id, user_id, timestamp, action_type, work_item_id, description, is_undone, undone_at_action_id) VALUES ($1, $2, $3, $4, $5, $6, FALSE, NULL) RETURNING *; `;
    const actionParams = [
      actionId,
      actionData.user_id ?? null,
      now,
      actionData.action_type,
      actionData.work_item_id ?? null,
      actionData.description ?? null,
    ];
    try {
      const result = await client.query(insertActionSql, actionParams);
      if (result.rowCount !== 1) throw new Error(`Failed to insert action history record ${actionId}.`);
      logger.debug(`[ActionHistoryRepositoryActions] Created action ${actionId} in transaction.`);
      return this.mapRowToActionHistoryData(result.rows[0]);
    } catch (error: unknown) {
      logger.error({ err: error }, `[ActionHistoryRepositoryActions] Error creating action ${actionId} in transaction`);
      throw error;
    }
  }

  /** Finds an action history record by its ID. */
  public async findActionById(actionId: string): Promise<ActionHistoryData | undefined> {
    const sql = ` SELECT * FROM action_history WHERE action_id = $1; `;
    try {
      const result = await this.pool.query(sql, [actionId]);
      if (result.rows.length === 0) {
        logger.debug(`[ActionHistoryRepositoryActions] Action history record ${actionId} not found.`);
        return undefined;
      }
      return this.mapRowToActionHistoryData(result.rows[0]);
    } catch (error: unknown) {
      logger.error(`[ActionHistoryRepositoryActions] Failed to find action history record ${actionId}:`, error);
      throw error;
    }
  }

  /** Finds the most recent action that represents an original data modification and has not been undone. */
  public async findLastOriginalAction(): Promise<ActionHistoryData | undefined> {
    const sql = ` SELECT * FROM action_history WHERE is_undone = FALSE AND action_type NOT IN ('UNDO_ACTION', 'REDO_ACTION') ORDER BY timestamp DESC LIMIT 1; `;
    try {
      const result = await this.pool.query(sql);
      if (result.rows.length === 0) {
        logger.debug('[ActionHistoryRepositoryActions] No un-undone original actions found.');
        return undefined;
      }
      return this.mapRowToActionHistoryData(result.rows[0]);
    } catch (error: unknown) {
      logger.error('[ActionHistoryRepositoryActions] Failed to find last original action:', error);
      throw error;
    }
  }

  /** Finds the most recent action that represents an UNDO_ACTION and has not been undone (redone). */
  public async findLastUndoAction(): Promise<ActionHistoryData | undefined> {
    const sql = ` SELECT * FROM action_history WHERE is_undone = FALSE AND action_type = 'UNDO_ACTION' ORDER BY timestamp DESC LIMIT 1; `;
    try {
      const result = await this.pool.query(sql);
      if (result.rows.length === 0) {
        logger.debug('[ActionHistoryRepositoryActions] No un-redone UNDO_ACTIONs found.');
        return undefined;
      }
      return this.mapRowToActionHistoryData(result.rows[0]);
    } catch (error: unknown) {
      logger.error('[ActionHistoryRepositoryActions] Failed to find last undo action:', error);
      throw error;
    }
  }

  /** Finds recent UNDO_ACTIONs that have not been redone, within a transaction. */
  public async findRecentUndoActionsInClient(client: PoolClient, limit: number = 100): Promise<ActionHistoryData[]> {
    const sql = ` SELECT * FROM action_history WHERE is_undone = FALSE AND action_type = 'UNDO_ACTION' ORDER BY timestamp DESC LIMIT $1; `;
    try {
      const result = await client.query(sql, [limit]);
      logger.debug(
        `[ActionHistoryRepositoryActions] Found ${result.rows.length} recent un-redone UNDO_ACTIONs in transaction.`
      );
      return result.rows.map(this.mapRowToActionHistoryData);
    } catch (error: unknown) {
      logger.error('[ActionHistoryRepositoryActions] Failed to find recent undo actions in transaction:', error);
      throw error;
    }
  }

  /** Marks an original action record as undone by linking it to the UNDO_ACTION record. */
  public async markActionAsUndone(actionId: string, undoActionId: string, client: PoolClient): Promise<void> {
    const sql = ` UPDATE action_history SET is_undone = TRUE, undone_at_action_id = $2 WHERE action_id = $1; `;
    try {
      const result = await client.query(sql, [actionId, undoActionId]);
      if (result.rowCount === 0)
        logger.warn(
          `[ActionHistoryRepositoryActions] markActionAsUndone: Action ${actionId} not found or already undone.`
        );
      else
        logger.debug(`[ActionHistoryRepositoryActions] Marked action ${actionId} as undone by action ${undoActionId}.`);
    } catch (error: unknown) {
      logger.error(`[ActionHistoryRepositoryActions] Failed to mark action ${actionId} as undone:`, error);
      throw error;
    }
  }

  /** Marks an UNDO_ACTION as "undone" (i.e., redone or invalidated) and links it to the redoing/invalidating action. */
  public async markUndoActionAsRedone(
    undoActionId: string,
    redoOrInvalidatingActionId: string | null,
    client: PoolClient
  ): Promise<void> {
    const sql = ` UPDATE action_history SET is_undone = TRUE, undone_at_action_id = $2 WHERE action_id = $1 AND action_type = 'UNDO_ACTION'; `;
    try {
      const result = await client.query(sql, [undoActionId, redoOrInvalidatingActionId]);
      if (result.rowCount === 0)
        logger.warn(
          `[ActionHistoryRepositoryActions] markUndoActionAsRedone: UNDO_ACTION ${undoActionId} not found or already marked as undone/redone.`
        );
      else
        logger.debug(
          `[ActionHistoryRepositoryActions] Marked UNDO_ACTION ${undoActionId} as redone/invalidated by action ${
            redoOrInvalidatingActionId ?? '(new action)'
          }.`
        );
    } catch (error: unknown) {
      logger.error(`[ActionHistoryRepositoryActions] Failed to mark UNDO_ACTION ${undoActionId} as redone:`, error);
      throw error;
    }
  }

  /** Marks an original action history record as NOT undone (e.g., after a redo), clearing the link. */
  public async markActionAsNotUndone(actionId: string, client: PoolClient): Promise<void> {
    const sql = ` UPDATE action_history SET is_undone = FALSE, undone_at_action_id = NULL WHERE action_id = $1; `;
    try {
      const result = await client.query(sql, [actionId]);
      if (result.rowCount === 0)
        logger.warn(
          `[ActionHistoryRepositoryActions] markActionAsNotUndone: Action ${actionId} not found or was not undone.`
        );
      else logger.debug(`[ActionHistoryRepositoryActions] Marked action ${actionId} as NOT undone (redone).`);
    } catch (error: unknown) {
      logger.error(`[ActionHistoryRepositoryActions] Failed to mark action ${actionId} as NOT undone:`, error);
      throw error;
    }
  }

  /** Finds the original action ID that was undone by a specific UNDO_ACTION. */
  public async findOriginalActionIdForUndo(undoActionId: string): Promise<string | undefined> {
    // Find the action that has its 'undone_at_action_id' set to the ID of the UNDO action
    const sql = ` SELECT action_id FROM action_history WHERE undone_at_action_id = $1 AND is_undone = TRUE LIMIT 1; `;
    try {
      const result = await this.pool.query(sql, [undoActionId]);
      if (result.rows.length === 0) {
        logger.warn(
          `[ActionHistoryRepositoryActions] Could not find original action undone by UNDO_ACTION ${undoActionId}. Link might be missing or incorrect.`
        );
        return undefined;
      }
      return result.rows[0].action_id;
    } catch (error: unknown) {
      logger.error(
        `[ActionHistoryRepositoryActions] Failed to find original action ID for undo action ${undoActionId}:`,
        error
      );
      throw error;
    }
  }

  /** Lists recent action history records, optionally filtered. */
  public async listRecentActions(filter?: {
    work_item_id?: string | null;
    limit?: number;
  }): Promise<ActionHistoryData[]> {
    let sql = ` SELECT * FROM action_history `;
    const params: (string | number | null | undefined)[] = [];
    const whereClauses: string[] = [];
    let paramIndex = 1;

    if (filter?.work_item_id !== undefined && filter.work_item_id !== null) {
      whereClauses.push(`work_item_id = $${paramIndex++}`);
      params.push(filter.work_item_id);
    }
    if (whereClauses.length > 0) sql += ' WHERE ' + whereClauses.join(' AND ');
    sql += ' ORDER BY timestamp DESC ';
    if (filter?.limit !== undefined && filter.limit !== null) {
      sql += ` LIMIT $${paramIndex++}`;
      params.push(filter.limit);
    }

    try {
      const result = await this.pool.query(sql, params);
      logger.debug(`[ActionHistoryRepositoryActions] Found ${result.rows.length} recent actions.`);
      return result.rows.map(this.mapRowToActionHistoryData);
    } catch (error: unknown) {
      logger.error('[ActionHistoryRepositoryActions] Failed to list recent actions:', error);
      throw error;
    }
  }
}
