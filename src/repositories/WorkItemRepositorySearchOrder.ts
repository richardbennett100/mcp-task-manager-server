// src/repositories/WorkItemRepositorySearchOrder.ts
import { Pool, PoolClient } from 'pg';
import { logger } from '../utils/logger.js';
import { WorkItemRepositoryBase, WorkItemData } from './WorkItemRepositoryBase.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';

/**
 * Handles search and order-related operations for Work Items.
 */
export class WorkItemRepositorySearchOrder extends WorkItemRepositoryBase {
  constructor(pool: Pool) {
    super(pool);
  }

  /**
   * Finds work items whose description or name matches a query string (case-insensitive).
   * Optionally filters by active status.
   */
  public async searchByNameOrDescription(query: string, filter?: { isActive?: boolean }): Promise<WorkItemData[]> {
    const dbClient = this.pool;
    let sql = ` SELECT * FROM work_items WHERE (name ILIKE $1 OR description ILIKE $1) `;
    const params: (string | boolean)[] = [`%${query}%`];
    let paramIndex = 2;
    const itemIsActive = filter?.isActive === undefined ? true : filter.isActive;
    sql += ` AND is_active = $${paramIndex++}`;
    params.push(itemIsActive);
    sql += ` ORDER BY updated_at DESC, created_at DESC;`;

    try {
      const result = await dbClient.query(sql, params);
      logger.debug(
        `[WorkItemRepositorySearchOrder] Found ${result.rows.length} items matching query "${query}" (active: ${itemIsActive}).`
      );
      return result.rows.map(this.mapRowToWorkItemData);
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositorySearchOrder] Failed search for query "${query}":`, error);
      throw error;
    }
  }

  /**
   * Finds the order_key of the first or last active sibling of a work item.
   * Handles root items (parentId is null).
   * Returns the key as a string, or null if no suitable sibling exists.
   */
  public async findSiblingEdgeOrderKey(
    parentId: string | null,
    edge: 'first' | 'last',
    client: PoolClient
  ): Promise<string | null> {
    const dbClient = this.getClient(client);
    const sortOrder = edge === 'first' ? 'ASC' : 'DESC';
    const nullsPlacement = edge === 'first' ? 'NULLS LAST' : 'NULLS FIRST';

    let sql = `
          SELECT order_key FROM work_items
          WHERE is_active = TRUE AND `;
    const params: (string | null)[] = [];
    let paramIndex = 1;

    if (parentId === null) {
      sql += ` parent_work_item_id IS NULL `;
    } else {
      if (!this.validateUuid(parentId, 'findSiblingEdgeOrderKey parentId')) return null;
      sql += ` parent_work_item_id = $${paramIndex++} `;
      params.push(parentId);
    }
    sql += ` AND order_key IS NOT NULL `; // Exclude null keys
    sql += ` ORDER BY order_key ${sortOrder} ${nullsPlacement} LIMIT 1;`;

    try {
      logger.debug(
        `[WorkItemRepositorySearchOrder] Executing findSiblingEdgeOrderKey: ${sql} PARAMS: ${JSON.stringify(params)}`
      );
      const result = await dbClient.query(sql, params);
      if (result.rows.length > 0 && result.rows[0].order_key !== null) {
        const key = String(result.rows[0].order_key);
        logger.debug(
          `[WorkItemRepositorySearchOrder] Found edge key ('${edge}'): ${key} for parent ${parentId ?? 'root'}`
        );
        return key;
      }
      logger.debug(
        `[WorkItemRepositorySearchOrder] No non-null edge key ('${edge}') found for parent ${parentId ?? 'root'}`
      );
      return null;
    } catch (error) {
      logger.error(`[WorkItemRepositorySearchOrder] Error finding edge key for parent ${parentId ?? 'root'}:`, error);
      throw error;
    }
  }

  /**
   * Finds the order_keys of the items immediately before and after a given sibling item ID.
   * Ensures the relativeToId item exists and is active under the specified parent.
   * Returns null for before/after if the relative item is the first/last respectively.
   */
  public async findNeighbourOrderKeys(
    parentId: string | null,
    relativeToId: string,
    relation: 'before' | 'after',
    client: PoolClient
  ): Promise<{ before: string | null; after: string | null }> {
    const dbClient = this.getClient(client);

    if (!this.validateUuid(relativeToId, 'findNeighbourOrderKeys relativeToId')) {
      throw new ValidationError(`Invalid UUID format for relativeToId: ${relativeToId}`);
    }
    if (parentId !== null && !this.validateUuid(parentId, 'findNeighbourOrderKeys parentId')) {
      throw new ValidationError(`Invalid UUID format for parentId: ${parentId}`);
    }

    // Wrap the core logic in try/catch
    try {
      // 1. Get the order_key of the reference item
      let referenceKeySql = `SELECT order_key FROM work_items WHERE work_item_id = $1 AND is_active = TRUE AND `;
      const referenceParams: (string | null)[] = [relativeToId];
      let refParamIndex = 2;
      if (parentId === null) {
        referenceKeySql += ` parent_work_item_id IS NULL;`;
      } else {
        referenceKeySql += ` parent_work_item_id = $${refParamIndex++};`;
        referenceParams.push(parentId);
      }

      logger.debug(
        `[WorkItemRepositorySearchOrder] Fetching reference key SQL: ${referenceKeySql} PARAMS: ${JSON.stringify(referenceParams)}`
      );
      const refResult = await dbClient.query(referenceKeySql, referenceParams);
      if (refResult.rowCount === 0) {
        throw new NotFoundError(
          `Reference work item ${relativeToId} not found, not active, or does not belong to parent ${parentId ?? 'root'}.`
        );
      }
      const referenceKey = refResult.rows[0].order_key;
      const referenceKeyStr = referenceKey !== null ? String(referenceKey) : null;
      logger.debug(`[WorkItemRepositorySearchOrder] Reference key for ${relativeToId} is: ${referenceKeyStr}`);

      // Define base query parts
      let baseSql = `SELECT order_key FROM work_items WHERE is_active = TRUE AND `;
      const baseParams: (string | null)[] = [];
      let baseParamIndex = 1;
      if (parentId === null) {
        baseSql += ` parent_work_item_id IS NULL `;
      } else {
        baseSql += ` parent_work_item_id = $${baseParamIndex++} `;
        baseParams.push(parentId);
      }

      // 2. Find the item immediately BEFORE the reference item
      let beforeSql = baseSql;
      const beforeParams = [...baseParams];
      let beforeParamIndex = baseParamIndex;
      if (referenceKeyStr === null) {
        beforeSql += ` AND order_key IS NOT NULL ORDER BY order_key DESC NULLS LAST LIMIT 1;`;
      } else {
        beforeSql += ` AND order_key < $${beforeParamIndex++} ORDER BY order_key DESC NULLS LAST LIMIT 1;`;
        beforeParams.push(referenceKeyStr);
      }
      logger.debug(
        `[WorkItemRepositorySearchOrder] Fetching 'before' key SQL: ${beforeSql} PARAMS: ${JSON.stringify(beforeParams)}`
      );
      const beforeResult = await dbClient.query(beforeSql, beforeParams);
      const keyBefore = beforeResult.rows.length > 0 ? String(beforeResult.rows[0].order_key) : null;

      // 3. Find the item immediately AFTER the reference item
      let afterSql = baseSql;
      const afterParams = [...baseParams];
      let afterParamIndex = baseParamIndex;
      if (referenceKeyStr === null) {
        afterSql += ` AND 1 = 0 LIMIT 1;`; // Impossible condition if ref key is null (logically last)
      } else {
        afterSql += ` AND order_key > $${afterParamIndex++} ORDER BY order_key ASC NULLS LAST LIMIT 1;`;
        afterParams.push(referenceKeyStr);
      }
      logger.debug(
        `[WorkItemRepositorySearchOrder] Fetching 'after' key SQL: ${afterSql} PARAMS: ${JSON.stringify(afterParams)}`
      );
      const afterResult = await dbClient.query(afterSql, afterParams);
      const keyAfter = afterResult.rows.length > 0 ? String(afterResult.rows[0].order_key) : null;

      // 4. Return the correct pair based on the desired relation
      let result: { before: string | null; after: string | null };
      if (relation === 'after') {
        result = { before: referenceKeyStr, after: keyAfter };
      } else {
        // relation === 'before'
        result = { before: keyBefore, after: referenceKeyStr };
      }
      logger.debug(
        `[WorkItemRepositorySearchOrder] Final neighbour keys for relation '${relation}' to ${relativeToId}: ${JSON.stringify(result)}`
      );
      return result;
    } catch (error) {
      // Catch block correctly placed now
      logger.error(`[WorkItemRepositorySearchOrder] Error finding neighbour keys for item ${relativeToId}:`, error);
      throw error;
    }
  } // End of findNeighbourOrderKeys method
} // End of WorkItemRepositorySearchOrder class
