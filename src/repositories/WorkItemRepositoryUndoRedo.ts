// src/repositories/WorkItemRepositoryUndoRedo.ts
import { Pool, PoolClient, QueryResult } from 'pg';
import { logger } from '../utils/logger.js';
import { WorkItemRepositoryBase } from './WorkItemRepositoryBase.js';
import { validate as uuidValidate } from 'uuid';

/**
 * Handles generic row manipulation specific to history/state restoration (if needed beyond direct service logic).
 * NOTE: updateRowState was removed as its logic is now handled directly in WorkItemHistoryService.
 */
export class WorkItemRepositoryUndoRedo extends WorkItemRepositoryBase {
  constructor(pool: Pool) {
    super(pool);
  }

  // updateRowState method removed

  /**
   * Inserts a row into the specified table. Uses ON CONFLICT DO NOTHING.
   * Potentially useful for other history mechanisms if implemented later.
   */
  public async insertRow(client: PoolClient, tableName: string, data: object): Promise<void> {
    const dbClient = this.getClient(client);

    const columns: string[] = [];
    const placeholders: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;
    let conflictTarget = '';

    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        columns.push(`"${key}"`);
        placeholders.push(`$${paramIndex++}`);
        params.push(
          (data as Record<string, unknown>)[key] === undefined ? null : (data as Record<string, unknown>)[key]
        );
      }
    }
    if (columns.length === 0) {
      logger.warn(`[WorkItemRepositoryUndoRedo] insertRow called for ${tableName} with no data fields.`);
      return;
    }

    if (tableName === 'work_items') {
      conflictTarget = '(work_item_id)';
    } else if (tableName === 'work_item_dependencies') {
      conflictTarget = '(work_item_id, depends_on_work_item_id)';
    } else {
      logger.error(
        `[WorkItemRepositoryUndoRedo] Cannot determine ON CONFLICT target for unknown table: ${tableName} in insertRow.`
      );
      throw new Error(`Cannot determine conflict target for unknown table: ${tableName}`);
    }

    const sql = ` INSERT INTO "${tableName}" (${columns.join(',')}) VALUES (${placeholders.join(',')}) ON CONFLICT ${conflictTarget} DO NOTHING; `;
    try {
      const result: QueryResult = await dbClient.query(sql, params);
      if ((result.rowCount ?? 0) > 0) logger.debug(`[WorkItemRepositoryUndoRedo] Inserted row into ${tableName}.`);
      else logger.warn(`[WorkItemRepositoryUndoRedo] Insert into ${tableName} resulted in conflict or no insert.`);
    } catch (error: unknown) {
      logger.error(
        { err: error, table: tableName, insertData: data },
        `[WorkItemRepositoryUndoRedo] Failed to insert row into ${tableName}`
      );
      throw error;
    }
  }

  /**
   * Deletes a row from the specified table using its primary key.
   * Potentially useful for other history mechanisms if implemented later.
   */
  public async deleteRow(client: PoolClient, tableName: string, recordId: string): Promise<void> {
    logger.debug(`[WorkItemRepositoryUndoRedo] deleteRow called for table: ${tableName}, recordId: ${recordId}`);
    const dbClient = this.getClient(client);

    let sql;
    const params: string[] = [];

    if (tableName === 'work_items') {
      if (!uuidValidate(recordId)) {
        logger.warn(`[WorkItemRepositoryUndoRedo] deleteRow: Invalid UUID format for work_items key: "${recordId}".`);
        throw new Error(`deleteRow: Invalid UUID format for work_items key: "${recordId}".`);
      }
      sql = `DELETE FROM "work_items" WHERE "work_item_id" = $1;`;
      params.push(recordId);
    } else if (tableName === 'work_item_dependencies' && typeof recordId === 'string' && recordId.includes(':')) {
      const [work_item_id, depends_on_work_item_id] = recordId.split(':');
      if (
        !work_item_id ||
        !depends_on_work_item_id ||
        !uuidValidate(work_item_id) ||
        !uuidValidate(depends_on_work_item_id)
      ) {
        logger.warn(
          `[WorkItemRepositoryUndoRedo] deleteRow: Invalid composite key format or invalid UUIDs for ${tableName}: "${recordId}".`
        );
        throw new Error(`deleteRow: Invalid composite key format or invalid UUIDs for ${tableName}: "${recordId}".`);
      }
      sql = `DELETE FROM "work_item_dependencies" WHERE "work_item_id" = $1 AND "depends_on_work_item_id" = $2;`;
      params.push(work_item_id, depends_on_work_item_id);
    } else {
      logger.warn(
        `[WorkItemRepositoryUndoRedo] deleteRow: Cannot delete row ${recordId} from table "${tableName}". Unsupported table or key format.`
      );
      throw new Error(
        `deleteRow: Cannot delete row ${recordId} from table "${tableName}". Unsupported table or key format.`
      );
    }

    try {
      const result = await dbClient.query(sql, params);
      if (result.rowCount === 0)
        logger.warn(`[WorkItemRepositoryUndoRedo] deleteRow: Row ${recordId} not found in ${tableName} during delete.`);
      else logger.debug(`[WorkItemRepositoryUndoRedo] Deleted row ${recordId} from ${tableName}.`);
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryUndoRedo] Failed to delete row ${recordId} from ${tableName}:`, error);
      throw error;
    }
  }
}
