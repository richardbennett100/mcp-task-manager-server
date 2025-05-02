// src/repositories/WorkItemRepositoryDependencies.ts
import { Pool, PoolClient } from 'pg';
import { logger } from '../utils/logger.js';
import { WorkItemRepositoryBase, WorkItemDependencyData } from './WorkItemRepositoryBase.js';

/**
 * Handles operations related to Work Item dependencies.
 */
export class WorkItemRepositoryDependencies extends WorkItemRepositoryBase {
  constructor(pool: Pool) {
    super(pool);
  }

  /**
   * Finds dependencies for a given work item, optionally filtering by active status of the link and linked items.
   */
  public async findDependencies(
    workItemId: string,
    filter?: { isActive?: boolean; dependsOnActive?: boolean },
    client?: PoolClient
  ): Promise<WorkItemDependencyData[]> {
    if (!this.validateUuid(workItemId, 'findDependencies workItemId')) {
      return [];
    }
    const dbClient = this.getClientOrPool(client);

    let sql = `
            SELECT wid.* FROM work_item_dependencies wid
            LEFT JOIN work_items wi_dep_on ON wid.depends_on_work_item_id = wi_dep_on.work_item_id
            WHERE wid.work_item_id = $1 `; // Use LEFT JOIN to include deps even if target item is deleted/inactive
    const params: (string | boolean)[] = [workItemId];
    let paramIndex = 2;

    const linkIsActive = filter?.isActive === undefined ? true : filter.isActive;
    sql += ` AND wid.is_active = $${paramIndex++}`;
    params.push(linkIsActive);

    // Filter on the target item's status *if* the filter is provided
    if (filter?.dependsOnActive !== undefined) {
      sql += ` AND wi_dep_on.is_active = $${paramIndex++}`;
      params.push(filter.dependsOnActive);
    }

    try {
      const result = await dbClient.query(sql, params);
      logger.debug(
        `[WorkItemRepositoryDependencies] Found ${
          result.rows.length
        } dependencies for item ${workItemId} (link active: ${linkIsActive}, dependsOn active: ${
          filter?.dependsOnActive ?? 'any'
        }).`
      );
      return result.rows.map(this.mapRowToWorkItemDependencyData);
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryDependencies] Failed to find dependencies for item ${workItemId}:`, error);
      throw error;
    }
  }

  /**
   * Finds dependencies where the work_item_id is in a given list, optionally filtering by active status.
   */
  public async findDependenciesByItemList(
    workItemIds: string[],
    filter?: { isActive?: boolean; dependsOnActive?: boolean },
    client?: PoolClient
  ): Promise<WorkItemDependencyData[]> {
    if (
      workItemIds.length === 0 ||
      !workItemIds.every((id) => this.validateUuid(id, 'findDependenciesByItemList list item'))
    ) {
      logger.warn(`[WorkItemRepositoryDependencies] findDependenciesByItemList called with empty or invalid list.`);
      return [];
    }
    const dbClient = this.getClientOrPool(client);
    const placeholders = workItemIds.map((_, i) => `$${i + 1}`).join(',');

    let sql = `
            SELECT wid.* FROM work_item_dependencies wid
            LEFT JOIN work_items wi_dep_on ON wid.depends_on_work_item_id = wi_dep_on.work_item_id
            WHERE wid.work_item_id IN (${placeholders}) `;
    const params: (string | boolean)[] = [...workItemIds];
    let paramIndex = params.length + 1;

    const linkIsActive = filter?.isActive === undefined ? true : filter.isActive;
    sql += ` AND wid.is_active = $${paramIndex++}`;
    params.push(linkIsActive);

    if (filter?.dependsOnActive !== undefined) {
      sql += ` AND wi_dep_on.is_active = $${paramIndex++}`;
      params.push(filter.dependsOnActive);
    }

    try {
      const result = await dbClient.query(sql, params);
      logger.debug(
        `[WorkItemRepositoryDependencies] Found ${result.rows.length} dependencies for item list (count: ${
          workItemIds.length
        }, link active: ${linkIsActive}, dependsOn active: ${filter?.dependsOnActive ?? 'any'}).`
      );
      return result.rows.map(this.mapRowToWorkItemDependencyData);
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryDependencies] Failed to find dependencies for item list:`, error);
      throw error;
    }
  }

  /**
   * Finds items that depend on the given work item (dependents), optionally filtering by active status.
   */
  public async findDependents(
    dependsOnWorkItemId: string,
    filter?: { isActive?: boolean; dependentIsActive?: boolean },
    client?: PoolClient
  ): Promise<WorkItemDependencyData[]> {
    if (!this.validateUuid(dependsOnWorkItemId, 'findDependents dependsOnWorkItemId')) {
      return [];
    }
    const dbClient = this.getClientOrPool(client);

    let sql = `
            SELECT wid.* FROM work_item_dependencies wid
            LEFT JOIN work_items wi_dependent ON wid.work_item_id = wi_dependent.work_item_id
            WHERE wid.depends_on_work_item_id = $1 `;
    const params: (string | boolean)[] = [dependsOnWorkItemId];
    let paramIndex = 2;

    const linkIsActive = filter?.isActive === undefined ? true : filter.isActive;
    sql += ` AND wid.is_active = $${paramIndex++}`;
    params.push(linkIsActive);

    if (filter?.dependentIsActive !== undefined) {
      sql += ` AND wi_dependent.is_active = $${paramIndex++}`;
      params.push(filter.dependentIsActive);
    }

    try {
      const result = await dbClient.query(sql, params);
      logger.debug(
        `[WorkItemRepositoryDependencies] Found ${
          result.rows.length
        } dependents for item ${dependsOnWorkItemId} (link active: ${linkIsActive}, dependent active: ${
          filter?.dependentIsActive ?? 'any'
        }).`
      );
      return result.rows.map(this.mapRowToWorkItemDependencyData);
    } catch (error: unknown) {
      logger.error(
        `[WorkItemRepositoryDependencies] Failed to find dependents for item ${dependsOnWorkItemId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Finds dependency links where the depends_on_work_item_id is in a given list, optionally filtering by active status.
   */
  public async findDependentsByItemList(
    dependsOnWorkItemIds: string[],
    filter?: { isActive?: boolean; dependentIsActive?: boolean },
    client?: PoolClient
  ): Promise<WorkItemDependencyData[]> {
    if (
      dependsOnWorkItemIds.length === 0 ||
      !dependsOnWorkItemIds.every((id) => this.validateUuid(id, 'findDependentsByItemList list item'))
    ) {
      logger.warn(`[WorkItemRepositoryDependencies] findDependentsByItemList called with empty or invalid list.`);
      return [];
    }
    const dbClient = this.getClientOrPool(client);
    const placeholders = dependsOnWorkItemIds.map((_, i) => `$${i + 1}`).join(',');

    let sql = `
            SELECT wid.* FROM work_item_dependencies wid
            LEFT JOIN work_items wi_dependent ON wid.work_item_id = wi_dependent.work_item_id
            WHERE wid.depends_on_work_item_id IN (${placeholders}) `;
    const params: (string | boolean)[] = [...dependsOnWorkItemIds];
    let paramIndex = params.length + 1;

    const linkIsActive = filter?.isActive === undefined ? true : filter.isActive;
    sql += ` AND wid.is_active = $${paramIndex++}`;
    params.push(linkIsActive);

    if (filter?.dependentIsActive !== undefined) {
      sql += ` AND wi_dependent.is_active = $${paramIndex++}`;
      params.push(filter.dependentIsActive);
    }

    try {
      const result = await dbClient.query(sql, params);
      logger.debug(
        `[WorkItemRepositoryDependencies] Found ${result.rows.length} dependents for item list (count: ${
          dependsOnWorkItemIds.length
        }, link active: ${linkIsActive}, dependent active: ${filter?.dependentIsActive ?? 'any'}).`
      );
      return result.rows.map(this.mapRowToWorkItemDependencyData);
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryDependencies] Failed to find dependents for item list:`, error);
      throw error;
    }
  }

  /**
   * Finds dependency links by a list of their composite keys, optionally filtering by active status.
   */
  public async findDependenciesByCompositeKeys(
    compositeKeys: { work_item_id: string; depends_on_work_item_id: string }[],
    filter?: { isActive?: boolean },
    client?: PoolClient
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
    const dbClient = this.getClientOrPool(client);

    const whereClauses = compositeKeys
      .map((_, i) => `(work_item_id = $${i * 2 + 1} AND depends_on_work_item_id = $${i * 2 + 2})`)
      .join(' OR ');
    const params: (string | boolean)[] = compositeKeys.flatMap((key) => [
      key.work_item_id,
      key.depends_on_work_item_id,
    ]);
    let paramIndex = params.length + 1;

    let sql = ` SELECT * FROM work_item_dependencies WHERE ${whereClauses} `;

    const linkIsActive = filter?.isActive === undefined ? true : filter.isActive;
    sql += ` AND is_active = $${paramIndex++}`;
    params.push(linkIsActive);

    try {
      const result = await dbClient.query(sql, params);
      logger.debug(
        `[WorkItemRepositoryDependencies] Found ${result.rows.length} dependencies by composite keys (count: ${
          compositeKeys.length
        }, link active: ${linkIsActive}).`
      );
      return result.rows.map(this.mapRowToWorkItemDependencyData);
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryDependencies] Failed to find dependencies by composite keys:`, error);
      throw error;
    }
  }

  /**
   * Soft deletes dependency links by setting their is_active to FALSE.
   * Requires a client for transaction management.
   */
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
    const dbClient = this.getClient(client);

    const whereClauses = compositeKeys
      .map((_, i) => `(work_item_id = $${i * 2 + 1} AND depends_on_work_item_id = $${i * 2 + 2})`)
      .join(' OR ');
    const params: string[] = compositeKeys.flatMap((key) => [key.work_item_id, key.depends_on_work_item_id]);
    // Update only links that are currently active
    const sql = ` UPDATE work_item_dependencies SET is_active = FALSE WHERE (${whereClauses}) AND is_active = TRUE; `;

    try {
      const result = await dbClient.query(sql, params);
      logger.info(`[WorkItemRepositoryDependencies] Soft deleted ${result.rowCount ?? 0} dependency link(s).`);
      return result.rowCount ?? 0;
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryDependencies] Failed to soft delete dependency links:`, error);
      throw error;
    }
  }
}
