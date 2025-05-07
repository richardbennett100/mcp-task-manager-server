// src/repositories/WorkItemRepositoryHierarchy.ts
import { Pool, PoolClient } from 'pg';
import { logger } from '../utils/logger.js';
import { WorkItemRepositoryBase, WorkItemData } from './WorkItemRepositoryBase.js';
//import { validate as uuidValidate } from 'uuid';

/**
 * Handles operations related to the hierarchy of Work Items (roots, children, descendants, siblings).
 */
export class WorkItemRepositoryHierarchy extends WorkItemRepositoryBase {
  constructor(pool: Pool) {
    super(pool);
  }

  /**
   * Finds all root work items (projects), optionally filtering by active status and/or status.
   * Uses the connection pool directly.
   */
  public async findRoots(
    filter?: { isActive?: boolean; status?: WorkItemData['status'] }
    // client parameter removed
  ): Promise<WorkItemData[]> {
    const dbClient = this.pool; // Use pool

    let sql = ` SELECT * FROM work_items WHERE parent_work_item_id IS NULL `;
    const params: (string | boolean)[] = [];
    let paramIndex = 1;

    const isActiveFilter = filter?.isActive === undefined ? true : filter.isActive;
    sql += ` AND is_active = $${paramIndex++}`;
    params.push(isActiveFilter);

    if (filter?.status) {
      sql += ` AND status = $${paramIndex++}`;
      params.push(filter.status);
    }

    sql += ` ORDER BY order_key ASC, created_at ASC;`;

    try {
      const result = await dbClient.query(sql, params);
      logger.debug(
        `[WorkItemRepositoryHierarchy] Found ${
          result.rows.length
        } root work items (active: ${isActiveFilter}, status: ${filter?.status ?? 'any'}).`
      );
      return result.rows.map(this.mapRowToWorkItemData);
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryHierarchy] Failed to find root work items with filter:`, { filter, error });
      throw error;
    }
  }

  /**
   * Finds all direct children of a given parent work item, optionally filtering by active status and/or status.
   * Uses the connection pool directly.
   */
  public async findChildren(
    parentWorkItemId: string,
    filter?: { isActive?: boolean; status?: WorkItemData['status'] }
    // client parameter removed
  ): Promise<WorkItemData[]> {
    logger.debug(
      `[WorkItemRepositoryHierarchy DIAG] findChildren called for parentId: ${parentWorkItemId} with filter:`,
      filter
    );

    if (!this.validateUuid(parentWorkItemId, 'findChildren parentId')) {
      logger.warn(
        `[WorkItemRepositoryHierarchy] findChildren called with invalid parentId: "${parentWorkItemId}". Returning empty array.`
      );
      return [];
    }

    const dbClient = this.pool; // Use pool

    let sql = ` SELECT * FROM work_items WHERE parent_work_item_id = $1 `;
    const params: (string | boolean)[] = [parentWorkItemId];
    let paramIndex = 2;

    const isActiveFilter = filter?.isActive === undefined ? true : filter.isActive;
    sql += ` AND is_active = $${paramIndex++}`;
    params.push(isActiveFilter);

    if (filter?.status) {
      sql += ` AND status = $${paramIndex++}`;
      params.push(filter.status);
    }

    sql += ` ORDER BY order_key ASC, created_at ASC;`;

    logger.debug(`[WorkItemRepositoryHierarchy DIAG] findChildren executing SQL: ${sql} with params:`, params);

    try {
      const result = await dbClient.query(sql, params);
      logger.debug(
        `[WorkItemRepositoryHierarchy DIAG] findChildren query for parent ${parentWorkItemId} (active: ${isActiveFilter}, status: ${filter?.status ?? 'any'}) executed. Rows found: ${result.rows.length}`
      );
      logger.debug(
        `[WorkItemRepositoryHierarchy] Found ${result.rows.length} children for parent ${parentWorkItemId} (active: ${isActiveFilter}, status: ${filter?.status ?? 'any'}).`
      );
      return result.rows.map(this.mapRowToWorkItemData);
    } catch (error: unknown) {
      logger.error(
        `[WorkItemRepositoryHierarchy] Failed to find children for parent ${parentWorkItemId} with params: ${JSON.stringify(
          params
        )}`,
        error
      );
      throw error;
    }
  }

  /**
   * Recursively finds all descendant work item IDs (children, grandchildren, etc.) of a given work item.
   * Fetches IDs regardless of their active status. Requires a client.
   */
  public async findDescendantWorkItemIds(workItemId: string, client: PoolClient): Promise<string[]> {
    // Requires client
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

    logger.debug(`[WorkItemRepositoryHierarchy] Found ${allDescendants.size} descendants for item ${workItemId}.`);
    return Array.from(allDescendants);
  }

  /**
   * Finds all sibling work items (same parent, excluding self), optionally filtering by active status.
   * Uses the connection pool directly.
   */
  public async findSiblings(
    workItemId: string,
    parentWorkItemId: string | null,
    filter?: { isActive?: boolean }
    // client parameter removed
  ): Promise<WorkItemData[]> {
    if (!this.validateUuid(workItemId, 'findSiblings workItemId')) {
      logger.warn(
        `[WorkItemRepositoryHierarchy] findSiblings called with invalid workItemId: "${workItemId}". Returning empty array.`
      );
      return [];
    }
    if (parentWorkItemId !== null && !this.validateUuid(parentWorkItemId, 'findSiblings parentWorkItemId')) {
      logger.warn(
        `[WorkItemRepositoryHierarchy] findSiblings called with invalid parentWorkItemId: "${parentWorkItemId}". Returning empty array.`
      );
      return [];
    }

    const dbClient = this.pool; // Use pool
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

    const isActiveFilter = filter?.isActive === undefined ? true : filter.isActive;
    sql += ` AND is_active = $${paramIndex++}`;
    params.push(isActiveFilter);

    sql += ` ORDER BY order_key ASC, created_at ASC;`;

    try {
      const result = await dbClient.query(sql, params);
      logger.debug(
        `[WorkItemRepositoryHierarchy] Found ${result.rows.length} siblings for item ${workItemId} (parent: ${
          parentWorkItemId ?? 'null'
        }, active filter: ${isActiveFilter}).`
      );
      return result.rows.map(this.mapRowToWorkItemData);
    } catch (error: unknown) {
      logger.error(
        `[WorkItemRepositoryHierarchy] Failed to find siblings for item ${workItemId} (parent: ${parentWorkItemId}) with params: ${JSON.stringify(
          params
        )}`,
        error
      );
      throw error;
    }
  }
}
