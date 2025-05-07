// src/repositories/WorkItemRepositoryCRUD.ts
import { Pool, PoolClient, QueryResult } from 'pg';
import { logger } from '../utils/logger.js';
import { NotFoundError } from '../utils/errors.js';
import { WorkItemRepositoryBase, WorkItemData, WorkItemDependencyData } from './WorkItemRepositoryBase.js';
import { validate as uuidValidate } from 'uuid';

/**
 * Handles CRUD (Create, Read - basic finders, Update, Delete) operations for Work Items.
 */
export class WorkItemRepositoryCRUD extends WorkItemRepositoryBase {
  protected pool: Pool;

  constructor(pool: Pool) {
    super(pool);
    this.pool = pool;
  }

  public async create(
    client: PoolClient,
    item: WorkItemData,
    dependencies?: WorkItemDependencyData[]
  ): Promise<WorkItemData> {
    const dbClient = this.getClient(client);
    logger.debug(`[WorkItemRepositoryCRUD] Creating item ${item.work_item_id} within transaction`);
    try {
      const insertItemSql = `
            INSERT INTO work_items (
            work_item_id, parent_work_item_id, name, shortname, description,
            status, priority, order_key, created_at, updated_at, due_date, is_active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *;
        `;
      const itemParams = [
        item.work_item_id,
        item.parent_work_item_id,
        item.name,
        item.shortname,
        item.description,
        item.status,
        item.priority,
        item.order_key,
        item.created_at,
        item.updated_at,
        item.due_date,
        item.is_active ?? true,
      ];
      const itemInsertResult = await dbClient.query(insertItemSql, itemParams);
      if (itemInsertResult.rowCount !== 1) {
        throw new Error(`Failed to insert work item ${item.work_item_id}.`);
      }
      const createdItem = this.mapRowToWorkItemData(itemInsertResult.rows[0]);

      if (dependencies && dependencies.length > 0) {
        logger.debug(
          `[WorkItemRepositoryCRUD] create: Inserting/Updating ${dependencies.length} dependencies for new item ${item.work_item_id}.`
        );
        const dependenciesWithCorrectId = dependencies.map((dep) => ({
          ...dep,
          work_item_id: createdItem.work_item_id,
        }));
        await this.addOrUpdateDependencies(client, createdItem.work_item_id, dependenciesWithCorrectId);
        logger.debug(
          `[WorkItemRepositoryCRUD] create: Finished processing dependencies for new item ${item.work_item_id}.`
        );
      }
      logger.info(
        `[WorkItemRepositoryCRUD] Created work item ${createdItem.work_item_id} with ${dependencies?.length ?? 0} dependencies processed.`
      );
      return createdItem;
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryCRUD] Error creating item ${item.work_item_id} in transaction:`, error);
      throw error;
    }
  }

  public async findById(workItemId: string, filter?: { isActive?: boolean }): Promise<WorkItemData | undefined> {
    logger.debug(`[WorkItemRepositoryCRUD] findById called for ID: ${workItemId} with filter:`, filter);
    if (!uuidValidate(workItemId)) {
      logger.warn(`[WorkItemRepositoryCRUD] findById: Invalid UUID format for workItemId: ${workItemId}`);
      return undefined;
    }
    const dbClient = this.pool;
    let sql = ` SELECT * FROM work_items WHERE work_item_id = $1 `;
    const params: (string | boolean)[] = [workItemId];
    let paramIndex = 2;
    const isActiveFilter = filter?.isActive === false ? false : filter?.isActive === undefined ? undefined : true;

    if (isActiveFilter !== undefined) {
      sql += ` AND is_active = $${paramIndex++}`;
      params.push(isActiveFilter);
    }

    try {
      const result = await dbClient.query(sql, params);
      logger.debug(
        `[WorkItemRepositoryCRUD] findById query for ID ${workItemId} (isActive filter: ${isActiveFilter ?? 'any'}) executed. Rows found: ${result.rows.length}`
      );
      if (result.rows.length === 0) {
        logger.debug(
          `[WorkItemRepositoryCRUD] Work item ${workItemId} not found or filtered out (isActive filter: ${isActiveFilter ?? 'any'}).`
        );
        return undefined;
      }
      const foundItem = this.mapRowToWorkItemData(result.rows[0]);
      logger.debug(`[WorkItemRepositoryCRUD] Found work item ${workItemId}. isActive: ${foundItem.is_active}`);
      return foundItem;
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryCRUD] Failed to find work item ${workItemId}:`, error);
      throw error;
    }
  }

  public async findByIds(workItemIds: string[], filter?: { isActive?: boolean }): Promise<WorkItemData[]> {
    if (workItemIds.length === 0 || !workItemIds.every((id) => uuidValidate(id))) {
      logger.warn('[WorkItemRepositoryCRUD] findByIds called with empty or invalid list.');
      return [];
    }
    const dbClient = this.pool;
    const placeholders = workItemIds.map((_, i) => `$${i + 1}`).join(',');
    let sql = ` SELECT * FROM work_items WHERE work_item_id IN (${placeholders}) `;
    const params: (string | boolean)[] = [...workItemIds];
    let paramIndex = params.length + 1;

    const isActiveFilter = filter?.isActive === false ? false : filter?.isActive === undefined ? undefined : true;

    if (isActiveFilter !== undefined) {
      sql += ` AND is_active = $${paramIndex++}`;
      params.push(isActiveFilter);
    }

    try {
      const result = await dbClient.query(sql, params);
      logger.debug(
        `[WorkItemRepositoryCRUD] Found ${result.rows.length} work items by IDs (count: ${workItemIds.length}, isActive filter: ${isActiveFilter ?? 'any'}).`
      );
      return result.rows.map(this.mapRowToWorkItemData);
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryCRUD] Failed to find work items by IDs:`, error);
      throw error;
    }
  }

  public async findAll(filter?: { isActive?: boolean; status?: WorkItemData['status'] }): Promise<WorkItemData[]> {
    const dbClient = this.pool;
    let sql = `SELECT * FROM work_items`;
    const params: (string | boolean)[] = [];
    let paramIndex = 1;
    const whereClauses: string[] = [];

    const isActiveFilter = filter?.isActive === false ? false : filter?.isActive === undefined ? undefined : true;
    if (isActiveFilter !== undefined) {
      whereClauses.push(`is_active = $${paramIndex++}`);
      params.push(isActiveFilter);
    }

    if (filter?.status) {
      whereClauses.push(`status = $${paramIndex++}`);
      params.push(filter.status);
    }
    if (whereClauses.length > 0) sql += ' WHERE ' + whereClauses.join(' AND ');
    sql += ' ORDER BY order_key ASC, created_at ASC;';
    try {
      const result = await dbClient.query(sql, params);
      logger.debug(
        `[WorkItemRepositoryCRUD] Found ${result.rows.length} work items (all, active filter: ${isActiveFilter ?? 'any'}, status: ${filter?.status ?? 'any'}).`
      );
      return result.rows.map(this.mapRowToWorkItemData);
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryCRUD] Failed to find all work items with filter:`, { filter, error });
      throw error;
    }
  }

  /**
   * [DEPRECATED - Use granular update methods or updateFields instead]
   */
  public async update(
    client: PoolClient,
    workItemId: string,
    updatePayload: Partial<Omit<WorkItemData, 'work_item_id' | 'created_at' | 'updated_at' | 'is_active'>>,
    newDependenciesInput?: WorkItemDependencyData[]
  ): Promise<WorkItemData> {
    if (!uuidValidate(workItemId)) {
      throw new Error(`Invalid UUID format for workItemId: ${workItemId}`);
    }
    const dbClient = this.getClient(client);
    logger.debug(
      `[WorkItemRepositoryCRUD - DEPRECATED] Updating work item ${workItemId} in transaction (full dependency replacement)`
    );
    try {
      const now = new Date().toISOString();
      const setClauses: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;
      for (const key in updatePayload) {
        if (Object.prototype.hasOwnProperty.call(updatePayload, key)) {
          if (key === 'is_active' || key === 'created_at') continue;
          const typedKey = key as keyof typeof updatePayload;
          const value = updatePayload[typedKey];
          setClauses.push(`"${typedKey}" = $${paramIndex++}`);
          params.push(value === undefined ? null : value);
        }
      }
      let updatedItemResult: WorkItemData;
      if (setClauses.length > 0) {
        setClauses.push(`updated_at = $${paramIndex++}`);
        params.push(now);
        const workItemIdParamIndex = paramIndex++;
        params.push(workItemId);
        const updateSql = ` UPDATE work_items SET ${setClauses.join(', ')} WHERE work_item_id = $${workItemIdParamIndex} AND is_active = TRUE RETURNING *; `;
        logger.debug(
          `[WorkItemRepositoryCRUD DEBUG - DEPRECATED] Executing core update SQL: ${updateSql} PARAMS: ${JSON.stringify(params)}`
        );
        const updateResult = await dbClient.query(updateSql, params);
        if (updateResult.rowCount === 0)
          throw new NotFoundError(`Active work item ${workItemId} not found for update.`);
        updatedItemResult = this.mapRowToWorkItemData(updateResult.rows[0]);
        logger.debug(
          `[WorkItemRepositoryCRUD - DEPRECATED] Updated work item ${workItemId} fields. Row count: ${updateResult.rowCount}`
        );
      } else {
        logger.debug(
          `[WorkItemRepositoryCRUD - DEPRECATED] No core fields to update for ${workItemId}. Fetching current data.`
        );
        const currentDataResult = await dbClient.query(
          'SELECT * FROM work_items WHERE work_item_id = $1 AND is_active = TRUE',
          [workItemId]
        );
        if (currentDataResult.rowCount === 0) throw new NotFoundError(`Active work item ${workItemId} not found.`);
        updatedItemResult = this.mapRowToWorkItemData(currentDataResult.rows[0]);
      }
      if (newDependenciesInput !== undefined) {
        logger.debug(
          `[WorkItemRepositoryCRUD - DEPRECATED] Updating dependencies for item ${workItemId} (Full Replacement).`
        );
        const currentDepsResult = await dbClient.query('SELECT * FROM work_item_dependencies WHERE work_item_id = $1', [
          workItemId,
        ]);
        const currentDepsMap = new Map(
          currentDepsResult.rows.map((row) => [row.depends_on_work_item_id, this.mapRowToWorkItemDependencyData(row)])
        );
        const desiredDepsMap = new Map(
          newDependenciesInput.map((dep) => [
            dep.depends_on_work_item_id,
            { ...dep, work_item_id: workItemId, is_active: true },
          ])
        );
        const depsToInsertOrUpdate: WorkItemDependencyData[] = [];
        const depsToDeactivate: string[] = [];
        for (const [desiredTargetId, desiredDep] of desiredDepsMap.entries()) {
          if (!uuidValidate(desiredTargetId)) continue;
          const currentDep = currentDepsMap.get(desiredTargetId);
          if (!currentDep || !currentDep.is_active || currentDep.dependency_type !== desiredDep.dependency_type) {
            depsToInsertOrUpdate.push(desiredDep);
          }
        }
        for (const [currentTargetId, currentDep] of currentDepsMap.entries()) {
          if (currentDep.is_active && !desiredDepsMap.has(currentTargetId)) {
            depsToDeactivate.push(currentTargetId);
          }
        }
        if (depsToDeactivate.length > 0) {
          logger.debug(
            `[WorkItemRepositoryCRUD - DEPRECATED] Deactivating ${depsToDeactivate.length} dependencies for ${workItemId}.`
          );
          const placeholders = depsToDeactivate.map((_, i) => `$${i + 2}`).join(',');
          const deactivateSql = `UPDATE work_item_dependencies SET is_active = FALSE WHERE work_item_id = $1 AND depends_on_work_item_id IN (${placeholders}) AND is_active = TRUE;`;
          await dbClient.query(deactivateSql, [workItemId, ...depsToDeactivate]);
        }
        if (depsToInsertOrUpdate.length > 0) {
          logger.debug(
            `[WorkItemRepositoryCRUD - DEPRECATED] Upserting ${depsToInsertOrUpdate.length} dependencies for ${workItemId}.`
          );
          await this.addOrUpdateDependencies(client, workItemId, depsToInsertOrUpdate);
        }
        logger.debug(
          `[WorkItemRepositoryCRUD - DEPRECATED] Finished updating dependencies for item ${workItemId} (Full Replacement).`
        );
      }
      logger.info(`[WorkItemRepositoryCRUD - DEPRECATED] Successfully processed update for item ${workItemId}.`);
      return updatedItemResult;
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryCRUD - DEPRECATED] Failed transaction for updating item ${workItemId}:`, error);
      throw error;
    }
  }

  /**
   * Soft deletes one or more work items by setting their is_active to FALSE.
   */
  public async softDelete(workItemIds: string[], client: PoolClient): Promise<number> {
    if (workItemIds.length === 0 || !workItemIds.every((id) => uuidValidate(id))) {
      logger.warn('[WorkItemRepositoryCRUD] softDelete called with empty or invalid list.');
      return 0;
    }
    const dbClient = this.getClient(client);
    const now = new Date().toISOString();
    const placeholders = workItemIds.map((_, i) => `$${i + 2}`).join(',');
    const sql = ` UPDATE work_items SET is_active = FALSE, updated_at = $1 WHERE work_item_id IN (${placeholders}) AND is_active = TRUE; `;
    const params = [now, ...workItemIds];
    logger.debug(`[WorkItemRepositoryCRUD DIAG] Executing softDelete SQL: ${sql} PARAMS: ${JSON.stringify(params)}`);
    try {
      const result = await dbClient.query(sql, params);
      logger.debug(`[WorkItemRepositoryCRUD DIAG] softDelete result rowCount: ${result.rowCount}`);
      logger.info(`[WorkItemRepositoryCRUD] Soft deleted ${result.rowCount ?? 0} work item(s).`);
      return result.rowCount ?? 0;
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryCRUD] Failed to soft delete work items:`, error);
      throw error;
    }
  }

  /**
   * Adds or updates multiple dependency links for a given work item using ON CONFLICT.
   */
  public async addOrUpdateDependencies(
    client: PoolClient,
    workItemId: string,
    dependencies: WorkItemDependencyData[]
  ): Promise<number> {
    if (dependencies.length === 0) {
      logger.debug(`[WorkItemRepositoryCRUD] addOrUpdateDependencies called for ${workItemId} with empty list.`);
      return 0;
    }
    const dbClient = this.getClient(client);
    logger.debug(`[WorkItemRepositoryCRUD] Inserting/Updating ${dependencies.length} dependencies for ${workItemId}.`);
    const insertUpdateSql = ` INSERT INTO work_item_dependencies (work_item_id, depends_on_work_item_id, dependency_type, is_active) VALUES ($1, $2, $3, TRUE) ON CONFLICT (work_item_id, depends_on_work_item_id) DO UPDATE SET dependency_type = EXCLUDED.dependency_type, is_active = TRUE RETURNING work_item_id; `;
    let totalAffectedCount = 0;
    try {
      for (const dep of dependencies) {
        if (!uuidValidate(dep.work_item_id) || !uuidValidate(dep.depends_on_work_item_id)) {
          logger.warn(
            `[WorkItemRepositoryCRUD] addOrUpdateDependencies: Skipping dependency with invalid UUIDs: ${dep.work_item_id}, ${dep.depends_on_work_item_id}`
          );
          continue;
        }
        if (dep.work_item_id === dep.depends_on_work_item_id) {
          logger.warn(
            `[WorkItemRepositoryCRUD] addOrUpdateDependencies: Skipping self-dependency for item ${dep.work_item_id}`
          );
          continue;
        }
        logger.debug(
          `[WorkItemRepositoryCRUD DEBUG] Upserting dependency ${dep.work_item_id} -> ${dep.depends_on_work_item_id}`
        );
        const result: QueryResult = await dbClient.query(insertUpdateSql, [
          dep.work_item_id,
          dep.depends_on_work_item_id,
          dep.dependency_type ?? 'finish-to-start',
        ]);
        totalAffectedCount += result.rowCount ?? 0;
      }
      logger.debug(
        `[WorkItemRepositoryCRUD] Total rows affected by addOrUpdateDependencies for ${workItemId}: ${totalAffectedCount}.`
      );
      return totalAffectedCount;
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryCRUD] Failed during addOrUpdateDependencies for item ${workItemId}:`, error);
      throw error;
    }
  }

  /**
   * Updates specified fields for a work item. Does not handle dependencies.
   * Sets updated_at automatically. Only updates active items.
   */
  public async updateFields(
    client: PoolClient,
    workItemId: string,
    // Corrected Omit: Removed 'shortname' and 'order_key' from OMITTED list
    payload: Partial<
      Omit<WorkItemData, 'work_item_id' | 'parent_work_item_id' | 'created_at' | 'is_active' | 'updated_at'>
    >
  ): Promise<WorkItemData | null> {
    const dbClient = this.getClient(client);
    const setClauses: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    logger.debug(`[WorkItemRepositoryCRUD] Updating specific fields for work item ${workItemId}:`, payload);

    // Corrected allowedFields to reflect what this method can update
    const allowedFields: (keyof typeof payload)[] = [
      'name',
      'description',
      'status',
      'priority',
      'due_date',
      'shortname',
      'order_key',
    ];

    for (const key of allowedFields) {
      // Check if the payload actually has this property and it's not undefined
      if (Object.prototype.hasOwnProperty.call(payload, key) && payload[key as keyof typeof payload] !== undefined) {
        const typedKey = key as keyof typeof payload;
        const value = payload[typedKey];
        setClauses.push(`"${typedKey}" = $${paramIndex++}`);
        params.push(value); // Value is guaranteed not undefined here
      }
    }

    if (setClauses.length === 0) {
      logger.warn(
        `[WorkItemRepositoryCRUD] updateFields called for ${workItemId} with no updatable fields in payload.`
      );
      const currentItemResult = await dbClient.query(
        'SELECT * FROM work_items WHERE work_item_id = $1 AND is_active = TRUE',
        [workItemId]
      );
      return currentItemResult.rows.length > 0 ? this.mapRowToWorkItemData(currentItemResult.rows[0]) : null;
    }

    setClauses.push(`updated_at = $${paramIndex++}`);
    params.push(new Date().toISOString());

    const workItemIdParamIndex = paramIndex++;
    params.push(workItemId);

    const updateSql = `
          UPDATE work_items
          SET ${setClauses.join(', ')}
          WHERE work_item_id = $${workItemIdParamIndex} AND is_active = TRUE
          RETURNING *;
      `;

    try {
      logger.debug(
        `[WorkItemRepositoryCRUD DEBUG] Executing updateFields SQL: ${updateSql} PARAMS: ${JSON.stringify(params)}`
      );
      const result = await dbClient.query(updateSql, params);
      if (result.rowCount === 0) {
        logger.warn(
          `[WorkItemRepositoryCRUD] updateFields: Active work item ${workItemId} not found or no rows updated.`
        );
        return null;
      }
      logger.info(`[WorkItemRepositoryCRUD] Updated specific fields for work item ${workItemId}.`);
      return this.mapRowToWorkItemData(result.rows[0]);
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryCRUD] Failed to update fields for work item ${workItemId}:`, error);
      throw error;
    }
  }
}
