// src/repositories/WorkItemRepositoryHierarchy.ts
import { type Pool, type PoolClient } from 'pg';
import { logger } from '../utils/logger.js';
import { WorkItemRepositoryBase, type WorkItemData } from './WorkItemRepositoryBase.js';

export class WorkItemRepositoryHierarchy extends WorkItemRepositoryBase {
  constructor(pool: Pool) {
    super(pool);
  }

  public async findRoots(
    filter?: { isActive?: boolean; status?: WorkItemData['status'] },
    client?: PoolClient | Pool // Made client optional
  ): Promise<WorkItemData[]> {
    const dbClient = client || this.pool; // Use provided client or default to pool
    let sql = ` SELECT * FROM work_items WHERE parent_work_item_id IS NULL `;
    const params: (string | boolean)[] = [];
    let paramIndex = 1;

    if (filter?.isActive === true) {
      sql += ` AND is_active = $${paramIndex++}`;
      params.push(true);
    } else if (filter?.isActive === false) {
      sql += ` AND is_active = $${paramIndex++}`;
      params.push(false);
    }

    if (filter?.status) {
      sql += ` AND status = $${paramIndex++}`;
      params.push(filter.status);
    }
    sql += ` ORDER BY order_key ASC, created_at ASC;`;

    try {
      const result = await dbClient.query(sql, params);
      return result.rows.map(this.mapRowToWorkItemData);
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryHierarchy] Failed to find root work items with filter:`, { filter, error });
      throw error;
    }
  }

  public async findChildren(
    parentWorkItemId: string,
    filter?: { isActive?: boolean; status?: WorkItemData['status'] },
    client?: PoolClient | Pool // Made client optional
  ): Promise<WorkItemData[]> {
    if (!this.validateUuid(parentWorkItemId, 'findChildren parentId')) {
      return [];
    }
    const dbClient = client || this.pool; // Use provided client or default to pool
    let sql = ` SELECT * FROM work_items WHERE parent_work_item_id = $1 `;
    const params: (string | boolean)[] = [parentWorkItemId];
    let paramIndex = 2;

    if (filter?.isActive === true) {
      sql += ` AND is_active = $${paramIndex++}`;
      params.push(true);
    } else if (filter?.isActive === false) {
      sql += ` AND is_active = $${paramIndex++}`;
      params.push(false);
    }

    if (filter?.status) {
      sql += ` AND status = $${paramIndex++}`;
      params.push(filter.status);
    }
    sql += ` ORDER BY order_key ASC, created_at ASC;`;

    try {
      const result = await dbClient.query(sql, params);
      return result.rows.map(this.mapRowToWorkItemData);
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryHierarchy] Failed to find children for parent ${parentWorkItemId}`, error);
      throw error;
    }
  }

  public async findDescendantWorkItemIds(
    workItemId: string,
    client: PoolClient // Requires client
  ): Promise<string[]> {
    // ... (this method already correctly uses the passed client)
    if (!this.validateUuid(workItemId, 'findDescendantWorkItemIds workItemId')) {
      return [];
    }
    const dbClient = this.getClient(client);

    const directChildrenSql = `SELECT work_item_id FROM work_items WHERE parent_work_item_id = $1`;
    const directChildrenResult = await dbClient.query(directChildrenSql, [workItemId]);
    const directChildrenIds = directChildrenResult.rows.map((r) => r.work_item_id);

    const allDescendants: Set<string> = new Set(directChildrenIds);
    const queue: string[] = [...directChildrenIds];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (!this.validateUuid(currentId, 'findDescendantWorkItemIds queue item')) continue;

      const grandchildrenResult = await dbClient.query(directChildrenSql, [currentId]);
      for (const row of grandchildrenResult.rows) {
        const grandchildId = row.work_item_id;
        if (!allDescendants.has(grandchildId)) {
          allDescendants.add(grandchildId);
          queue.push(grandchildId);
        }
      }
    }
    return Array.from(allDescendants);
  }

  public async findSiblings(
    workItemId: string,
    parentWorkItemId: string | null,
    filter?: { isActive?: boolean },
    client?: PoolClient | Pool // Made client optional
  ): Promise<WorkItemData[]> {
    if (!this.validateUuid(workItemId, 'findSiblings workItemId')) return [];
    if (parentWorkItemId !== null && !this.validateUuid(parentWorkItemId, 'findSiblings parentWorkItemId')) return [];

    const dbClient = client || this.pool; // Use provided client or default to pool
    let sql;
    const params: (string | boolean)[] = [];
    let paramIndex = 1;

    if (parentWorkItemId === null) {
      sql = `SELECT * FROM work_items WHERE parent_work_item_id IS NULL AND work_item_id != $${paramIndex++}`;
      params.push(workItemId);
    } else {
      sql = `SELECT * FROM work_items WHERE parent_work_item_id = $${paramIndex++} AND work_item_id != $${paramIndex++}`;
      params.push(parentWorkItemId, workItemId);
    }

    if (filter?.isActive === true) {
      sql += ` AND is_active = $${paramIndex++}`;
      params.push(true);
    } else if (filter?.isActive === false) {
      sql += ` AND is_active = $${paramIndex++}`;
      params.push(false);
    }
    sql += ` ORDER BY order_key ASC, created_at ASC;`;

    try {
      const result = await dbClient.query(sql, params);
      return result.rows.map(this.mapRowToWorkItemData);
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryHierarchy] Failed to find siblings for item ${workItemId}`, error);
      throw error;
    }
  }
}
