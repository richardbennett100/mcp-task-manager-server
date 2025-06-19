// src/repositories/WorkItemRepositoryDependencies.ts
import { type Pool, type PoolClient } from 'pg';
import { logger } from '../utils/logger.js';
import { WorkItemRepositoryBase, type WorkItemDependencyData } from './WorkItemRepositoryBase.js';

/**
 * Handles operations related to Work Item dependencies.
 */
export class WorkItemRepositoryDependencies extends WorkItemRepositoryBase {
  constructor(pool: Pool) {
    super(pool);
  }

  /**
   * Finds dependencies for a given work item, including the status of the item it depends on.
   */
  public async findDependencies(
    workItemId: string,
    filter?: { isActive?: boolean; dependsOnActive?: boolean },
    client?: PoolClient | Pool
  ): Promise<WorkItemDependencyData[]> {
    if (!this.validateUuid(workItemId, 'findDependencies workItemId')) {
      return [];
    }
    const dbClient = client || this.pool;

    let sql = `
            SELECT wid.*, wi_dep_on.status as depends_on_status
            FROM work_item_dependencies wid
            JOIN work_items wi_dep_on ON wid.depends_on_work_item_id = wi_dep_on.work_item_id
            WHERE wid.work_item_id = $1 `;
    const params: (string | boolean)[] = [workItemId];
    let paramIndex = 2;

    if (filter?.isActive === true) {
      sql += ` AND wid.is_active = $${paramIndex++}`;
      params.push(true);
    } else if (filter?.isActive === false) {
      sql += ` AND wid.is_active = $${paramIndex++}`;
      params.push(false);
    }

    if (filter?.dependsOnActive !== undefined) {
      sql += ` AND wi_dep_on.is_active = $${paramIndex++}`;
      params.push(filter.dependsOnActive);
    }
    sql += ` ORDER BY wid.depends_on_work_item_id;`;

    try {
      const result = await dbClient.query(sql, params);
      return result.rows.map(this.mapRowToWorkItemDependencyData);
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryDependencies] Failed to find dependencies for item ${workItemId}:`, error);
      throw error;
    }
  }

  public async findDependenciesByItemList(
    workItemIds: string[],
    filter?: { isActive?: boolean; dependsOnActive?: boolean },
    client?: PoolClient | Pool
  ): Promise<WorkItemDependencyData[]> {
    if (
      workItemIds.length === 0 ||
      !workItemIds.every((id) => this.validateUuid(id, 'findDependenciesByItemList list item'))
    ) {
      logger.warn(`[WorkItemRepositoryDependencies] findDependenciesByItemList called with empty or invalid list.`);
      return [];
    }
    const dbClient = client || this.pool;
    const placeholders = workItemIds.map((_, i) => `$${i + 1}`).join(',');

    let sql = `
            SELECT wid.* FROM work_item_dependencies wid
            LEFT JOIN work_items wi_dep_on ON wid.depends_on_work_item_id = wi_dep_on.work_item_id
            WHERE wid.work_item_id IN (${placeholders}) `;
    const params: (string | boolean)[] = [...workItemIds];
    let paramIndex = params.length + 1;

    if (filter?.isActive === true) {
      sql += ` AND wid.is_active = $${paramIndex++}`;
      params.push(true);
    } else if (filter?.isActive === false) {
      sql += ` AND wid.is_active = $${paramIndex++}`;
      params.push(false);
    }

    if (filter?.dependsOnActive !== undefined) {
      sql += ` AND wi_dep_on.is_active = $${paramIndex++}`;
      params.push(filter.dependsOnActive);
    }
    sql += ` ORDER BY wid.work_item_id, wid.depends_on_work_item_id;`;

    try {
      const result = await dbClient.query(sql, params);
      return result.rows.map(this.mapRowToWorkItemDependencyData);
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryDependencies] Failed to find dependencies for item list:`, error);
      throw error;
    }
  }

  public async findDependents(
    dependsOnWorkItemId: string,
    filter?: { isActive?: boolean; dependentIsActive?: boolean },
    client?: PoolClient | Pool
  ): Promise<WorkItemDependencyData[]> {
    if (!this.validateUuid(dependsOnWorkItemId, 'findDependents dependsOnWorkItemId')) {
      return [];
    }
    const dbClient = client || this.pool;

    let sql = `
            SELECT wid.* FROM work_item_dependencies wid
            LEFT JOIN work_items wi_dependent ON wid.work_item_id = wi_dependent.work_item_id
            WHERE wid.depends_on_work_item_id = $1 `;
    const params: (string | boolean)[] = [dependsOnWorkItemId];
    let paramIndex = 2;

    if (filter?.isActive === true) {
      sql += ` AND wid.is_active = $${paramIndex++}`;
      params.push(true);
    } else if (filter?.isActive === false) {
      sql += ` AND wid.is_active = $${paramIndex++}`;
      params.push(false);
    }

    if (filter?.dependentIsActive !== undefined) {
      sql += ` AND wi_dependent.is_active = $${paramIndex++}`;
      params.push(filter.dependentIsActive);
    }
    sql += ` ORDER BY wid.work_item_id;`;

    try {
      const result = await dbClient.query(sql, params);
      return result.rows.map(this.mapRowToWorkItemDependencyData);
    } catch (error: unknown) {
      logger.error(
        `[WorkItemRepositoryDependencies] Failed to find dependents for item ${dependsOnWorkItemId}:`,
        error
      );
      throw error;
    }
  }

  public async findDependentsByItemList(
    dependsOnWorkItemIds: string[],
    filter?: { isActive?: boolean; dependentIsActive?: boolean },
    client?: PoolClient | Pool
  ): Promise<WorkItemDependencyData[]> {
    if (
      dependsOnWorkItemIds.length === 0 ||
      !dependsOnWorkItemIds.every((id) => this.validateUuid(id, 'findDependentsByItemList list item'))
    ) {
      logger.warn(`[WorkItemRepositoryDependencies] findDependentsByItemList called with empty or invalid list.`);
      return [];
    }
    const dbClient = client || this.pool;
    const placeholders = dependsOnWorkItemIds.map((_, i) => `$${i + 1}`).join(',');

    let sql = `
            SELECT wid.* FROM work_item_dependencies wid
            LEFT JOIN work_items wi_dependent ON wid.work_item_id = wi_dependent.work_item_id
            WHERE wid.depends_on_work_item_id IN (${placeholders}) `;
    const params: (string | boolean)[] = [...dependsOnWorkItemIds];
    let paramIndex = params.length + 1;

    if (filter?.isActive === true) {
      sql += ` AND wid.is_active = $${paramIndex++}`;
      params.push(true);
    } else if (filter?.isActive === false) {
      sql += ` AND wid.is_active = $${paramIndex++}`;
      params.push(false);
    }

    if (filter?.dependentIsActive !== undefined) {
      sql += ` AND wi_dependent.is_active = $${paramIndex++}`;
      params.push(filter.dependentIsActive);
    }
    sql += ` ORDER BY wid.depends_on_work_item_id, wid.work_item_id;`;

    try {
      const result = await dbClient.query(sql, params);
      return result.rows.map(this.mapRowToWorkItemDependencyData);
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryDependencies] Failed to find dependents for item list:`, error);
      throw error;
    }
  }

  public async findDependenciesByCompositeKeys(
    compositeKeys: { work_item_id: string; depends_on_work_item_id: string }[],
    filter?: { isActive?: boolean },
    client?: PoolClient | Pool
  ): Promise<WorkItemDependencyData[]> {
    if (
      compositeKeys.length === 0 ||
      !compositeKeys.every(
        (k) =>
          this.validateUuid(k.work_item_id, 'findDepsByCompositeKeys work_item_id') &&
          this.validateUuid(k.depends_on_work_item_id, 'findDepsByCompositeKeys depends_on')
      )
    ) {
      logger.warn(
        `[WorkItemRepositoryDependencies] findDependenciesByCompositeKeys called with empty or invalid list.`
      );
      return [];
    }
    const dbClient = client || this.pool;
    const whereClauses = compositeKeys
      .map((_, i) => `(work_item_id = $${i * 2 + 1} AND depends_on_work_item_id = $${i * 2 + 2})`)
      .join(' OR ');
    const params: (string | boolean)[] = compositeKeys.flatMap((key) => [
      key.work_item_id,
      key.depends_on_work_item_id,
    ]);
    let paramIndex = params.length + 1;

    let sql = ` SELECT * FROM work_item_dependencies WHERE ${whereClauses} `;

    if (filter?.isActive === true) {
      sql += ` AND is_active = $${paramIndex++}`;
      params.push(true);
    } else if (filter?.isActive === false) {
      sql += ` AND is_active = $${paramIndex++}`;
      params.push(false);
    }
    sql += ` ORDER BY work_item_id, depends_on_work_item_id;`;

    try {
      const result = await dbClient.query(sql, params);
      return result.rows.map(this.mapRowToWorkItemDependencyData);
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryDependencies] Failed to find dependencies by composite keys:`, error);
      throw error;
    }
  }

  public async softDeleteDependenciesByCompositeKeys(
    compositeKeys: { work_item_id: string; depends_on_work_item_id: string }[],
    client: PoolClient
  ): Promise<number> {
    if (
      compositeKeys.length === 0 ||
      !compositeKeys.every(
        (k) =>
          this.validateUuid(k.work_item_id, 'softDeleteDepsByCompKeys work_item_id') &&
          this.validateUuid(k.depends_on_work_item_id, 'softDeleteDepsByCompKeys depends_on')
      )
    ) {
      logger.warn(
        `[WorkItemRepositoryDependencies] softDeleteDependenciesByCompositeKeys called with empty or invalid list.`
      );
      return 0;
    }
    const dbClient = this.getClient(client); // Ensure client is used

    const whereClauses = compositeKeys
      .map((_, i) => `(work_item_id = $${i * 2 + 1} AND depends_on_work_item_id = $${i * 2 + 2})`)
      .join(' OR ');
    const params: string[] = compositeKeys.flatMap((key) => [key.work_item_id, key.depends_on_work_item_id]);
    // Only deactivate links that are currently active
    const sql = ` UPDATE work_item_dependencies SET is_active = FALSE WHERE (${whereClauses}) AND is_active = TRUE; `;

    try {
      const result = await dbClient.query(sql, params);
      return result.rowCount ?? 0;
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryDependencies] Failed to soft delete dependency links:`, error);
      throw error;
    }
  }
}
