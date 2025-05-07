// src/repositories/WorkItemRepositoryCRUD.ts
import { type Pool, type PoolClient, type QueryResult } from 'pg';
import { logger } from '../utils/logger.js';
import { NotFoundError } from '../utils/errors.js';
import { WorkItemRepositoryBase, type WorkItemData, type WorkItemDependencyData } from './WorkItemRepositoryBase.js';
import { validate as uuidValidate } from 'uuid';

export class WorkItemRepositoryCRUD extends WorkItemRepositoryBase {
  constructor(pool: Pool) {
    super(pool);
  }

  public async create(
    client: PoolClient, // Create always requires a client for transaction
    item: WorkItemData,
    dependencies?: WorkItemDependencyData[]
  ): Promise<WorkItemData> {
    const dbClient = this.getClient(client);
    logger.debug(`[WorkItemRepositoryCRUD] Creating item ${item.work_item_id} within transaction`);
    try {
      const insertItemSql = `
            INSERT INTO work_items (
            work_item_id, parent_work_item_id, name, description,
            status, priority, order_key, created_at, updated_at, due_date, is_active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) -- Removed shortname ($4)
            RETURNING *;
        `;
      const itemParams = [
        item.work_item_id,
        item.parent_work_item_id,
        item.name,
        // item.shortname, // REMOVED shortname
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
        await this.addOrUpdateDependencies(
          client, // Pass client
          createdItem.work_item_id,
          dependenciesWithCorrectId
        );
        logger.debug(
          `[WorkItemRepositoryCRUD] create: Finished processing dependencies for new item ${item.work_item_id}.`
        );
      }
      logger.info(
        `[WorkItemRepositoryCRUD] Created work item ${
          createdItem.work_item_id
        } with ${dependencies?.length ?? 0} dependencies processed.`
      );
      return createdItem;
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryCRUD] Error creating item ${item.work_item_id} in transaction:`, error);
      throw error;
    }
  }

  public async findById(
    workItemId: string,
    filter?: { isActive?: boolean },
    client?: PoolClient | Pool // Made client optional
  ): Promise<WorkItemData | undefined> {
    if (!this.validateUuid(workItemId, 'findById workItemId')) {
      return undefined;
    }
    const dbClient = client || this.pool; // Use provided client or default to pool
    let sql = ` SELECT * FROM work_items WHERE work_item_id = $1 `;
    const params: (string | boolean)[] = [workItemId];
    let paramIndex = 2;

    if (filter?.isActive === true) {
      sql += ` AND is_active = $${paramIndex++}`;
      params.push(true);
    } else if (filter?.isActive === false) {
      sql += ` AND is_active = $${paramIndex++}`;
      params.push(false);
    }
    // If filter.isActive is undefined, no clause for is_active is added

    try {
      const result = await dbClient.query(sql, params);
      if (result.rows.length === 0) return undefined;
      return this.mapRowToWorkItemData(result.rows[0]);
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryCRUD] Failed to find work item ${workItemId}:`, error);
      throw error;
    }
  }

  public async findByIds(
    workItemIds: string[],
    filter?: { isActive?: boolean },
    client?: PoolClient | Pool // Made client optional
  ): Promise<WorkItemData[]> {
    if (workItemIds.length === 0 || !workItemIds.every((id) => this.validateUuid(id, 'findByIds list item'))) {
      return [];
    }
    const dbClient = client || this.pool; // Use provided client or default to pool
    const placeholders = workItemIds.map((_, i) => `$${i + 1}`).join(',');
    let sql = ` SELECT * FROM work_items WHERE work_item_id IN (${placeholders}) `;
    const params: (string | boolean)[] = [...workItemIds];
    let paramIndex = params.length + 1;

    if (filter?.isActive === true) {
      sql += ` AND is_active = $${paramIndex++}`;
      params.push(true);
    } else if (filter?.isActive === false) {
      sql += ` AND is_active = $${paramIndex++}`;
      params.push(false);
    }

    try {
      const result = await dbClient.query(sql, params);
      return result.rows.map(this.mapRowToWorkItemData);
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryCRUD] Failed to find work items by IDs:`, error);
      throw error;
    }
  }

  public async findAll(
    filter?: { isActive?: boolean; status?: WorkItemData['status'] },
    client?: PoolClient | Pool // Made client optional
  ): Promise<WorkItemData[]> {
    const dbClient = client || this.pool; // Use provided client or default to pool
    let sql = `SELECT * FROM work_items`;
    const params: (string | boolean)[] = [];
    let paramIndex = 1;
    const whereClauses: string[] = [];

    if (filter?.isActive === true) {
      whereClauses.push(`is_active = $${paramIndex++}`);
      params.push(true);
    } else if (filter?.isActive === false) {
      whereClauses.push(`is_active = $${paramIndex++}`);
      params.push(false);
    }

    if (filter?.status) {
      whereClauses.push(`status = $${paramIndex++}`);
      params.push(filter.status);
    }
    if (whereClauses.length > 0) sql += ' WHERE ' + whereClauses.join(' AND ');
    sql += ' ORDER BY order_key ASC, created_at ASC;';
    try {
      const result = await dbClient.query(sql, params);
      return result.rows.map(this.mapRowToWorkItemData);
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryCRUD] Failed to find all work items with filter:`, { filter, error });
      throw error;
    }
  }

  /**
   * @deprecated Use granular update methods or updateFields instead
   * Updates a work item, potentially replacing all dependencies.
   */
  public async update(
    client: PoolClient, // Requires client
    workItemId: string,
    updatePayload: Partial<Omit<WorkItemData, 'work_item_id' | 'created_at' | 'updated_at' | 'is_active'>>,
    newDependenciesInput?: WorkItemDependencyData[] // If provided, replaces *all* existing dependencies
  ): Promise<WorkItemData> {
    if (!uuidValidate(workItemId)) {
      throw new Error(`Invalid UUID format for workItemId: ${workItemId}`);
    }
    const dbClient = this.getClient(client);
    logger.debug(
      `[WorkItemRepositoryCRUD - DEPRECATED] Updating work item ${workItemId} in transaction (dependency replacement: ${
        newDependenciesInput !== undefined
      })`
    );
    try {
      const now = new Date().toISOString();
      const setClauses: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;
      for (const key in updatePayload) {
        if (Object.prototype.hasOwnProperty.call(updatePayload, key)) {
          // Ensure shortname is not included in update payload
          if (key === 'is_active' || key === 'created_at' || key === 'work_item_id' || key === 'shortname') continue;
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
        const updateSql = ` UPDATE work_items SET ${setClauses.join(
          ', '
        )} WHERE work_item_id = $${workItemIdParamIndex} AND is_active = TRUE RETURNING *; `;
        const updateResult = await dbClient.query(updateSql, params);
        if (updateResult.rowCount === 0)
          throw new NotFoundError(`Active work item ${workItemId} not found for update.`);
        updatedItemResult = this.mapRowToWorkItemData(updateResult.rows[0]);
      } else {
        const currentDataResult = await dbClient.query(
          'SELECT * FROM work_items WHERE work_item_id = $1 AND is_active = TRUE',
          [workItemId]
        );
        if (currentDataResult.rowCount === 0) throw new NotFoundError(`Active work item ${workItemId} not found.`);
        updatedItemResult = this.mapRowToWorkItemData(currentDataResult.rows[0]);
      }

      // --- START: Dependency Replacement Logic ---
      if (newDependenciesInput !== undefined) {
        // 1. Deactivate *all* existing active dependencies for this item
        const deactivateSql = `UPDATE work_item_dependencies SET is_active = FALSE WHERE work_item_id = $1 AND is_active = TRUE;`;
        const deactivateResult = await dbClient.query(deactivateSql, [workItemId]);
        logger.debug(
          `[WorkItemRepositoryCRUD - update] Deactivated ${
            deactivateResult.rowCount ?? 0
          } existing active dependencies for ${workItemId}.`
        );

        // 2. Add/Update the new set of dependencies
        if (newDependenciesInput.length > 0) {
          logger.debug(
            `[WorkItemRepositoryCRUD - update] Adding/Updating ${newDependenciesInput.length} dependencies.`
          );
          await this.addOrUpdateDependencies(client, workItemId, newDependenciesInput);
        } else {
          logger.debug(
            `[WorkItemRepositoryCRUD - update] No new dependencies provided, all existing were deactivated.`
          );
        }
      }
      // --- END: Dependency Replacement Logic ---

      return updatedItemResult;
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryCRUD - DEPRECATED] Failed transaction for updating item ${workItemId}:`, error);
      throw error;
    }
  }

  public async updateFields(
    client: PoolClient, // Requires client
    workItemId: string,
    payload: Partial<
      Omit<WorkItemData, 'work_item_id' | 'created_at' | 'is_active' | 'updated_at' | 'shortname'> // Exclude shortname
    >
  ): Promise<WorkItemData | null> {
    // ... (rest of updateFields method is likely okay as it already uses client)
    const dbClient = this.getClient(client);
    const setClauses: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    const allowedFields: (keyof WorkItemData)[] = [
      // Explicitly list allowed fields (shortname REMOVED)
      'parent_work_item_id',
      'name',
      'description',
      'status',
      'priority',
      'order_key',
      'due_date',
    ];

    for (const key of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(payload, key)) {
        // Type assertion to satisfy TypeScript
        const typedKey = key as keyof typeof payload;
        const value = payload[typedKey];
        // Allow null to be set explicitly for nullable fields
        if (value !== undefined) {
          setClauses.push(`"${key}" = $${paramIndex++}`);
          params.push(value);
        } else if (
          key === 'parent_work_item_id' ||
          key === 'description' ||
          key === 'due_date' ||
          // key === 'shortname' || // REMOVED shortname
          key === 'order_key'
        ) {
          // These fields can be explicitly set to null
          setClauses.push(`"${key}" = $${paramIndex++}`);
          params.push(null);
        }
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
      const result = await dbClient.query(updateSql, params);
      if (result.rowCount === 0) {
        logger.warn(
          `[WorkItemRepositoryCRUD] updateFields: Active work item ${workItemId} not found or no rows updated.`
        );
        return null;
      }
      return this.mapRowToWorkItemData(result.rows[0]);
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryCRUD] Failed to update fields for work item ${workItemId}:`, error);
      throw error;
    }
  }

  public async softDelete(
    workItemIds: string[],
    client: PoolClient // Requires client
  ): Promise<number> {
    // ... (rest of softDelete method is likely okay as it already uses client)
    if (workItemIds.length === 0 || !workItemIds.every((id) => this.validateUuid(id, 'softDelete list item'))) {
      logger.warn('[WorkItemRepositoryCRUD] softDelete called with empty or invalid list.');
      return 0;
    }
    const dbClient = this.getClient(client);
    const now = new Date().toISOString();
    const placeholders = workItemIds.map((_, i) => `$${i + 2}`).join(',');
    const sql = ` UPDATE work_items SET is_active = FALSE, updated_at = $1 WHERE work_item_id IN (${placeholders}) AND is_active = TRUE; `;
    const params = [now, ...workItemIds];
    try {
      const result = await dbClient.query(sql, params);
      return result.rowCount ?? 0;
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryCRUD] Failed to soft delete work items:`, error);
      throw error;
    }
  }

  public async addOrUpdateDependencies(
    client: PoolClient, // Requires client
    workItemId: string,
    dependencies: WorkItemDependencyData[]
  ): Promise<number> {
    // ... (rest of addOrUpdateDependencies method is likely okay as it already uses client)
    if (dependencies.length === 0) {
      return 0;
    }
    const dbClient = this.getClient(client);
    const insertUpdateSql = ` INSERT INTO work_item_dependencies (work_item_id, depends_on_work_item_id, dependency_type, is_active) VALUES ($1, $2, $3, TRUE) ON CONFLICT (work_item_id, depends_on_work_item_id) DO UPDATE SET dependency_type = EXCLUDED.dependency_type, is_active = TRUE RETURNING work_item_id; `;
    let totalAffectedCount = 0;
    try {
      for (const dep of dependencies) {
        if (
          !this.validateUuid(dep.work_item_id, 'addOrUpdateDependencies dep.work_item_id') ||
          !this.validateUuid(dep.depends_on_work_item_id, 'addOrUpdateDependencies dep.depends_on_work_item_id')
        ) {
          continue;
        }
        if (dep.work_item_id === dep.depends_on_work_item_id) {
          continue;
        }
        const result: QueryResult = await dbClient.query(insertUpdateSql, [
          dep.work_item_id,
          dep.depends_on_work_item_id,
          dep.dependency_type ?? 'finish-to-start',
        ]);
        totalAffectedCount += result.rowCount ?? 0;
      }
      return totalAffectedCount;
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryCRUD] Failed during addOrUpdateDependencies for item ${workItemId}:`, error);
      throw error;
    }
  }
}
