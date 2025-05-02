// src/repositories/WorkItemRepositoryCRUD.ts
import { Pool, PoolClient } from 'pg';
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

  /**
   * Creates a new work item and its dependencies.
   * Requires a client for transaction management.
   */
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
        item.is_active ?? true, // Default is_active to true if not provided
      ];
      const itemInsertResult = await dbClient.query(insertItemSql, itemParams);

      if (itemInsertResult.rowCount !== 1) {
        throw new Error(`Failed to insert work item ${item.work_item_id}.`);
      }
      const createdItem = this.mapRowToWorkItemData(itemInsertResult.rows[0]);

      if (dependencies && dependencies.length > 0) {
        logger.debug(
          `[WorkItemRepositoryCRUD] create: Inserting ${dependencies.length} dependencies for item ${item.work_item_id}.`
        );
        // Corrected INSERT query and parameter passing for dependencies
        const insertDepSql = `
          INSERT INTO work_item_dependencies (work_item_id, depends_on_work_item_id, dependency_type, is_active)
          VALUES ($1, $2, $3, $4) -- Now expects 4 parameters
          ON CONFLICT(work_item_id, depends_on_work_item_id) DO NOTHING;
        `;
        for (const dep of dependencies) {
          if (!uuidValidate(dep.work_item_id) || !uuidValidate(dep.depends_on_work_item_id)) {
            logger.warn(
              `[WorkItemRepositoryCRUD] create: Invalid UUID format in dependency for item ${item.work_item_id}: ${dep.work_item_id}, ${dep.depends_on_work_item_id}. Skipping.`
            );
            continue; // Skip invalid dependency for now
          }
          logger.debug(
            `[WorkItemRepositoryCRUD] create: Inserting dependency ${dep.work_item_id} -> ${dep.depends_on_work_item_id}`
          );
          // Explicitly pass all four values for the four placeholders
          await dbClient.query(insertDepSql, [
            item.work_item_id, // Should be the new work item's ID
            dep.depends_on_work_item_id,
            dep.dependency_type ?? 'finish-to-start', // Default type if not provided
            dep.is_active ?? true, // Default is_active to true if not provided
          ]);
        }
        logger.debug(`[WorkItemRepositoryCRUD] create: Finished inserting dependencies for item ${item.work_item_id}.`);
      }

      logger.info(
        `[WorkItemRepositoryCRUD] Created work item ${createdItem.work_item_id} with ${dependencies?.length ?? 0} dependencies.`
      );
      return createdItem;
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryCRUD] Error creating item ${item.work_item_id} in transaction:`, error);
      throw error;
    }
  }

  /**
   * Finds a single work item by its ID, optionally filtering by active status.
   */
  public async findById(
    workItemId: string,
    filter?: { isActive?: boolean },
    client?: PoolClient
  ): Promise<WorkItemData | undefined> {
    logger.debug(`[WorkItemRepositoryCRUD] findById called for ID: ${workItemId} with filter:`, filter);
    if (!uuidValidate(workItemId)) {
      logger.warn(`[WorkItemRepositoryCRUD] findById: Invalid UUID format for workItemId: ${workItemId}`);
      return undefined;
    }
    const dbClient = this.getClientOrPool(client);

    let sql = ` SELECT * FROM work_items WHERE work_item_id = $1 `;
    const params: (string | boolean)[] = [workItemId];
    let paramIndex = 2;

    const isActiveFilter = filter?.isActive === false ? false : true;
    sql += ` AND is_active = $${paramIndex++}`;
    params.push(isActiveFilter);

    try {
      const result = await dbClient.query(sql, params);
      logger.debug(
        `[WorkItemRepositoryCRUD] findById query for ID ${workItemId} (isActive: ${isActiveFilter}) executed. Rows found: ${result.rows.length}`
      );
      if (result.rows.length === 0) {
        logger.debug(
          `[WorkItemRepositoryCRUD] Work item ${workItemId} not found or filtered out (isActive filter: ${isActiveFilter}).`
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

  /**
   * Finds multiple work items by their IDs, optionally filtering by active status.
   */
  public async findByIds(
    workItemIds: string[],
    filter?: { isActive?: boolean },
    client?: PoolClient
  ): Promise<WorkItemData[]> {
    if (workItemIds.length === 0 || !workItemIds.every((id) => uuidValidate(id))) {
      // Used uuidValidate
      logger.warn('[WorkItemRepositoryCRUD] findByIds called with empty or invalid list.');
      return [];
    }
    const dbClient = this.getClientOrPool(client);
    const placeholders = workItemIds.map((_, i) => `$${i + 1}`).join(',');

    let sql = ` SELECT * FROM work_items WHERE work_item_id IN (${placeholders}) `;
    const params: (string | boolean)[] = [...workItemIds];
    let paramIndex = params.length + 1;

    // Default to active if filter.isActive is not explicitly false
    const isActiveFilter = filter?.isActive === false ? false : true;
    sql += ` AND is_active = $${paramIndex++}`;
    params.push(isActiveFilter);

    try {
      const result = await dbClient.query(sql, params);
      logger.debug(
        `[WorkItemRepositoryCRUD] Found ${result.rows.length} work items by IDs (count: ${workItemIds.length}, isActive: ${isActiveFilter}).`
      );
      return result.rows.map(this.mapRowToWorkItemData);
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryCRUD] Failed to find work items by IDs:`, error);
      throw error;
    }
  }

  /**
   * Finds all work items, optionally filtering by active status and/or status.
   */
  public async findAll(
    filter?: { isActive?: boolean; status?: WorkItemData['status'] },
    client?: PoolClient
  ): Promise<WorkItemData[]> {
    const dbClient = this.getClientOrPool(client);

    let sql = `SELECT * FROM work_items`;
    const params: (string | boolean)[] = [];
    let paramIndex = 1;
    const whereClauses: string[] = [];

    // Default to active if isActive is undefined
    const isActiveFilter = filter?.isActive === undefined ? true : filter.isActive;
    whereClauses.push(`is_active = $${paramIndex++}`);
    params.push(isActiveFilter);

    // Add status filter if provided
    if (filter?.status) {
      whereClauses.push(`status = $${paramIndex++}`);
      params.push(filter.status);
    }

    if (whereClauses.length > 0) sql += ' WHERE ' + whereClauses.join(' AND ');
    sql += ' ORDER BY order_key ASC, created_at ASC;'; // Consistent ordering

    try {
      const result = await dbClient.query(sql, params);
      logger.debug(
        `[WorkItemRepositoryCRUD] Found ${result.rows.length} work items (all, active: ${isActiveFilter}, status: ${filter?.status ?? 'any'}).`
      );
      return result.rows.map(this.mapRowToWorkItemData);
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryCRUD] Failed to find all work items with filter:`, { filter, error });
      throw error;
    }
  }

  /**
   * Updates a work item and optionally its dependencies.
   * Requires a client for transaction management.
   */
  public async update(
    client: PoolClient,
    workItemId: string,
    updatePayload: Partial<Omit<WorkItemData, 'work_item_id' | 'created_at' | 'updated_at' | 'is_active'>>,
    newDependenciesInput?: WorkItemDependencyData[] // Represents the *desired* state of outgoing dependencies
  ): Promise<WorkItemData> {
    if (!uuidValidate(workItemId)) {
      // Used uuidValidate
      throw new Error(`Invalid UUID format for workItemId: ${workItemId}`);
    }
    const dbClient = this.getClient(client);

    logger.debug(`[WorkItemRepositoryCRUD] Updating work item ${workItemId} in transaction`);
    try {
      const now = new Date().toISOString();
      const setClauses: string[] = [];
      const params: any[] = []; // FIXME: Replace 'any' with a more specific type if possible (Line 207)
      let paramIndex = 1;

      for (const key in updatePayload) {
        if (Object.prototype.hasOwnProperty.call(updatePayload, key)) {
          if (key === 'is_active') continue; // Cannot change is_active via update

          const typedKey = key as keyof typeof updatePayload;
          const value = updatePayload[typedKey];
          setClauses.push(`"${typedKey}" = $${paramIndex++}`);
          params.push(value === undefined ? null : value);
        }
      }

      let updatedItemResult: WorkItemData;

      // Only run UPDATE query if there are fields to update
      if (setClauses.length > 0) {
        setClauses.push(`updated_at = $${paramIndex++}`);
        params.push(now);
        const workItemIdParamIndex = paramIndex++;
        params.push(workItemId);
        const updateSql = `
          UPDATE work_items
          SET ${setClauses.join(', ')}
          WHERE work_item_id = $${workItemIdParamIndex} AND is_active = TRUE
          RETURNING *;
        `; // Ensure we only update active items
        const updateResult = await dbClient.query(updateSql, params);
        if (updateResult.rowCount === 0)
          throw new NotFoundError(`Active work item ${workItemId} not found for update.`);
        updatedItemResult = this.mapRowToWorkItemData(updateResult.rows[0]);
        logger.debug(
          `[WorkItemRepositoryCRUD] Updated work item ${workItemId} fields. Row count: ${updateResult.rowCount}`
        );
      } else {
        // Fetch current active state if no fields were updated
        const currentDataResult = await dbClient.query(
          'SELECT * FROM work_items WHERE work_item_id = $1 AND is_active = TRUE',
          [workItemId]
        );
        if (currentDataResult.rowCount === 0) throw new NotFoundError(`Active work item ${workItemId} not found.`);
        updatedItemResult = this.mapRowToWorkItemData(currentDataResult.rows[0]);
        logger.debug(`[WorkItemRepositoryCRUD] No core fields to update for ${workItemId}.`);
      }

      // Handle dependencies IF the newDependenciesInput array was provided
      if (newDependenciesInput !== undefined) {
        logger.debug(
          `[WorkItemRepositoryCRUD] Updating dependencies for item ${workItemId}. Input dependencies:`,
          newDependenciesInput
        );
        // 1. Fetch current dependencies (active and inactive)
        const currentDepsResult = await dbClient.query('SELECT * FROM work_item_dependencies WHERE work_item_id = $1', [
          workItemId,
        ]);
        const currentDepsMap = new Map(
          currentDepsResult.rows.map((row) => [row.depends_on_work_item_id, this.mapRowToWorkItemDependencyData(row)])
        );
        logger.debug(
          `[WorkItemRepositoryCRUD DIAG] Found ${currentDepsMap.size} existing dependencies (any state) for ${workItemId}:`,
          [...currentDepsMap.entries()]
        );

        // 2. Determine desired state
        const desiredDepsMap = new Map(
          newDependenciesInput.map((dep) => [
            dep.depends_on_work_item_id,
            { ...dep, work_item_id: workItemId, is_active: true }, // Ensure work_item_id and is_active are set
          ])
        );
        logger.debug(`[WorkItemRepositoryCRUD DIAG] Desired Deps State for ${workItemId}:`, [
          ...desiredDepsMap.entries(),
        ]);

        // 3. Identify actions needed
        const depsToInsertOrUpdate: WorkItemDependencyData[] = [];
        const depsToDeactivate: string[] = []; // depends_on_work_item_id list

        // Find deps to insert or update (reactivate)
        for (const [desiredTargetId, desiredDep] of desiredDepsMap.entries()) {
          if (!uuidValidate(desiredTargetId)) {
            // Used uuidValidate
            logger.warn(
              `[WorkItemRepositoryCRUD] update: Invalid UUID format for desired depends_on_work_item_id: ${desiredTargetId}. Skipping.`
            );
            continue;
          }
          const currentDep = currentDepsMap.get(desiredTargetId);
          if (!currentDep || !currentDep.is_active || currentDep.dependency_type !== desiredDep.dependency_type) {
            depsToInsertOrUpdate.push(desiredDep); // New dependency or needs reactivation/type change
          }
        }

        // Find deps to deactivate
        for (const [currentTargetId, currentDep] of currentDepsMap.entries()) {
          if (currentDep.is_active && !desiredDepsMap.has(currentTargetId)) {
            depsToDeactivate.push(currentTargetId); // Was active, but not in desired list
          }
        }
        logger.debug(
          `[WorkItemRepositoryCRUD DIAG] Dependencies actions for ${workItemId}: To Insert/Update:`,
          depsToInsertOrUpdate,
          'To Deactivate:',
          depsToDeactivate
        );

        // 4. Execute DB Operations
        if (depsToDeactivate.length > 0) {
          logger.debug(
            `[WorkItemRepositoryCRUD] Deactivating ${depsToDeactivate.length} dependencies for ${workItemId}.`
          );
          const placeholders = depsToDeactivate.map((_, i) => `$${i + 2}`).join(',');
          const deactivateSql = `
            UPDATE work_item_dependencies
            SET is_active = FALSE
            WHERE work_item_id = $1 AND depends_on_work_item_id IN (${placeholders}) AND is_active = TRUE;
          `;
          const deactivateResult = await dbClient.query(deactivateSql, [workItemId, ...depsToDeactivate]);
          logger.debug(
            `[WorkItemRepositoryCRUD] Deactivated ${deactivateResult.rowCount ?? 0} dependencies for ${workItemId}.`
          );
        }

        if (depsToInsertOrUpdate.length > 0) {
          logger.debug(
            `[WorkItemRepositoryCRUD] Inserting/Updating ${depsToInsertOrUpdate.length} dependencies for ${workItemId}.`
          );
          const insertUpdateSql = `
            INSERT INTO work_item_dependencies (work_item_id, depends_on_work_item_id, dependency_type, is_active)
            VALUES ($1, $2, $3, $4) -- Use placeholders for all values
            ON CONFLICT (work_item_id, depends_on_work_item_id)
            DO UPDATE SET
              dependency_type = EXCLUDED.dependency_type,
              is_active = EXCLUDED.is_active;
          `;
          let affectedCount = 0; // Count rows affected by insert/update
          for (const dep of depsToInsertOrUpdate) {
            if (!uuidValidate(dep.work_item_id) || !uuidValidate(dep.depends_on_work_item_id)) {
              logger.warn(
                `[WorkItemRepositoryCRUD] update: Skipping insert/update for dependency with invalid UUIDs: ${dep.work_item_id}, ${dep.depends_on_work_item_id}`
              );
              continue;
            }
            // Pass all four parameters explicitly
            const result = await dbClient.query(insertUpdateSql, [
              workItemId, // work_item_id (source of dependency)
              dep.depends_on_work_item_id, // depends_on_work_item_id (target of dependency)
              dep.dependency_type ?? 'finish-to-start', // dependency_type
              dep.is_active ?? true, // is_active
            ]);
            affectedCount += result.rowCount ?? 0;
          }
          logger.debug(
            `[WorkItemRepositoryCRUD] Total inserted/updated dependencies for ${workItemId}: ${affectedCount}.`
          );
        }
        logger.debug(`[WorkItemRepositoryCRUD] Finished updating dependencies for item ${workItemId}.`);
      }

      logger.info(`[WorkItemRepositoryCRUD] Successfully processed update for item ${workItemId}.`);
      return updatedItemResult;
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryCRUD] Failed transaction for updating item ${workItemId}:`, error);
      throw error;
    }
  }

  /**
   * Soft deletes one or more work items by setting their is_active to FALSE.
   * Requires a client for transaction management.
   */
  public async softDelete(workItemIds: string[], client: PoolClient): Promise<number> {
    if (workItemIds.length === 0 || !workItemIds.every((id) => uuidValidate(id))) {
      // Used uuidValidate
      logger.warn('[WorkItemRepositoryCRUD] softDelete called with empty or invalid list.');
      return 0;
    }
    const dbClient = this.getClient(client);

    const now = new Date().toISOString();
    const placeholders = workItemIds.map((_, i) => `$${i + 2}`).join(',');
    // Update only items that are currently active
    const sql = `
      UPDATE work_items
      SET is_active = FALSE, updated_at = $1
      WHERE work_item_id IN (${placeholders}) AND is_active = TRUE;
    `;
    const params = [now, ...workItemIds];

    // DIAGNOSTIC LOGGING
    logger.debug(`[WorkItemRepositoryCRUD DIAG] Executing softDelete SQL: ${sql} PARAMS: ${JSON.stringify(params)}`);

    try {
      const result = await dbClient.query(sql, params);
      // DIAGNOSTIC LOGGING
      logger.debug(`[WorkItemRepositoryCRUD DIAG] softDelete result rowCount: ${result.rowCount}`);
      logger.info(`[WorkItemRepositoryCRUD] Soft deleted ${result.rowCount ?? 0} work item(s).`);
      return result.rowCount ?? 0;
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositoryCRUD] Failed to soft delete work items:`, error);
      throw error;
    }
  }
}
