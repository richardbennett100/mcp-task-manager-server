// src/repositories/WorkItemRepositoryUndoRedo.ts
import { Pool, PoolClient, QueryResult } from 'pg'; // Added Pool import
import { logger } from '../utils/logger.js';
import { WorkItemRepositoryBase } from './WorkItemRepositoryBase.js';
import { validate as uuidValidate } from 'uuid';

/**
 * Handles generic row manipulation for undo/redo operations.
 */
export class WorkItemRepositoryUndoRedo extends WorkItemRepositoryBase {
  constructor(pool: Pool) {
    super(pool);
  }

  /**
   * Updates a row in a specified table using the primary key(s) within the data object.
   */
  public async updateRowState(client: PoolClient, tableName: string, data: object): Promise<void> {
    const dbClient = this.getClient(client);

    const setClauses: string[] = [];
    const params: any[] = []; // FIXME: Replace 'any' with a specific type based on expected data (Line 22)
    let paramIndex = 1;
    const pkColumns: string[] = [];
    const pkValues: any[] = []; // FIXME: Replace 'any' with a specific type based on expected data (Line 25)
    let recordDesc = '';

    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        const value = (data as any)[key]; // FIXME: Replace 'any' with a specific type (Line 30)
        // Correctly identify PK columns based on table and key name
        if (tableName === 'work_items' && key === 'work_item_id') {
          pkColumns.push(`"${key}"`);
          pkValues.push(String(value));
          recordDesc = String(value);
        } else if (
          tableName === 'work_item_dependencies' &&
          (key === 'work_item_id' || key === 'depends_on_work_item_id')
        ) {
          pkColumns.push(`"${key}"`);
          pkValues.push(String(value));
          recordDesc += `${String(value)}:`;
        } else {
          setClauses.push(`"${key}" = $${paramIndex++}`);
          params.push(value === undefined ? null : value);
        }
      }
    }
    if (recordDesc.endsWith(':')) recordDesc = recordDesc.slice(0, -1);

    // FIX: Corrected the UUID validation check within the PK validation logic
    const isInvalidPk =
      pkColumns.length === 0 ||
      pkValues.some((v) => {
        if (!v) return true; // Missing value
        if (typeof v !== 'string') return false; // Not a string, can't be UUID
        if (tableName === 'work_items' && pkColumns.includes('"work_item_id"') && !uuidValidate(v)) return true; // UUID check for work_items PK
        if (
          tableName === 'work_item_dependencies' &&
          (pkColumns.includes('"work_item_id"') || pkColumns.includes('"depends_on_work_item_id"')) &&
          !uuidValidate(v)
        )
          return true; // UUID check for dependency PK parts
        return false;
      });

    if (isInvalidPk) {
      logger.error(
        `[WorkItemRepositoryUndoRedo] updateRowState: Missing or invalid primary key value(s) in data for ${tableName}. PKs: ${pkColumns.join(',')}, Values: ${pkValues.join(',')}`
      );
      throw new Error(`updateRowState: Missing or invalid primary key value(s) in data for ${tableName}.`);
    }

    pkValues.forEach((val) => params.push(val));
    const whereClause = pkColumns.map((col, i) => `${col} = $${paramIndex + i}`).join(' AND ');

    const sql = ` UPDATE "${tableName}" SET ${setClauses.join(', ')} WHERE ${whereClause}; `;
    try {
      const result = await dbClient.query(sql, params);
      if (result.rowCount === 0)
        logger.warn(
          `[WorkItemRepositoryUndoRedo] updateRowState: Row not found in ${tableName} ${recordDesc} during update based on PKs.`
        );
      else logger.debug(`[WorkItemRepositoryUndoRedo] Updated row in ${tableName} ${recordDesc} based on PKs.`);
    } catch (error: unknown) {
      // Log detailed error including the attempted update data
      logger.error(
        { err: error, table: tableName, pks: pkValues, updateData: data },
        `[WorkItemRepositoryUndoRedo] Failed to update row in ${tableName}`
      );
      throw error;
    }
  }

  /**
   * Inserts a row into the specified table. Uses ON CONFLICT DO NOTHING.
   */
  public async insertRow(client: PoolClient, tableName: string, data: object): Promise<void> {
    const dbClient = this.getClient(client);

    const columns: string[] = [];
    const placeholders: string[] = [];
    const params: any[] = []; // FIXME: Replace 'any' with a specific type based on expected data (Line 110)
    let paramIndex = 1;
    let conflictTarget = '';

    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        columns.push(`"${key}"`);
        placeholders.push(`$${paramIndex++}`);
        params.push(
          (data as any)[key] === undefined ? null : (data as any)[key] // FIXME: Replace 'any' with a specific type (Line 119, 119, 119)
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
      // We could potentially infer PKs for other tables if needed, but erroring is safer
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
   * Added logging to track calls.
   */
  public async deleteRow(client: PoolClient, tableName: string, recordId: string): Promise<void> {
    logger.debug(`[WorkItemRepositoryUndoRedo] deleteRow called for table: ${tableName}, recordId: ${recordId}`); // Log call
    const dbClient = this.getClient(client);

    let sql;
    const params: string[] = [];

    if (tableName === 'work_items') {
      if (!uuidValidate(recordId)) {
        logger.warn(`[WorkItemRepositoryUndoRedo] deleteRow: Invalid UUID format for work_items key: "${recordId}".`); // Linter fix applied here
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
          `[WorkItemRepositoryUndoRedo] deleteRow: Invalid composite key format or invalid UUIDs for ${tableName}: "${recordId}".` // Linter fix applied here
        );
        throw new Error(`deleteRow: Invalid composite key format or invalid UUIDs for ${tableName}: "${recordId}".`);
      }
      sql = `DELETE FROM "work_item_dependencies" WHERE "work_item_id" = $1 AND "depends_on_work_item_id" = $2;`;
      params.push(work_item_id, depends_on_work_item_id);
    } else {
      logger.warn(
        `[WorkItemRepositoryUndoRedo] deleteRow: Cannot delete row ${recordId} from table "${tableName}". Unsupported table or key format.`
      ); // Linter fix not applicable here
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
