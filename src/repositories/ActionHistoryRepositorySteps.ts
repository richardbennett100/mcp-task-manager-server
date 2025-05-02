// src/repositories/ActionHistoryRepositorySteps.ts
import { Pool, PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import { ActionHistoryRepositoryBase, UndoStepData, CreateUndoStepInput } from './ActionHistoryRepositoryBase.js';

/**
 * Handles operations related to the undo_steps table.
 */
export class ActionHistoryRepositorySteps extends ActionHistoryRepositoryBase {
  constructor(pool: Pool) {
    super(pool);
  }

  /** Creates a new undo step record within an existing transaction. */
  public async createUndoStepInClient(
    stepData: CreateUndoStepInput & { action_id: string },
    client: PoolClient
  ): Promise<void> {
    const stepId = uuidv4();
    const insertStepSql = ` INSERT INTO undo_steps (undo_step_id, action_id, step_order, step_type, table_name, record_id, old_data, new_data) VALUES ($1, $2, $3, $4, $5, $6, $7, $8); `;
    const stepParams = [
      stepId,
      stepData.action_id,
      stepData.step_order,
      stepData.step_type,
      stepData.table_name,
      stepData.record_id,
      stepData.old_data !== null && stepData.old_data !== undefined ? JSON.stringify(stepData.old_data) : null,
      stepData.new_data !== null && stepData.new_data !== undefined ? JSON.stringify(stepData.new_data) : null,
    ];
    try {
      await client.query(insertStepSql, stepParams);
      logger.debug(
        `[ActionHistoryRepositorySteps] Created undo step ${stepId} for action ${stepData.action_id} in transaction.`
      );
    } catch (error: unknown) {
      logger.error(
        { err: error },
        `[ActionHistoryRepositorySteps] Error creating undo step ${stepId} for action ${stepData.action_id} in transaction`
      );
      throw error;
    }
  }

  /** Retrieves all undo steps associated with a given action ID, ordered correctly. */
  public async findUndoStepsByActionId(actionId: string): Promise<UndoStepData[]> {
    const sql = ` SELECT * FROM undo_steps WHERE action_id = $1 ORDER BY step_order ASC; `;
    try {
      const result = await this.pool.query(sql, [actionId]);
      logger.debug(`[ActionHistoryRepositorySteps] Found ${result.rows.length} steps for action ${actionId}.`);
      return result.rows.map(this.mapRowToUndoStepData);
    } catch (error: unknown) {
      logger.error(`[ActionHistoryRepositorySteps] Failed to find steps for action ${actionId}:`, error);
      throw error;
    }
  }
}
