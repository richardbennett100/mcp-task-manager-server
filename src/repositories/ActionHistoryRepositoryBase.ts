// src/repositories/ActionHistoryRepositoryBase.ts
import { Pool, PoolClient } from 'pg';
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
  undone_at_action_id: string | null; // UUID or null - ID of the UNDO_ACTION or REDO_ACTION that undid/redid this action
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
export interface CreateActionHistoryInput
  extends Omit<ActionHistoryData, 'action_id' | 'timestamp' | 'is_undone' | 'undone_at_action_id'> {}

export interface CreateUndoStepInput extends Omit<UndoStepData, 'undo_step_id' | 'action_id'> {}

/**
 * Base class/utility container for ActionHistoryRepository helpers.
 * Contains shared properties, types, and helper methods.
 */
export class ActionHistoryRepositoryBase {
  protected pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /** Safely gets a PoolClient, throwing if called without one in a context requiring it. */
  protected getClient(client?: PoolClient): PoolClient {
    if (!client) {
      logger.error('[ActionHistoryRepositoryBase] Transactional method called without a client.');
      throw new Error('Repository transactional method requires a client instance.');
    }
    return client;
  }

  /** Returns the client if provided, otherwise the pool for read operations. */
  protected getClientOrPool(client?: PoolClient): PoolClient | Pool {
    return client ?? this.pool;
  }

  /** Helper function to map row data to ActionHistoryData */
  protected mapRowToActionHistoryData(row: any): ActionHistoryData {
    // FIXME: Replace 'any' with a specific type for database rows if possible. (Lines 65, 83, 85)
    return {
      action_id: row.action_id,
      user_id: row.user_id,
      timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : String(row.timestamp), // Ensure string
      action_type: row.action_type,
      work_item_id: row.work_item_id,
      description: row.description,
      is_undone: row.is_undone === true, // Ensure boolean
      undone_at_action_id: row.undone_at_action_id,
    };
  }

  /** Helper to map raw row data to UndoStepData, ensuring JSON parsing */
  protected mapRowToUndoStepData(row: any): UndoStepData {
    // FIXME: Replace 'any' with a specific type for database rows if possible. (Line 83)
    const parseJsonIfNeeded = (data: any): object | null => {
      // FIXME: Replace 'any' with a specific type for JSONB data if possible. (Line 85)
      if (data === null || typeof data === 'object') return data;
      if (typeof data === 'string') {
        try {
          return JSON.parse(data);
        } catch (e) {
          logger.error(`[ActionHistoryRepositoryBase] Failed to parse JSONB data: ${data}`, e);
          return null;
        }
      }
      return null;
    };
    return {
      undo_step_id: row.undo_step_id,
      action_id: row.action_id,
      step_order: row.step_order,
      step_type: row.step_type,
      table_name: row.table_name,
      record_id: row.record_id,
      old_data: parseJsonIfNeeded(row.old_data),
      new_data: parseJsonIfNeeded(row.new_data),
    };
  }

  /** Wraps a database operation in a transaction */
  public async withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error: unknown) {
      logger.error(
        { err: error },
        '[ActionHistoryRepositoryBase.withTransaction] Transaction error, attempting rollback'
      );
      try {
        await client.query('ROLLBACK');
        logger.info('[ActionHistoryRepositoryBase.withTransaction] Transaction rolled back successfully.');
      } catch (rollbackError) {
        logger.error(
          { err: rollbackError },
          '[ActionHistoryRepositoryBase.withTransaction] CRITICAL: Error during ROLLBACK'
        );
      }
      throw error; // Re-throw the original error
    } finally {
      client.release();
    }
  }
}
