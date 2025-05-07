// src/repositories/WorkItemRepositorySearchOrder.ts
import { type Pool, type PoolClient } from 'pg';
import { logger } from '../utils/logger.js';
import { WorkItemRepositoryBase, type WorkItemData } from './WorkItemRepositoryBase.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';

export class WorkItemRepositorySearchOrder extends WorkItemRepositoryBase {
  constructor(pool: Pool) {
    super(pool);
  }

  public async searchByNameOrDescription(
    query: string,
    filter?: { isActive?: boolean },
    client?: PoolClient | Pool // Made client optional
  ): Promise<WorkItemData[]> {
    const dbClient = client || this.pool; // Use provided client or default to pool
    let sql = ` SELECT * FROM work_items WHERE (name ILIKE $1 OR description ILIKE $1) `;
    const params: (string | boolean)[] = [`%${query}%`];
    let paramIndex = 2;

    if (filter?.isActive === true) {
      sql += ` AND is_active = $${paramIndex++}`;
      params.push(true);
    } else if (filter?.isActive === false) {
      sql += ` AND is_active = $${paramIndex++}`;
      params.push(false);
    }
    sql += ` ORDER BY updated_at DESC, created_at DESC;`;

    try {
      const result = await dbClient.query(sql, params);
      return result.rows.map(this.mapRowToWorkItemData);
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositorySearchOrder] Failed search for query "${query}":`, error);
      throw error;
    }
  }

  // findSiblingEdgeOrderKey and findNeighbourOrderKeys already require client
  public async findSiblingEdgeOrderKey(
    parentId: string | null,
    edge: 'first' | 'last',
    client: PoolClient // Requires client
  ): Promise<string | null> {
    // ... (method implementation)
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
    sql += ` AND order_key IS NOT NULL `;
    sql += ` ORDER BY order_key ${sortOrder} ${nullsPlacement} LIMIT 1;`;

    try {
      const result = await dbClient.query(sql, params);
      if (result.rows.length > 0 && result.rows[0].order_key !== null) {
        return String(result.rows[0].order_key);
      }
      return null;
    } catch (error) {
      logger.error(`[WorkItemRepositorySearchOrder] Error finding edge key for parent ${parentId ?? 'root'}:`, error);
      throw error;
    }
  }

  public async findNeighbourOrderKeys(
    parentId: string | null,
    relativeToId: string,
    relation: 'before' | 'after',
    client: PoolClient // Requires client
  ): Promise<{ before: string | null; after: string | null }> {
    // ... (method implementation)
    const dbClient = this.getClient(client);

    if (!this.validateUuid(relativeToId, 'findNeighbourOrderKeys relativeToId')) {
      throw new ValidationError(`Invalid UUID format for relativeToId: ${relativeToId}`);
    }
    if (parentId !== null && !this.validateUuid(parentId, 'findNeighbourOrderKeys parentId')) {
      throw new ValidationError(`Invalid UUID format for parentId: ${parentId}`);
    }

    try {
      let referenceKeySql = `SELECT order_key FROM work_items WHERE work_item_id = $1 AND is_active = TRUE AND `;
      const referenceParams: (string | null)[] = [relativeToId];
      let refParamIndex = 2;
      if (parentId === null) {
        referenceKeySql += ` parent_work_item_id IS NULL;`;
      } else {
        referenceKeySql += ` parent_work_item_id = $${refParamIndex++};`;
        referenceParams.push(parentId);
      }

      const refResult = await dbClient.query(referenceKeySql, referenceParams);
      if (refResult.rowCount === 0) {
        throw new NotFoundError(
          `Reference work item ${relativeToId} not found, not active, or does not belong to parent ${parentId ?? 'root'}.`
        );
      }
      const referenceKey = refResult.rows[0].order_key;
      const referenceKeyStr = referenceKey !== null ? String(referenceKey) : null;

      let baseSql = `SELECT order_key FROM work_items WHERE is_active = TRUE AND `;
      const baseParams: (string | null)[] = [];
      let baseParamIndex = 1;
      if (parentId === null) {
        baseSql += ` parent_work_item_id IS NULL `;
      } else {
        baseSql += ` parent_work_item_id = $${baseParamIndex++} `;
        baseParams.push(parentId);
      }

      let beforeSql = baseSql;
      const beforeParams = [...baseParams];
      let beforeParamIndex = baseParamIndex;
      if (referenceKeyStr === null) {
        beforeSql += ` AND order_key IS NOT NULL ORDER BY order_key DESC NULLS LAST LIMIT 1;`;
      } else {
        beforeSql += ` AND order_key < $${beforeParamIndex++} ORDER BY order_key DESC NULLS LAST LIMIT 1;`;
        beforeParams.push(referenceKeyStr);
      }
      const beforeResult = await dbClient.query(beforeSql, beforeParams);
      const keyBefore = beforeResult.rows.length > 0 ? String(beforeResult.rows[0].order_key) : null;

      let afterSql = baseSql;
      const afterParams = [...baseParams];
      let afterParamIndex = baseParamIndex;
      if (referenceKeyStr === null) {
        afterSql += ` AND 1 = 0 LIMIT 1;`;
      } else {
        afterSql += ` AND order_key > $${afterParamIndex++} ORDER BY order_key ASC NULLS LAST LIMIT 1;`;
        afterParams.push(referenceKeyStr);
      }
      const afterResult = await dbClient.query(afterSql, afterParams);
      const keyAfter = afterResult.rows.length > 0 ? String(afterResult.rows[0].order_key) : null;

      let result: { before: string | null; after: string | null };
      if (relation === 'after') {
        result = { before: referenceKeyStr, after: keyAfter };
      } else {
        result = { before: keyBefore, after: referenceKeyStr };
      }
      return result;
    } catch (error) {
      logger.error(`[WorkItemRepositorySearchOrder] Error finding neighbour keys for item ${relativeToId}:`, error);
      throw error;
    }
  }
}
