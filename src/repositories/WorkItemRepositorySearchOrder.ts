// src/repositories/WorkItemRepositorySearchOrder.ts
import { type Pool, type PoolClient, type QueryResult } from 'pg';
import { WorkItemRepositoryBase, type WorkItemData } from './WorkItemRepositoryBase.js';
import { logger } from '../utils/logger.js';
import { NotFoundError } from '../utils/errors.js';

export interface CandidateTaskFilters {
  scopeItemId?: string | null;
  includeTags?: string[] | null;
  excludeTags?: string[] | null;
}

export interface ListWorkItemsFilters {
  parent_work_item_id?: string | null;
  status?: string | null;
  priority?: string | null;
  assignee_id?: string | null;
  due_date_before?: string | null;
  due_date_after?: string | null;
  is_active?: boolean;
  rootsOnly?: boolean;
  search_term?: string | null;
  include_tags?: string[] | null;
  exclude_tags?: string[] | null;
}

export class WorkItemRepositorySearchOrder extends WorkItemRepositoryBase {
  constructor(pool: Pool) {
    super(pool);
  }

  public async listWorkItems(filters: ListWorkItemsFilters = {}, client?: PoolClient | Pool): Promise<WorkItemData[]> {
    const dbClient = client || this.pool;
    let sql = `SELECT * FROM work_items`;
    const whereClauses: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (filters.rootsOnly === true) {
      whereClauses.push(`parent_work_item_id IS NULL`);
    } else if (filters.parent_work_item_id !== undefined) {
      if (filters.parent_work_item_id === null) {
        whereClauses.push(`parent_work_item_id IS NULL`);
      } else {
        if (this.validateUuid(filters.parent_work_item_id, 'listWorkItems parent_work_item_id')) {
          whereClauses.push(`parent_work_item_id = $${paramIndex++}`);
          params.push(filters.parent_work_item_id);
        } else {
          return [];
        }
      }
    }

    if (filters.status) {
      whereClauses.push(`status = $${paramIndex++}`);
      params.push(filters.status);
    }
    if (filters.priority) {
      whereClauses.push(`priority = $${paramIndex++}`);
      params.push(filters.priority);
    }
    if (filters.assignee_id) {
      logger.warn(
        '[WorkItemRepositorySearchOrder] listWorkItems: assignee_id filter is not yet implemented in schema.'
      );
    }
    if (filters.due_date_before) {
      whereClauses.push(`due_date <= $${paramIndex++}`);
      params.push(filters.due_date_before);
    }
    if (filters.due_date_after) {
      whereClauses.push(`due_date >= $${paramIndex++}`);
      params.push(filters.due_date_after);
    }

    if (filters.is_active === true) {
      whereClauses.push(`is_active = TRUE`);
    } else if (filters.is_active === false) {
      whereClauses.push(`is_active = FALSE`);
    }

    if (filters.search_term) {
      whereClauses.push(`(name ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`);
      params.push(`%${filters.search_term}%`);
      paramIndex++;
    }

    if (filters.include_tags && filters.include_tags.length > 0) {
      whereClauses.push(`(tags IS NOT NULL AND tags @> $${paramIndex++}::text[])`);
      params.push(filters.include_tags);
    }

    if (filters.exclude_tags && filters.exclude_tags.length > 0) {
      whereClauses.push(`(tags IS NULL OR NOT (tags && $${paramIndex++}::text[]))`);
      params.push(filters.exclude_tags);
    }

    if (whereClauses.length > 0) {
      sql += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    sql += ` ORDER BY order_key ASC NULLS LAST, created_at ASC;`;

    logger.debug(`[WorkItemRepositorySearchOrder] listWorkItems SQL: ${sql.replace(/\s+/g, ' ').trim()}`);
    logger.debug(`[WorkItemRepositorySearchOrder] listWorkItems PARAMS: ${JSON.stringify(params)}`);

    try {
      const result: QueryResult = await dbClient.query(sql, params);
      return result.rows.map(this.mapRowToWorkItemData);
    } catch (error) {
      logger.error('[WorkItemRepositorySearchOrder] Error listing work items:', { sql, params, error });
      throw error;
    }
  }

  public async searchByNameOrDescription(
    searchTerm: string,
    isActiveFilter?: boolean,
    client?: PoolClient | Pool
  ): Promise<WorkItemData[]> {
    const dbClient = client || this.pool;
    let sql = `SELECT * FROM work_items WHERE (name ILIKE $1 OR description ILIKE $1)`;
    const params: any[] = [`%${searchTerm}%`];
    let paramIndex = 2;

    if (isActiveFilter === true) {
      sql += ` AND is_active = $${paramIndex++}`;
      params.push(true);
    } else if (isActiveFilter === false) {
      sql += ` AND is_active = $${paramIndex++}`;
      params.push(false);
    }

    sql += ` ORDER BY is_active DESC, name ASC;`;

    try {
      const result = await dbClient.query(sql, params);
      return result.rows.map(this.mapRowToWorkItemData);
    } catch (error) {
      logger.error(`[WorkItemRepositorySearchOrder] Error searching by name/description for "${searchTerm}":`, error);
      throw error;
    }
  }

  public async findSiblingEdgeOrderKey(
    parentWorkItemId: string | null,
    edge: 'first' | 'last',
    client?: PoolClient | Pool
  ): Promise<string | null> {
    const dbClient = client || this.pool;
    let sql: string;
    const params: any[] = [];

    if (parentWorkItemId) {
      if (!this.validateUuid(parentWorkItemId, 'findSiblingEdgeOrderKey parent_work_item_id')) return null;
      sql = `SELECT order_key FROM work_items WHERE parent_work_item_id = $1 AND is_active = TRUE ORDER BY order_key ${
        edge === 'first' ? 'ASC' : 'DESC'
      } NULLS ${edge === 'first' ? 'FIRST' : 'LAST'} LIMIT 1;`;
      params.push(parentWorkItemId);
    } else {
      sql = `SELECT order_key FROM work_items WHERE parent_work_item_id IS NULL AND is_active = TRUE ORDER BY order_key ${
        edge === 'first' ? 'ASC' : 'DESC'
      } NULLS ${edge === 'first' ? 'FIRST' : 'LAST'} LIMIT 1;`;
    }

    try {
      const result = await dbClient.query(sql, params);
      return result.rows.length > 0 ? result.rows[0].order_key : null;
    } catch (error: unknown) {
      logger.error(
        `[WorkItemRepositorySearchOrder] Error finding ${edge} sibling order_key for parent ${
          parentWorkItemId ?? 'root'
        }:`,
        error
      );
      throw error;
    }
  }

  public async findNeighbourOrderKeys(
    parentWorkItemId: string | null,
    siblingWorkItemId: string,
    position: 'before' | 'after',
    client?: PoolClient | Pool
  ): Promise<{ before: string | null; after: string | null }> {
    const dbClient = client || this.pool;
    if (!this.validateUuid(siblingWorkItemId, 'findNeighbourOrderKeys siblingWorkItemId')) {
      throw new NotFoundError(`Invalid UUID format for reference work item: ${siblingWorkItemId}`);
    }

    const currentItemSql = `SELECT order_key, parent_work_item_id FROM work_items WHERE work_item_id = $1 AND is_active = TRUE;`;
    const currentItemParams = [siblingWorkItemId];
    let currentItemResult: QueryResult;
    try {
      currentItemResult = await dbClient.query(currentItemSql, currentItemParams);
    } catch (error) {
      logger.error(`[WorkItemRepositorySearchOrder] Error fetching current item ${siblingWorkItemId}`, error);
      throw error;
    }

    if (currentItemResult.rows.length === 0) {
      const inactiveItemResult = await dbClient.query(
        'SELECT work_item_id FROM work_items WHERE work_item_id = $1 AND is_active = FALSE',
        [siblingWorkItemId]
      );
      if (inactiveItemResult.rows.length > 0) {
        throw new NotFoundError(
          `Reference work item ${siblingWorkItemId} not found, not active, or does not belong to parent ${parentWorkItemId ?? 'root'}.`
        );
      } else {
        throw new NotFoundError(
          `Reference work item ${siblingWorkItemId} not found, not active, or does not belong to parent ${parentWorkItemId ?? 'root'}.`
        );
      }
    }
    const currentOrderKey = currentItemResult.rows[0].order_key;
    const actualItemParentId = currentItemResult.rows[0].parent_work_item_id;

    if (parentWorkItemId !== undefined && parentWorkItemId !== actualItemParentId) {
      throw new NotFoundError(
        `Reference work item ${siblingWorkItemId} not found, not active, or does not belong to parent ${parentWorkItemId ?? 'root'}.`
      );
    }

    let beforeSql: string;
    let afterSql: string;
    const queryBaseParams: any[] = [currentOrderKey];

    if (actualItemParentId) {
      if (!this.validateUuid(actualItemParentId, 'findNeighbourOrderKeys actualItemParentId')) {
        return { before: null, after: null };
      }
      beforeSql = `SELECT order_key FROM work_items WHERE parent_work_item_id = $2 AND order_key < $1 AND is_active = TRUE ORDER BY order_key DESC NULLS LAST LIMIT 1;`;
      afterSql = `SELECT order_key FROM work_items WHERE parent_work_item_id = $2 AND order_key > $1 AND is_active = TRUE ORDER BY order_key ASC NULLS FIRST LIMIT 1;`;
      queryBaseParams.push(actualItemParentId);
    } else {
      beforeSql = `SELECT order_key FROM work_items WHERE parent_work_item_id IS NULL AND order_key < $1 AND is_active = TRUE ORDER BY order_key DESC NULLS LAST LIMIT 1;`;
      afterSql = `SELECT order_key FROM work_items WHERE parent_work_item_id IS NULL AND order_key > $1 AND is_active = TRUE ORDER BY order_key ASC NULLS FIRST LIMIT 1;`;
    }

    try {
      let keyBefore: string | null = null;
      let keyAfter: string | null = null;

      if (position === 'before') {
        const beforeResult = await dbClient.query(beforeSql, queryBaseParams);
        keyBefore = beforeResult.rows.length > 0 ? beforeResult.rows[0].order_key : null;
        keyAfter = currentOrderKey;
      } else {
        const afterResult = await dbClient.query(afterSql, queryBaseParams);
        keyBefore = currentOrderKey;
        keyAfter = afterResult.rows.length > 0 ? afterResult.rows[0].order_key : null;
      }
      return { before: keyBefore, after: keyAfter };
    } catch (error: unknown) {
      logger.error(
        `[WorkItemRepositorySearchOrder] Error finding neighbours for ${siblingWorkItemId} (parent: ${
          actualItemParentId ?? 'root'
        }):`,
        { error, sqlBefore: beforeSql, sqlAfter: afterSql, params: queryBaseParams }
      );
      throw error;
    }
  }

  public async findCandidateTasksForSuggestion(
    filters: CandidateTaskFilters,
    client?: PoolClient | Pool
  ): Promise<WorkItemData[]> {
    const dbClient = client || this.pool;
    const { scopeItemId, includeTags, excludeTags } = filters;

    const queryParams: any[] = [];
    let paramIndex = 1;
    let scopeCte = '';
    let scopeJoin = '';

    if (scopeItemId) {
      if (this.validateUuid(scopeItemId, 'findCandidateTasksForSuggestion scopeItemId')) {
        scopeCte = `
          WITH RECURSIVE descendant_items AS (
            SELECT work_item_id FROM work_items WHERE work_item_id = $${paramIndex++} AND is_active = TRUE
            UNION
            SELECT wi.work_item_id FROM work_items wi
            INNER JOIN descendant_items di ON wi.parent_work_item_id = di.work_item_id
            WHERE wi.is_active = TRUE
          )
        `;
        queryParams.push(scopeItemId);
        scopeJoin = 'JOIN descendant_items di_scope ON wi.work_item_id = di_scope.work_item_id';
      } else {
        logger.warn(`Invalid UUID for scopeItemId: ${scopeItemId}. Returning no tasks.`);
        return [];
      }
    }

    let whereConditions = `
      WHERE wi.is_active = TRUE
      AND wi.status <> 'done'
      AND wi.parent_work_item_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM work_item_dependencies wid
        JOIN work_items dep_wi ON wid.depends_on_work_item_id = dep_wi.work_item_id
        WHERE wid.work_item_id = wi.work_item_id
          AND wid.is_active = TRUE
          AND dep_wi.is_active = TRUE
          AND dep_wi.status <> 'done'
      )
    `;

    if (includeTags && includeTags.length > 0) {
      whereConditions += ` AND (wi.tags IS NOT NULL AND wi.tags @> $${paramIndex++}::text[])`;
      queryParams.push(includeTags);
    }

    if (excludeTags && excludeTags.length > 0) {
      whereConditions += ` AND (wi.tags IS NULL OR NOT (wi.tags && $${paramIndex++}::text[]))`;
      queryParams.push(excludeTags);
    }

    const sqlQuery = `
      ${scopeCte}
      SELECT wi.*
      FROM work_items wi
      ${scopeJoin}
      ${whereConditions}
      ORDER BY
        (wi.due_date IS NULL),
        wi.due_date ASC,
        CASE wi.priority
          WHEN 'high' THEN 1
          WHEN 'medium' THEN 2
          WHEN 'low' THEN 3
          ELSE 4
        END ASC,
        wi.order_key ASC NULLS LAST,
        wi.created_at ASC
    `;

    try {
      const result = await dbClient.query(sqlQuery, queryParams);
      return result.rows.map(this.mapRowToWorkItemData);
    } catch (error) {
      logger.error('[WorkItemRepositorySearchOrder] Error in findCandidateTasksForSuggestion:', {
        sql: sqlQuery,
        params: queryParams,
        error,
      });
      throw error;
    }
  }
}
