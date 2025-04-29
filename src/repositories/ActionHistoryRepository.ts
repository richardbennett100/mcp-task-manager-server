// src/repositories/ActionHistoryRepository.ts
import { Pool, PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';

// Define interfaces for the history data based on schema
export interface ActionHistoryData {
  action_id: string; // UUID
  user_id: string | null; // TEXT or null
  timestamp: string; // ISO String representation of TIMESTAMPTZ
  action_type: string; // e.g., 'ADD_WORK_ITEM', 'UNDO_ACTION'
  work_item_id: string | null; // UUID or null
  description: string | null; // TEXT NULL
  is_undone: boolean; // BOOLEAN
  undone_at_action_id: string | null; // UUID or null
}

export interface UndoStepData {
  undo_step_id: string; // UUID
  action_id: string; // UUID
  step_order: number; // INTEGER
  step_type: 'INSERT' | 'UPDATE' | 'DELETE'; // VARCHAR
  table_name: string; // VARCHAR
  record_id: string; // TEXT
  old_data: object | null; // JSONB
  new_data: object | null; // JSONB
}

// Input types for creating history records
export interface CreateActionHistoryInput extends Omit<ActionHistoryData, 'action_id' | 'timestamp' | 'is_undone' | 'undone_at_action_id'> {
    // Omit fields managed by the repository/DB
}

export interface CreateUndoStepInput extends Omit<UndoStepData, 'undo_step_id' | 'action_id'> {
    // Omit fields managed by the repository/DB or linked to action_id
}


export class ActionHistoryRepository {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Creates a new action history record and its associated undo steps atomically.
   * This method manages its own transaction. Use createActionInClient/createUndoStepInClient
   * if you need to include history recording in an existing transaction.
   * @param actionData - The data for the action_history record.
   * @param undoStepsData - An array of data for the undo_steps records.
   * @returns The created ActionHistoryData record.
   */
  public async createActionWithSteps(
    actionData: CreateActionHistoryInput,
    undoStepsData: CreateUndoStepInput[]
  ): Promise<ActionHistoryData> {
    const client: PoolClient = await this.pool.connect();
    const actionId = uuidv4();

    logger.debug(`[ActionHistoryRepository] Starting transaction for creating action ${actionId}`);
    try {
      await client.query('BEGIN');

      // 1. Insert the action_history record using the client
       const createdAction = await this.createActionInClient(actionData, client);


      // 2. Insert undo_steps records using the client
      if (undoStepsData.length > 0) {
        for (const step of undoStepsData) {
            await this.createUndoStepInClient({...step, action_id: createdAction.action_id }, client);
        }
      }

      await client.query('COMMIT');
      logger.info(
        `[ActionHistoryRepository] Created action ${actionId} with ${undoStepsData.length} steps (Transaction committed).`
      );
       return createdAction; // Return the created action data

    } catch (error: unknown) {
      // Enhanced logging in withTransaction will cover this rollback scenario
      await client.query('ROLLBACK'); // Rollback still necessary here
      throw error; // Re-throw original error
    } finally {
      client.release();
      logger.debug(
        `[ActionHistoryRepository] Released client after action creation attempt for ${actionId}`
      );
    }
  }

  /**
   * Creates a new action history record.
   * This method requires a client for transaction management.
   * @param actionData - The data for the action_history record.
   * @param client - The PostgreSQL client for the current transaction (required).
   * @returns The created ActionHistoryData record.
   */
  public async createActionInClient(
    actionData: CreateActionHistoryInput,
    client: PoolClient // Requires client
  ): Promise<ActionHistoryData> {
    const now = new Date().toISOString();
    const actionId = uuidv4();

    // user_id column should be TEXT now
    const insertActionSql = `
        INSERT INTO action_history (
            action_id, user_id, timestamp, action_type, work_item_id, description, is_undone
        ) VALUES ($1, $2, $3, $4, $5, $6, FALSE) -- is_undone is always FALSE initially
        RETURNING *;
    `;
    const actionParams = [
      actionId,
      actionData.user_id ?? null, // Use null for undefined user_id
      now,
      actionData.action_type,
      actionData.work_item_id ?? null, // Use null for undefined work_item_id
      actionData.description ?? null, // Use null for undefined description
    ];

    try {
        const result = await client.query(insertActionSql, actionParams);
        if (result.rowCount !== 1) {
            throw new Error(`Failed to insert action history record ${actionId}.`);
        }
        const createdAction = result.rows[0];
        logger.debug(`[ActionHistoryRepository] Created action ${actionId} in transaction.`);
         return {
            action_id: createdAction.action_id,
            user_id: createdAction.user_id,
            timestamp: createdAction.timestamp instanceof Date ? createdAction.timestamp.toISOString() : createdAction.timestamp,
            action_type: createdAction.action_type,
            work_item_id: createdAction.work_item_id,
            description: createdAction.description,
            is_undone: createdAction.is_undone,
            undone_at_action_id: createdAction.undone_at_action_id,
       };

    } catch (error: unknown) {
        // Log the full error object
        logger.error({ err: error }, `[ActionHistoryRepository] Error creating action ${actionId} in transaction`);
        throw error; // Re-throw to cause transaction rollback
    }
  }


  /**
   * Creates a new undo step record.
   * This method requires a client for transaction management.
   * @param stepData - The data for the undo_steps record.
   * @param client - The PostgreSQL client for the current transaction (required).
   */
   public async createUndoStepInClient(stepData: CreateUndoStepInput & { action_id: string }, client: PoolClient): Promise<void> {
       const stepId = uuidv4();
       // record_id should be TEXT
       const insertStepSql = `
           INSERT INTO undo_steps (
               undo_step_id, action_id, step_order, step_type, table_name, record_id, old_data, new_data
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
       `;
       const stepParams = [
           stepId,
           stepData.action_id,
           stepData.step_order,
           stepData.step_type,
           stepData.table_name,
           stepData.record_id, // record_id is TEXT in schema
           stepData.old_data !== undefined ? stepData.old_data : null,
           stepData.new_data !== undefined ? stepData.new_data : null,
       ];

       // Removed temporary debug block

       try {
           // Attempt the actual insert within the transaction
           await client.query(insertStepSql, stepParams);
           logger.debug(`[ActionHistoryRepository] Created undo step ${stepId} for action ${stepData.action_id} in transaction.`);
       } catch (error: unknown) {
            // Log the actual error object here too
            logger.error({ err: error }, `[ActionHistoryRepository] Error creating undo step ${stepId} for action ${stepData.action_id} in transaction`);
            throw error; // Re-throw to cause transaction rollback
       }
   }

    /**
     * Finds an action history record by its ID.
     * @param actionId - The ID of the action history record.
     * @returns The action_history data or undefined if not found.
     */
    public async findActionById(actionId: string): Promise<ActionHistoryData | undefined> {
        const sql = ` SELECT * FROM action_history WHERE action_id = $1; `;
        try {
            const result = await this.pool.query(sql, [actionId]);
            if (result.rows.length === 0) {
                logger.debug(`[ActionHistoryRepository] Action history record ${actionId} not found.`);
                return undefined;
            }
            const row = result.rows[0];
             return {
                action_id: row.action_id, user_id: row.user_id,
                timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : row.timestamp,
                action_type: row.action_type, work_item_id: row.work_item_id, description: row.description,
                is_undone: row.is_undone, undone_at_action_id: row.undone_at_action_id,
           };
        } catch (error: unknown) {
            logger.error(`[ActionHistoryRepository] Failed to find action history record ${actionId}:`, error);
            throw error;
        }
    }

    /**
     * Finds the most recent action that represents an original data modification
     * and has not been undone.
     * @returns The action_history data or undefined if none found.
     */
    public async findLastOriginalAction(): Promise<ActionHistoryData | undefined> {
        const sql = `
            SELECT * FROM action_history
            WHERE is_undone = FALSE AND action_type NOT IN ('UNDO_ACTION', 'REDO_ACTION')
            ORDER BY timestamp DESC LIMIT 1;
        `;
        try {
            const result = await this.pool.query(sql);
            if (result.rows.length === 0) {
                logger.debug('[ActionHistoryRepository] No un-undone original actions found.'); return undefined;
            }
            const row = result.rows[0];
             return {
                action_id: row.action_id, user_id: row.user_id,
                timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : row.timestamp,
                action_type: row.action_type, work_item_id: row.work_item_id, description: row.description,
                is_undone: row.is_undone, undone_at_action_id: row.undone_at_action_id,
           };
        } catch (error: unknown) {
            logger.error('[ActionHistoryRepository] Failed to find last original action:', error); throw error;
        }
    }

     /**
     * Finds the most recent action that represents an UNDO_ACTION
     * and has not been undone (redone).
     * @returns The action_history data or undefined if none found.
     */
    public async findLastUndoAction(): Promise<ActionHistoryData | undefined> {
        const sql = `
            SELECT * FROM action_history
            WHERE is_undone = FALSE AND action_type = 'UNDO_ACTION'
            ORDER BY timestamp DESC LIMIT 1;
        `;
        try {
            const result = await this.pool.query(sql);
            if (result.rows.length === 0) {
                 logger.debug('[ActionHistoryRepository] No un-redone UNDO_ACTIONs found.'); return undefined;
            }
            const row = result.rows[0];
             return {
                action_id: row.action_id, user_id: row.user_id,
                timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : row.timestamp,
                action_type: row.action_type, work_item_id: row.work_item_id, description: row.description,
                is_undone: row.is_undone, undone_at_action_id: row.undone_at_action_id,
           };
        } catch (error: unknown) {
            logger.error('[ActionHistoryRepository] Failed to find last undo action:', error); throw error;
        }
    }

     /**
     * Finds recent UNDO_ACTIONs that have not been redone, within a transaction.
     * Used for clearing the redo stack when a new original action occurs.
     * @param client - The PostgreSQL client for the current transaction (required).
     * @param limit - Optional limit on the number of results.
     * @returns An array of ActionHistoryData.
     */
    public async findRecentUndoActionsInClient(client: PoolClient, limit: number = 100): Promise<ActionHistoryData[]> {
         const sql = `
             SELECT * FROM action_history
             WHERE is_undone = FALSE AND action_type = 'UNDO_ACTION'
             ORDER BY timestamp DESC LIMIT $1;
         `;
         try {
             const result = await client.query(sql, [limit]);
              logger.debug(`[ActionHistoryRepository] Found ${result.rows.length} recent un-redone UNDO_ACTIONs in transaction.`);
              return result.rows.map(row => ({
                 action_id: row.action_id, user_id: row.user_id,
                 timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : row.timestamp,
                 action_type: row.action_type, work_item_id: row.work_item_id, description: row.description,
                 is_undone: row.is_undone, undone_at_action_id: row.undone_at_action_id,
            }));
         } catch (error: unknown) {
              logger.error('[ActionHistoryRepository] Failed to find recent undo actions in transaction:', error); throw error;
         }
    }


    /**
     * Retrieves all undo steps associated with a given action ID, ordered correctly.
     * @param actionId - The ID of the action history record.
     * @returns An array of UndoStepData.
     */
    public async findUndoStepsByActionId(actionId: string): Promise<UndoStepData[]> {
        const sql = `
            SELECT * FROM undo_steps WHERE action_id = $1 ORDER BY step_order ASC;
        `;
        try {
            const result = await this.pool.query(sql, [actionId]);
            logger.debug(`[ActionHistoryRepository] Found ${result.rows.length} steps for action ${actionId}.`);
             return result.rows.map(row => ({
                 undo_step_id: row.undo_step_id, action_id: row.action_id, step_order: row.step_order,
                 step_type: row.step_type, table_name: row.table_name, record_id: row.record_id,
                 old_data: row.old_data, new_data: row.new_data,
             }));
        } catch (error: unknown) {
            logger.error(`[ActionHistoryRepository] Failed to find steps for action ${actionId}:`, error); throw error;
        }
    }

    /**
     * Marks an action history record as undone and links it to the undoing action.
     * This should be done within the transaction of the undo action itself.
     * @param actionId - The ID of the action to mark as undone (the original action).
     * @param undoActionId - The ID of the UNDO_ACTION record that performed the undo.
     * @param client - The PostgreSQL client for the current transaction (required).
     */
    public async markActionAsUndone(actionId: string, undoActionId: string, client: PoolClient): Promise<void> {
        const sql = ` UPDATE action_history SET is_undone = TRUE, undone_at_action_id = $2 WHERE action_id = $1; `;
        try {
            const result = await client.query(sql, [actionId, undoActionId]);
            if (result.rowCount === 0) logger.warn(`[ActionHistoryRepository] markActionAsUndone: Action ${actionId} not found or already undone.`);
            else logger.debug(`[ActionHistoryRepository] Marked action ${actionId} as undone by action ${undoActionId}.`);
        } catch (error: unknown) {
             logger.error(`[ActionHistoryRepository] Failed to mark action ${actionId} as undone:`, error); throw error;
        }
    }

     /**
     * Marks an UNDO_ACTION history record as undone (redone) and links it to the redoing action.
     * This should be done within the transaction of the redo action itself.
     * @param undoActionId - The ID of the UNDO_ACTION record to mark as redone.
     * @param redoActionId - The ID of the REDO_ACTION record that performed the redo.
     * @param client - The PostgreSQL client for the current transaction (required).
     */
     public async markUndoActionAsRedone(undoActionId: string, redoActionId: string, client: PoolClient): Promise<void> {
        const sql = ` UPDATE action_history SET is_undone = TRUE, undone_at_action_id = $2 WHERE action_id = $1; `;
        try {
             const result = await client.query(sql, [undoActionId, redoActionId]);
             if (result.rowCount === 0) logger.warn(`[ActionHistoryRepository] markUndoActionAsRedone: UNDO_ACTION ${undoActionId} not found or already redone.`);
             else logger.debug(`[ActionHistoryRepository] Marked UNDO_ACTION ${undoActionId} as redone by action ${redoActionId}.`);
        } catch (error: unknown) {
             logger.error(`[ActionHistoryRepository] Failed to mark UNDO_ACTION ${undoActionId} as redone:`, error); throw error;
        }
     }


    /**
     * Lists recent action history records, optionally filtered.
     * @param filter - Optional filter criteria (e.g., workItemId, limit).
     * @returns An array of ActionHistoryData.
     */
    public async listRecentActions(filter?: { work_item_id?: string | null, limit?: number }): Promise<ActionHistoryData[]> {
        let sql = ` SELECT * FROM action_history `;
        const params: (string | number | null | undefined)[] = [];
        const whereClauses: string[] = [];
        let paramIndex = 1;

        if (filter?.work_item_id !== undefined && filter.work_item_id !== null) {
            whereClauses.push(`work_item_id = $${paramIndex++}`); params.push(filter.work_item_id);
        }
        if (whereClauses.length > 0) sql += ' WHERE ' + whereClauses.join(' AND ');
        sql += ' ORDER BY timestamp DESC ';
        if (filter?.limit !== undefined && filter.limit !== null) {
             sql += ` LIMIT $${paramIndex++}`; params.push(filter.limit);
        }

        try {
            const result = await this.pool.query(sql, params);
            logger.debug(`[ActionHistoryRepository] Found ${result.rows.length} recent actions.`);
            return result.rows.map(row => ({
                action_id: row.action_id, user_id: row.user_id,
                timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : row.timestamp,
                action_type: row.action_type, work_item_id: row.work_item_id, description: row.description,
                is_undone: row.is_undone, undone_at_action_id: row.undone_at_action_id,
            }));
        } catch (error: unknown) {
            logger.error('[ActionHistoryRepository] Failed to list recent actions:', error); throw error;
        }
    }

    // Utility method for the Service layer to use for transaction management
    public async withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        } catch (error: unknown) {
            // FIX: Log the error *before* attempting rollback
            logger.error({ err: error }, '[ActionHistoryRepository.withTransaction] Transaction error, attempting rollback');
            try {
                 await client.query('ROLLBACK');
                 logger.info('[ActionHistoryRepository.withTransaction] Transaction rolled back successfully.');
            } catch (rollbackError) {
                 // Log the rollback error as well, but still throw the original error
                 logger.error({ err: rollbackError },'[ActionHistoryRepository.withTransaction] CRITICAL: Error during ROLLBACK');
            }
            throw error; // Re-throw the original error that caused the rollback
        } finally {
            client.release();
        }
    }

}
