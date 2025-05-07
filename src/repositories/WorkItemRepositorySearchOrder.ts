// src/repositories/WorkItemRepositorySearchOrder.ts
import { type PoolClient, type Pool, type QueryResult } from 'pg';
import { WorkItemRepositoryBase, type WorkItemData } from './WorkItemRepositoryBase.js';
import { logger } from '../utils/logger.js';
import { NotFoundError } from '../utils/errors.js'; // FIX: Added import for NotFoundError

// Interface for the filters parameter for findCandidateTasksForSuggestion
export interface CandidateTaskFilters {
  scopeItemId?: string | null;
  includeTags?: string[] | null;
  excludeTags?: string[] | null;
}

// Interface for listWorkItems filters
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

  /**
   * Lists work items based on various filter criteria.
   */
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

  /**
   * Searches for work items by name or description.
   */
  public async searchByNameOrDescription(
    searchTerm: string,
    isActiveFilter?: boolean, // Expects boolean or undefined
    client?: PoolClient | Pool
  ): Promise<WorkItemData[]> {
    const dbClient = client || this.pool;
    let sql = `SELECT * FROM work_items WHERE (name ILIKE $1 OR description ILIKE $1)`;
    const params: any[] = [`%${searchTerm}%`];
    let paramIndex = 2; // Start next param index at 2

    // Directly use the boolean filter value
    if (isActiveFilter === true) {
      sql += ` AND is_active = $${paramIndex++}`;
      params.push(true);
    } else if (isActiveFilter === false) {
      sql += ` AND is_active = $${paramIndex++}`;
      params.push(false);
    }
    // If isActiveFilter is undefined, no WHERE clause for is_active is added

    sql += ` ORDER BY is_active DESC, name ASC;`; // Order might need adjustment based on relevance

    try {
      const result = await dbClient.query(sql, params);
      return result.rows.map(this.mapRowToWorkItemData);
    } catch (error) {
      logger.error(`[WorkItemRepositorySearchOrder] Error searching by name/description for "${searchTerm}":`, error);
      throw error;
    }
  }

  /**
   * Finds the order_key of the first or last sibling of a given parent.
   */
  public async findSiblingEdgeOrderKey(
    parentWorkItemId: string | null,
    edge: 'first' | 'last',
    client?: PoolClient | Pool // Allow Pool for reads
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

  /**
   * Finds the order_keys of the items immediately before and after a given sibling item.
   */
  public async findNeighbourOrderKeys(
    parentWorkItemId: string | null, // This is the *expected* parent, can be different from actual
    siblingWorkItemId: string,
    position: 'before' | 'after', // relative to siblingWorkItemId
    client?: PoolClient | Pool // Allow Pool for reads
  ): Promise<{ before: string | null; after: string | null }> {
    const dbClient = client || this.pool;
    if (!this.validateUuid(siblingWorkItemId, 'findNeighbourOrderKeys siblingWorkItemId')) {
      // Throw specific error if the provided ID is invalid format
      throw new NotFoundError(`Invalid UUID format for reference work item: ${siblingWorkItemId}`);
    }

    // Fetch the item itself to get its current order_key and actual parent_id
    const currentItemSql = `SELECT order_key, parent_work_item_id FROM work_items WHERE work_item_id = $1 AND is_active = TRUE;`;
    const currentItemParams = [siblingWorkItemId];
    let currentItemResult: QueryResult;
    try {
      currentItemResult = await dbClient.query(currentItemSql, currentItemParams);
    } catch (error) {
      logger.error(`[WorkItemRepositorySearchOrder] Error fetching current item ${siblingWorkItemId}`, error);
      throw error; // Rethrow DB errors
    }

    if (currentItemResult.rows.length === 0) {
      // Check if the item exists but is inactive
      const inactiveItemResult = await dbClient.query(
        'SELECT work_item_id FROM work_items WHERE work_item_id = $1 AND is_active = FALSE',
        [siblingWorkItemId]
      );
      if (inactiveItemResult.rows.length > 0) {
        logger.warn(`[WorkItemRepositorySearchOrder] Reference work item ${siblingWorkItemId} is inactive.`);
        throw new NotFoundError(
          `Reference work item ${siblingWorkItemId} not found, not active, or does not belong to parent ${parentWorkItemId ?? 'root'}.`
        );
      } else {
        logger.warn(`[WorkItemRepositorySearchOrder] Reference work item ${siblingWorkItemId} not found.`);
        throw new NotFoundError(
          `Reference work item ${siblingWorkItemId} not found, not active, or does not belong to parent ${parentWorkItemId ?? 'root'}.`
        );
      }
    }
    const currentOrderKey = currentItemResult.rows[0].order_key;
    const actualItemParentId = currentItemResult.rows[0].parent_work_item_id;

    // Validate parent consistency if an expected parent was provided
    // Use !== comparison which handles null correctly
    if (parentWorkItemId !== undefined && parentWorkItemId !== actualItemParentId) {
      logger.warn(
        `[WorkItemRepositorySearchOrder] Reference item ${siblingWorkItemId} does not belong to the expected parent ${parentWorkItemId ?? 'root'}. Actual parent: ${actualItemParentId ?? 'root'}.`
      );
      throw new NotFoundError(
        `Reference work item ${siblingWorkItemId} not found, not active, or does not belong to parent ${parentWorkItemId ?? 'root'}.`
      );
    }

    let beforeSql: string;
    let afterSql: string;
    const queryBaseParams: any[] = [currentOrderKey]; // $1 will always be currentOrderKey

    if (actualItemParentId) {
      if (!this.validateUuid(actualItemParentId, 'findNeighbourOrderKeys actualItemParentId')) {
        // Should not happen if fetched above, but check defensively
        logger.error(
          `[WorkItemRepositorySearchOrder] Fetched item ${siblingWorkItemId} has invalid parent UUID: ${actualItemParentId}`
        );
        // Return nulls or throw depending on desired strictness
        return { before: null, after: null };
      }
      // actualItemParentId will be $2
      beforeSql = `SELECT order_key FROM work_items WHERE parent_work_item_id = $2 AND order_key < $1 AND is_active = TRUE ORDER BY order_key DESC NULLS LAST LIMIT 1;`;
      afterSql = `SELECT order_key FROM work_items WHERE parent_work_item_id = $2 AND order_key > $1 AND is_active = TRUE ORDER BY order_key ASC NULLS FIRST LIMIT 1;`;
      queryBaseParams.push(actualItemParentId); // Add parent_id as the second parameter
    } else {
      beforeSql = `SELECT order_key FROM work_items WHERE parent_work_item_id IS NULL AND order_key < $1 AND is_active = TRUE ORDER BY order_key DESC NULLS LAST LIMIT 1;`;
      afterSql = `SELECT order_key FROM work_items WHERE parent_work_item_id IS NULL AND order_key > $1 AND is_active = TRUE ORDER BY order_key ASC NULLS FIRST LIMIT 1;`;
      // No second parameter if parent_work_item_id IS NULL
    }

    try {
      let keyBefore: string | null = null;
      let keyAfter: string | null = null;

      if (position === 'before') {
        // We want to insert *before* siblingWorkItemId
        const beforeResult = await dbClient.query(beforeSql, queryBaseParams);
        keyBefore = beforeResult.rows.length > 0 ? beforeResult.rows[0].order_key : null;
        keyAfter = currentOrderKey; // The item after the new one is the current item
      } else {
        // position === 'after'
        // We want to insert *after* siblingWorkItemId
        const afterResult = await dbClient.query(afterSql, queryBaseParams);
        keyBefore = currentOrderKey; // The item before the new one is the current item
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
      throw error; // Rethrow DB errors
    }
  }

  /**
   * Finds candidate work items for the 'get_next_task' suggestion logic.
   * Applies filters for scope (descendants of an item), tag inclusion/exclusion,
   * and always filters for active, non-done items.
   * **Only returns tasks (items with a parent), not projects.**
   */
  public async findCandidateTasksForSuggestion(
    filters: CandidateTaskFilters,
    client?: PoolClient | Pool
  ): Promise<WorkItemData[]> {
    const dbClient = client || this.pool;
    const { scopeItemId, includeTags, excludeTags } = filters;

    let sqlQuery = '';
    const queryParams: any[] = [];
    let paramIndex = 1;
    let scopeItemIdIsValidAndUsed = false;

    if (scopeItemId) {
      if (!this.validateUuid(scopeItemId, 'findCandidateTasksForSuggestion scopeItemId')) {
        logger.warn(
          `[WorkItemRepositorySearchOrder] Invalid UUID for scopeItemId: ${scopeItemId}. Proceeding without scope filter.`
        );
      } else {
        // Use CTE to find all descendants (including the scope item itself if it's a task)
        sqlQuery += `
          WITH RECURSIVE descendant_items AS (
            SELECT work_item_id, parent_work_item_id
            FROM work_items
            WHERE work_item_id = $${paramIndex++} AND is_active = TRUE -- Start with the scope item
            UNION ALL
            SELECT wi.work_item_id, wi.parent_work_item_id
            FROM work_items wi
            INNER JOIN descendant_items di ON wi.parent_work_item_id = di.work_item_id
            WHERE wi.is_active = TRUE -- Only traverse active items
          )
        `;
        queryParams.push(scopeItemId);
        scopeItemIdIsValidAndUsed = true;
      }
    }

    sqlQuery += `
      SELECT wi.*
      FROM work_items wi
    `;

    if (scopeItemIdIsValidAndUsed) {
      // Join with the CTE to filter by scope
      sqlQuery += `
        JOIN descendant_items di_scope ON wi.work_item_id = di_scope.work_item_id
      `;
    }

    const whereConditions: string[] = [];
    whereConditions.push('wi.is_active = TRUE'); // Must be active
    whereConditions.push("wi.status <> 'done'"); // Must not be done
    whereConditions.push('wi.parent_work_item_id IS NOT NULL'); // MUST be a task (have a parent)

    if (includeTags && includeTags.length > 0) {
      whereConditions.push(`(wi.tags IS NOT NULL AND wi.tags @> $${paramIndex++}::text[])`);
      queryParams.push(includeTags);
    }

    if (excludeTags && excludeTags.length > 0) {
      whereConditions.push(`(wi.tags IS NULL OR NOT (wi.tags && $${paramIndex++}::text[]))`);
      queryParams.push(excludeTags);
    }

    if (whereConditions.length > 0) {
      sqlQuery += ` WHERE ${whereConditions.join(' AND ')}`;
    }

    // Order results to prioritize tasks
    sqlQuery += `
      ORDER BY
        wi.due_date ASC NULLS LAST,  -- Earlier due date first
        CASE wi.priority            -- Higher priority first
          WHEN 'high' THEN 1
          WHEN 'medium' THEN 2
          WHEN 'low' THEN 3
          ELSE 4
        END ASC,
        wi.order_key ASC NULLS LAST, -- Lower order_key first (within same parent)
        wi.created_at ASC;          -- Fallback to creation time
    `;

    logger.debug(
      `[WorkItemRepositorySearchOrder] Executing findCandidateTasksForSuggestion SQL: ${sqlQuery.replace(/\s+/g, ' ').trim()}`
    );
    logger.debug(`[WorkItemRepositorySearchOrder] Parameters: ${JSON.stringify(queryParams)}`);

    try {
      const result = await dbClient.query(sqlQuery, queryParams);
      return result.rows.map((row) => this.mapRowToWorkItemData(row));
    } catch (error) {
      logger.error('[WorkItemRepositorySearchOrder] Error in findCandidateTasksForSuggestion:', {
        sql: sqlQuery,
        params: queryParams,
        error,
      });
      throw error; // Rethrow the error to be handled by the service layer
    }
  }
}
