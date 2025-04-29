// src/repositories/WorkItemRepository.ts
import { Pool, PoolClient } from 'pg';
import { logger } from '../utils/logger.js';
import { NotFoundError } from '../utils/errors.js'; // Import NotFoundError


// Interface for the unified Work Item data - ADDED is_active
export interface WorkItemData {
  work_item_id: string; // UUID
  parent_work_item_id: string | null; // UUID or null
  name: string; // TEXT NOT NULL
  shortname: string | null; // TEXT NULL
  description: string | null; // TEXT NULL
  status: 'todo' | 'in-progress' | 'review' | 'done'; // Does not include soft delete status anymore
  priority: 'high' | 'medium' | 'low';
  order_key: string | null; // TEXT NULL - for sorting
  created_at: string; // ISO String representation of TIMESTAMPTZ
  updated_at: string; // ISO String representation of TIMESTAMPTZ
  due_date: string | null; // ISO String representation of TIMESTAMPTZ or null
  is_active: boolean; // New flag for soft deletion
}

// Interface for dependency data - ADDED is_active
export interface WorkItemDependencyData {
  work_item_id: string; // UUID
  depends_on_work_item_id: string; // UUID
  dependency_type: 'finish-to-start' | 'linked'; // New type field
  is_active: boolean; // New flag for soft deleting the dependency link
}

// Helper function to map row data to WorkItemData, handling dates, nulls, and is_active
function mapRowToWorkItemData(row: any): WorkItemData {
  return {
    work_item_id: row.work_item_id,
    parent_work_item_id: row.parent_work_item_id,
    name: row.name,
    shortname: row.shortname,
    description: row.description,
    status: row.status,
    priority: row.priority,
    order_key: row.order_key,
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
    updated_at:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : row.updated_at,
    due_date:
      row.due_date === null
        ? null
        : row.due_date instanceof Date
          ? row.due_date.toISOString()
          : row.due_date,
    is_active: row.is_active, // Include is_active
  };
}

// Helper function to map row data to WorkItemDependencyData
function mapRowToWorkItemDependencyData(row: any): WorkItemDependencyData {
    return {
        work_item_id: row.work_item_id,
        depends_on_work_item_id: row.depends_on_work_item_id,
        dependency_type: row.dependency_type,
        is_active: row.is_active, // Include is_active
    };
}


export class WorkItemRepository {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  // Helper to get a client, ensuring it's provided for transactional methods
  private getClient(client?: PoolClient): PoolClient {
      if (!client) {
        // Throw an error if a transactional method is called without a client
        logger.error("[WorkItemRepository] Transactional method called without a client.");
        throw new Error("Repository transactional method requires a client instance.");
      }
      return client;
  }

  // Helper to get client or pool for read operations
   private getClientOrPool(client?: PoolClient): PoolClient | Pool {
       return client ?? this.pool;
   }


  /**
   * Creates a new work item and its dependencies.
   * Requires a client for transaction management.
   * @param client - PoolClient for transaction management (required).
   * @param item - The core work item data (should include is_active).
   * @param dependencies - Optional list of dependencies to add (should include is_active).
   * @returns The created WorkItemData.
   */
  public async create(
    client: PoolClient, // FIX: Required client parameter first
    item: WorkItemData,
    dependencies?: WorkItemDependencyData[]
  ): Promise<WorkItemData> {
    const dbClient = this.getClient(client); // Ensure client is provided

    logger.debug(
      `[WorkItemRepository] Creating item ${item.work_item_id} within transaction`
    );
    try {
      // Insert the main item
      const insertItemSql = `
                INSERT INTO work_items (
                    work_item_id, parent_work_item_id, name, shortname, description,
                    status, priority, order_key, created_at, updated_at, due_date, is_active
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                RETURNING *;
            `;
      const itemParams = [
        item.work_item_id, item.parent_work_item_id, item.name, item.shortname, item.description,
        item.status, item.priority, item.order_key, item.created_at, item.updated_at,
        item.due_date, item.is_active,
      ];
      const itemInsertResult = await dbClient.query(insertItemSql, itemParams);

      if (itemInsertResult.rowCount !== 1) {
        throw new Error(`Failed to insert work item ${item.work_item_id}.`);
      }
      const createdItem = mapRowToWorkItemData(itemInsertResult.rows[0]);

      // Insert dependencies if provided
      if (dependencies && dependencies.length > 0) {
        const insertDepSql = `
                    INSERT INTO work_item_dependencies (work_item_id, depends_on_work_item_id, dependency_type, is_active)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT(work_item_id, depends_on_work_item_id) DO NOTHING;
                `;
        for (const dep of dependencies) {
          await dbClient.query(insertDepSql, [
            dep.work_item_id, dep.depends_on_work_item_id, dep.dependency_type, dep.is_active,
          ]);
        }
      }

      logger.info(`[WorkItemRepository] Created work item ${createdItem.work_item_id} with ${dependencies?.length ?? 0} dependencies.`);
      return createdItem;
    } catch (error: unknown) {
      logger.error(`[WorkItemRepository] Error creating item ${item.work_item_id} in transaction:`, error);
      throw error; // Propagate error for transaction handling by the service
    }
  }

    /**
     * Finds a single work item by its ID, optionally filtering by active status.
     * Accepts an optional client for transaction management (uses pool if not provided).
     * @param workItemId UUID of the item to find.
     * @param filter - Optional filter { isActive?: boolean }. If undefined, fetches regardless of active status. If true, fetches only active. If false, fetches only inactive.
     * @param client - Optional PoolClient for transaction management.
     * @returns WorkItemData or undefined if not found or filtered out.
     */
    public async findById(workItemId: string, filter?: { isActive?: boolean }, client?: PoolClient): Promise<WorkItemData | undefined> {
        const dbClient = this.getClientOrPool(client); // Use client or pool

        let sql = ` SELECT * FROM work_items WHERE work_item_id = $1 `;
        const params: (string | boolean)[] = [workItemId];

        if (filter?.isActive !== undefined) {
            sql += ` AND is_active = $2`; params.push(filter.isActive);
        } else {
             sql += ` AND is_active = TRUE`; // Default to active
        }

        try {
            const result = await dbClient.query(sql, params);
            if (result.rows.length === 0) {
                // Log filter value for better debugging
                logger.debug(`[WorkItemRepository] Work item ${workItemId} not found or filtered out (isActive filter: ${filter?.isActive}).`);
                return undefined;
            }
            logger.debug(`[WorkItemRepository] Found work item ${workItemId}.`);
            return mapRowToWorkItemData(result.rows[0]);
        } catch (error: unknown) {
            logger.error(`[WorkItemRepository] Failed to find work item ${workItemId}:`, error);
            throw error;
        }
    }

     /**
     * Finds multiple work items by their IDs, optionally filtering by active status.
     * Accepts an optional client for transaction management (uses pool if not provided).
     * @param workItemIds Array of UUIDs of the items to find.
     * @param filter - Optional filter { isActive?: boolean }.
     * @param client - Optional PoolClient for transaction management.
     * @returns Array of WorkItemData.
     */
    public async findByIds(workItemIds: string[], filter?: { isActive?: boolean }, client?: PoolClient): Promise<WorkItemData[]> {
        if (workItemIds.length === 0) return [];
        const dbClient = this.getClientOrPool(client);
        const placeholders = workItemIds.map((_, i) => `$${i + 1}`).join(',');

        let sql = ` SELECT * FROM work_items WHERE work_item_id IN (${placeholders}) `;
        const params: (string | boolean)[] = [...workItemIds];
        let paramIndex = params.length + 1;

         if (filter?.isActive !== undefined) {
             sql += ` AND is_active = $${paramIndex++}`; params.push(filter.isActive);
         } else {
              sql += ` AND is_active = TRUE`; // Default to active
         }

        try {
            const result = await dbClient.query(sql, params);
             logger.debug(`[WorkItemRepository] Found ${result.rows.length} work items by IDs (count: ${workItemIds.length}, isActive: ${filter?.isActive}).`);
            return result.rows.map(mapRowToWorkItemData);
        } catch (error: unknown) {
             logger.error(`[WorkItemRepository] Failed to find work items by IDs:`, error);
             throw error;
        }
    }

     /**
     * Finds all work items, optionally filtering by active status.
     * Accepts an optional client for transaction management (uses pool if not provided).
     * @param filter - Optional filter { isActive?: boolean }.
     * @param client - Optional PoolClient for transaction management.
     * @returns Array of WorkItemData.
     */
    public async findAll(filter?: { isActive?: boolean }, client?: PoolClient): Promise<WorkItemData[]> {
        const dbClient = this.getClientOrPool(client);

        let sql = `SELECT * FROM work_items`;
        const params: (boolean)[] = [];
        let paramIndex = 1;
        const whereClauses: string[] = [];

         if (filter?.isActive !== undefined) {
             whereClauses.push(`is_active = $${paramIndex++}`); params.push(filter.isActive);
         } else {
             whereClauses.push(`is_active = TRUE`); // Default to active
         }

        if (whereClauses.length > 0) sql += ' WHERE ' + whereClauses.join(' AND ');
        sql += ' ORDER BY created_at ASC;';

        try {
             const result = await dbClient.query(sql, params);
             logger.debug(`[WorkItemRepository] Found ${result.rows.length} work items (all, active filter: ${filter?.isActive}).`);
             return result.rows.map(mapRowToWorkItemData);
        } catch (error: unknown) {
             logger.error(`[WorkItemRepository] Failed to find all work items:`, error);
             throw error;
        }
    }


  /**
   * Finds all root work items (projects), optionally filtering by active status.
   * Accepts an optional client for transaction management (uses pool if not provided).
   * @param filter - Optional filter { isActive?: boolean }.
   * @param client - Optional PoolClient for transaction management.
   * @returns Array of WorkItemData for root items.
   */
  public async findRoots(filter?: { isActive?: boolean }, client?: PoolClient): Promise<WorkItemData[]> {
    const dbClient = this.getClientOrPool(client);

    let sql = ` SELECT * FROM work_items WHERE parent_work_item_id IS NULL `;
    const params: (boolean)[] = [];
    let paramIndex = 1;

    if (filter?.isActive !== undefined) {
        sql += ` AND is_active = $${paramIndex++}`; params.push(filter.isActive);
    } else {
         sql += ` AND is_active = TRUE`; // Default to active
    }
    sql += ` ORDER BY order_key ASC, created_at ASC;`;

    try {
      const result = await dbClient.query(sql, params);
      logger.debug(`[WorkItemRepository] Found ${result.rows.length} root work items (active filter: ${filter?.isActive}).`);
      return result.rows.map(mapRowToWorkItemData);
    } catch (error: unknown) {
      logger.error(`[WorkItemRepository] Failed to find root work items:`, error);
      throw error;
    }
  }

  /**
   * Finds all direct children of a given parent work item, optionally filtering by active status.
   * Accepts an optional client for transaction management (uses pool if not provided).
   * @param parentWorkItemId UUID of the parent item.
   * @param filter - Optional filter { isActive?: boolean }.
   * @param client - Optional PoolClient for transaction management.
   * @returns Array of WorkItemData for child items, ordered by order_key.
   */
  public async findChildren(parentWorkItemId: string, filter?: { isActive?: boolean }, client?: PoolClient): Promise<WorkItemData[]> {
    const dbClient = this.getClientOrPool(client);

    let sql = ` SELECT * FROM work_items WHERE parent_work_item_id = $1 `;
    const params: (string | boolean)[] = [parentWorkItemId];
    let paramIndex = 2;

     if (filter?.isActive !== undefined) {
         sql += ` AND is_active = $${paramIndex++}`; params.push(filter.isActive);
     } else {
          sql += ` AND is_active = TRUE`; // Default to active
     }
    sql += ` ORDER BY order_key ASC, created_at ASC;`;

    try {
      const result = await dbClient.query(sql, params);
      logger.debug(`[WorkItemRepository] Found ${result.rows.length} children for parent ${parentWorkItemId} (active filter: ${filter?.isActive}).`);
      return result.rows.map(mapRowToWorkItemData);
    } catch (error: unknown) {
      logger.error(`[WorkItemRepository] Failed to find children for parent ${parentWorkItemId}:`, error);
      throw error;
    }
  }

    /**
     * Recursively finds all descendant work item IDs (children, grandchildren, etc.) of a given work item.
     * Requires a client for transaction management (recursion safety).
     * @param workItemId The ID of the root item.
     * @param client - PoolClient for transaction management (required).
     * @returns Array of descendant work item IDs.
     */
    public async findDescendantWorkItemIds(workItemId: string, client: PoolClient): Promise<string[]> {
        const dbClient = this.getClient(client); // Require client

        const sql = `
            WITH RECURSIVE descendants AS (
                SELECT work_item_id FROM work_items WHERE parent_work_item_id = $1
                UNION ALL
                SELECT wi.work_item_id FROM work_items wi JOIN descendants d ON wi.parent_work_item_id = d.work_item_id
            ) SELECT work_item_id FROM descendants;
        `;
        try {
            const result = await dbClient.query(sql, [workItemId]);
            logger.debug(`[WorkItemRepository] Found ${result.rows.length} descendants for item ${workItemId}.`);
            return result.rows.map(row => row.work_item_id);
        } catch (error: unknown) {
             logger.error(`[WorkItemRepository] Failed to find descendants for item ${workItemId}:`, error);
             throw error;
        }
    }


  /**
   * Finds all sibling work items (same parent, excluding self), optionally filtering by active status.
   * Accepts an optional client for transaction management (uses pool if not provided).
   * @param workItemId The ID of the item whose siblings are needed.
   * @param parentWorkItemId The parent ID (can be null for roots).
   * @param filter - Optional filter { isActive?: boolean }.
   * @param client - Optional PoolClient for transaction management.
   * @returns Array of sibling WorkItemData.
   */
  public async findSiblings(
    workItemId: string, parentWorkItemId: string | null, filter?: { isActive?: boolean }, client?: PoolClient
  ): Promise<WorkItemData[]> {
    const dbClient = this.getClientOrPool(client);

    let sql;
    const params: (string | boolean)[] = [];
    let paramIndex = 1;

    if (parentWorkItemId === null) {
        sql = `SELECT * FROM work_items WHERE parent_work_item_id IS NULL AND work_item_id != $${paramIndex++}`; params.push(workItemId);
    } else {
        sql = `SELECT * FROM work_items WHERE parent_work_item_id = $${paramIndex++} AND work_item_id != $${paramIndex++}`; params.push(parentWorkItemId, workItemId);
    }

     if (filter?.isActive !== undefined) {
         sql += ` AND is_active = $${paramIndex++}`; params.push(filter.isActive);
     } else {
          sql += ` AND is_active = TRUE`; // Default to active
     }
    sql += ` ORDER BY order_key ASC, created_at ASC;`;

    try {
      const result = await dbClient.query(sql, params);
      logger.debug(`[WorkItemRepository] Found ${result.rows.length} siblings for item ${workItemId} (active filter: ${filter?.isActive}).`);
      return result.rows.map(mapRowToWorkItemData);
    } catch (error: unknown) {
      logger.error(`[WorkItemRepository] Failed to find siblings for item ${workItemId}:`, error);
      throw error;
    }
  }


  /**
   * Finds dependencies for a given work item, optionally filtering by active status of the link and linked items.
   * Accepts an optional client for transaction management (uses pool if not provided).
   * @param workItemId UUID of the item.
   * @param filter - Optional filter { isActive?: boolean, dependsOnActive?: boolean }.
   * @param client - Optional PoolClient for transaction management.
   * @returns Array of WorkItemDependencyData.
   */
  public async findDependencies(
    workItemId: string, filter?: { isActive?: boolean, dependsOnActive?: boolean }, client?: PoolClient
  ): Promise<WorkItemDependencyData[]> {
    const dbClient = this.getClientOrPool(client);

    let sql = `
            SELECT wid.* FROM work_item_dependencies wid
            JOIN work_items wi_dep_on ON wid.depends_on_work_item_id = wi_dep_on.work_item_id
            WHERE wid.work_item_id = $1 `;
    const params: (string | boolean)[] = [workItemId];
     let paramIndex = 2;

     if (filter?.isActive !== undefined) {
         sql += ` AND wid.is_active = $${paramIndex++}`; params.push(filter.isActive);
     } else { sql += ` AND wid.is_active = TRUE`; } // Default active links

    if (filter?.dependsOnActive !== undefined) {
         sql += ` AND wi_dep_on.is_active = $${paramIndex++}`; params.push(filter.dependsOnActive);
     }

    try {
      const result = await dbClient.query(sql, params);
      logger.debug(`[WorkItemRepository] Found ${result.rows.length} dependencies for item ${workItemId} (link active: ${filter?.isActive}, dependsOn active: ${filter?.dependsOnActive}).`);
      return result.rows.map(mapRowToWorkItemDependencyData);
    } catch (error: unknown) {
      logger.error(`[WorkItemRepository] Failed to find dependencies for item ${workItemId}:`, error);
      throw error;
    }
  }

   /**
     * Finds dependencies where the work_item_id is in a given list, optionally filtering by active status.
     * Accepts an optional client for transaction management (uses pool if not provided).
     * @param workItemIds Array of UUIDs to check dependencies for.
     * @param filter - Optional filter { isActive?: boolean, dependsOnActive?: boolean }.
     * @param client - Optional PoolClient for transaction management.
     * @returns Array of WorkItemDependencyData.
     */
    public async findDependenciesByItemList(
        workItemIds: string[], filter?: { isActive?: boolean, dependsOnActive?: boolean }, client?: PoolClient
    ): Promise<WorkItemDependencyData[]> {
        if (workItemIds.length === 0) return [];
        const dbClient = this.getClientOrPool(client);
        const placeholders = workItemIds.map((_, i) => `$${i + 1}`).join(',');

         let sql = `
            SELECT wid.* FROM work_item_dependencies wid
            JOIN work_items wi_dep_on ON wid.depends_on_work_item_id = wi_dep_on.work_item_id
            WHERE wid.work_item_id IN (${placeholders}) `;
         const params: (string | boolean)[] = [...workItemIds];
         let paramIndex = params.length + 1;

         if (filter?.isActive !== undefined) {
             sql += ` AND wid.is_active = $${paramIndex++}`; params.push(filter.isActive);
         } else { sql += ` AND wid.is_active = TRUE`; } // Default active links

        if (filter?.dependsOnActive !== undefined) {
             sql += ` AND wi_dep_on.is_active = $${paramIndex++}`; params.push(filter.dependsOnActive);
         }

        try {
             const result = await dbClient.query(sql, params);
             logger.debug(`[WorkItemRepository] Found ${result.rows.length} dependencies for item list (count: ${workItemIds.length}).`);
             return result.rows.map(mapRowToWorkItemDependencyData);
        } catch (error: unknown) {
             logger.error(`[WorkItemRepository] Failed to find dependencies for item list:`, error);
             throw error;
        }
    }


  /**
   * Finds items that depend on the given work item (dependents), optionally filtering by active status.
   * Accepts an optional client for transaction management (uses pool if not provided).
   * @param dependsOnWorkItemId UUID of the item being depended on.
   * @param filter - Optional filter { isActive?: boolean, dependentIsActive?: boolean }.
   * @param client - Optional PoolClient for transaction management.
   * @returns Array of WorkItemDependencyData.
   */
  public async findDependents(
    dependsOnWorkItemId: string, filter?: { isActive?: boolean, dependentIsActive?: boolean }, client?: PoolClient
  ): Promise<WorkItemDependencyData[]> {
    const dbClient = this.getClientOrPool(client);

    let sql = `
            SELECT wid.* FROM work_item_dependencies wid
            JOIN work_items wi_dependent ON wid.work_item_id = wi_dependent.work_item_id
            WHERE wid.depends_on_work_item_id = $1 `;
    const params: (string | boolean)[] = [dependsOnWorkItemId];
     let paramIndex = 2;

     if (filter?.isActive !== undefined) {
         sql += ` AND wid.is_active = $${paramIndex++}`; params.push(filter.isActive);
     } else { sql += ` AND wid.is_active = TRUE`; } // Default active links

    if (filter?.dependentIsActive !== undefined) {
         sql += ` AND wi_dependent.is_active = $${paramIndex++}`; params.push(filter.dependentIsActive);
     }

    try {
      const result = await dbClient.query(sql, params);
      logger.debug(`[WorkItemRepository] Found ${result.rows.length} dependents for item ${dependsOnWorkItemId} (link active: ${filter?.isActive}, dependent active: ${filter?.dependentIsActive}).`);
      return result.rows.map(mapRowToWorkItemDependencyData);
    } catch (error: unknown) {
      logger.error(`[WorkItemRepository] Failed to find dependents for item ${dependsOnWorkItemId}:`, error);
      throw error;
    }
  }

  /**
   * Finds dependency links where the depends_on_work_item_id is in a given list, optionally filtering by active status.
   * Accepts an optional client for transaction management (uses pool if not provided).
   * @param dependsOnWorkItemIds Array of UUIDs items depend on.
   * @param filter - Optional filter { isActive?: boolean, dependentIsActive?: boolean }.
   * @param client - Optional PoolClient for transaction management.
   * @returns Array of WorkItemDependencyData.
   */
  public async findDependentsByItemList(
    dependsOnWorkItemIds: string[], filter?: { isActive?: boolean; dependentIsActive?: boolean }, client?: PoolClient
  ): Promise<WorkItemDependencyData[]> {
    if (dependsOnWorkItemIds.length === 0) return [];
    const dbClient = this.getClientOrPool(client);
    const placeholders = dependsOnWorkItemIds.map((_, i) => `$${i + 1}`).join(',');

    let sql = `
            SELECT wid.* FROM work_item_dependencies wid
            JOIN work_items wi_dependent ON wid.work_item_id = wi_dependent.work_item_id
            WHERE wid.depends_on_work_item_id IN (${placeholders}) `;
    const params: (string | boolean)[] = [...dependsOnWorkItemIds];
    let paramIndex = params.length + 1;

    if (filter?.isActive !== undefined) {
      sql += ` AND wid.is_active = $${paramIndex++}`; params.push(filter.isActive);
    } else { sql += ` AND wid.is_active = TRUE`; } // Default active links

    if (filter?.dependentIsActive !== undefined) {
      sql += ` AND wi_dependent.is_active = $${paramIndex++}`; params.push(filter.dependentIsActive);
    }

    try {
      const result = await dbClient.query(sql, params);
      logger.debug(`[WorkItemRepository] Found ${result.rows.length} dependents for item list (count: ${dependsOnWorkItemIds.length}).`);
      return result.rows.map(mapRowToWorkItemDependencyData);
    } catch (error: unknown) {
      logger.error(`[WorkItemRepository] Failed to find dependents for item list:`, error);
      throw error;
    }
  }

   /**
    * Finds dependency links by a list of their composite keys, optionally filtering by active status.
    * Accepts an optional client for transaction management (uses pool if not provided).
    * @param compositeKeys Array of composite keys { work_item_id: string, depends_on_work_item_id: string }.
    * @param filter - Optional filter { isActive?: boolean }.
    * @param client - Optional PoolClient for transaction management.
    * @returns Array of WorkItemDependencyData.
    */
    public async findDependenciesByCompositeKeys(
        compositeKeys: { work_item_id: string, depends_on_work_item_id: string }[], filter?: { isActive?: boolean }, client?: PoolClient
    ): Promise<WorkItemDependencyData[]> {
        if (compositeKeys.length === 0) return [];
        const dbClient = this.getClientOrPool(client);

        const whereClauses = compositeKeys.map((_, i) => `(work_item_id = $${i * 2 + 1} AND depends_on_work_item_id = $${i * 2 + 2})`).join(' OR ');
        const params: (string | boolean)[] = compositeKeys.flatMap(key => [key.work_item_id, key.depends_on_work_item_id]);
        let paramIndex = params.length + 1;

        let sql = ` SELECT * FROM work_item_dependencies WHERE ${whereClauses} `;
        if (filter?.isActive !== undefined) {
             sql += ` AND is_active = $${paramIndex++}`; params.push(filter.isActive);
         }

        try {
             const result = await dbClient.query(sql, params);
             logger.debug(`[WorkItemRepository] Found ${result.rows.length} dependencies by composite keys (count: ${compositeKeys.length}).`);
             return result.rows.map(mapRowToWorkItemDependencyData);
        } catch (error: unknown) {
             logger.error(`[WorkItemRepository] Failed to find dependencies by composite keys:`, error);
             throw error;
        }
    }


  /**
   * Updates a work item and optionally its dependencies.
   * Requires a client for transaction management.
   * @param client - PoolClient for transaction management (required).
   * @param workItemId UUID of the item to update.
   * @param updatePayload Object containing fields to update (excluding is_active).
   * @param newDependencies Optional array of dependencies to set (replaces old ones, sets is_active=TRUE).
   * @returns The updated WorkItemData.
   */
  public async update(
    client: PoolClient, // FIX: Required client parameter first
    workItemId: string,
    updatePayload: Partial< Omit<WorkItemData, 'work_item_id' | 'created_at' | 'updated_at' | 'is_active'> >,
    newDependencies?: WorkItemDependencyData[]
  ): Promise<WorkItemData> {
    const dbClient = this.getClient(client); // Ensure client is provided

    logger.debug(`[WorkItemRepository] Updating work item ${workItemId} in transaction`);
    try {
      const now = new Date().toISOString();
      const setClauses: string[] = [];
      const params: (string | null | number | boolean | object)[] = [];
      let paramIndex = 1;

      for (const key in updatePayload) {
        if (Object.prototype.hasOwnProperty.call(updatePayload, key)) {
           if (key === 'is_active') continue; // Skip is_active

          const typedKey = key as keyof typeof updatePayload;
          const value = updatePayload[typedKey];

          setClauses.push(`"${typedKey}" = $${paramIndex++}`);
          // FIX: Convert undefined to null for SQL compatibility
          params.push(value === undefined ? null : value);
        }
      }

      setClauses.push(`updated_at = $${paramIndex++}`);
      params.push(now);

      const workItemIdParamIndex = paramIndex++;
      params.push(workItemId);

      let updatedItemResult: WorkItemData;

      if (setClauses.length > 1) {
         const updateSql = ` UPDATE work_items SET ${setClauses.join(', ')} WHERE work_item_id = $${workItemIdParamIndex} RETURNING *; `;
         const updateResult = await dbClient.query(updateSql, params);
         if (updateResult.rowCount === 0) throw new NotFoundError(`Work item ${workItemId} not found for update.`);
         updatedItemResult = mapRowToWorkItemData(updateResult.rows[0]);
         logger.debug(`[WorkItemRepository] Updated work item ${workItemId} fields.`);
      } else {
         const currentData = await dbClient.query('SELECT * FROM work_items WHERE work_item_id = $1', [workItemId]);
          if (currentData.rowCount === 0) throw new NotFoundError(`Work item ${workItemId} not found.`);
         updatedItemResult = mapRowToWorkItemData(currentData.rows[0]);
      }


      if (newDependencies !== undefined) {
        // Soft delete existing active dependencies for this item
        const softDeleteDepsSql = ` UPDATE work_item_dependencies SET is_active = FALSE WHERE work_item_id = $1 AND is_active = TRUE; `;
        const deleteInfo = await dbClient.query(softDeleteDepsSql, [workItemId]);
        logger.debug(`[WorkItemRepository] Soft deleted ${deleteInfo.rowCount ?? 0} existing active dependencies for item ${workItemId}.`);

        // Insert or reactivate the new dependencies
        if (newDependencies.length > 0) {
           const insertOrUpdateDepSql = `
                INSERT INTO work_item_dependencies (work_item_id, depends_on_work_item_id, dependency_type, is_active) VALUES ($1, $2, $3, $4)
                ON CONFLICT(work_item_id, depends_on_work_item_id) DO UPDATE SET dependency_type = EXCLUDED.dependency_type, is_active = EXCLUDED.is_active; `;
            for (const dep of newDependencies) {
                await dbClient.query(insertOrUpdateDepSql, [ workItemId, dep.depends_on_work_item_id, dep.dependency_type, true ]); // Always insert/update as active
            }
            logger.debug(`[WorkItemRepository] Inserted/Updated ${newDependencies.length} new dependencies for item ${workItemId}.`);
        }
      }

      logger.info(`[WorkItemRepository] Successfully updated item ${workItemId}.`);
      return updatedItemResult;
    } catch (error: unknown) {
      logger.error(`[WorkItemRepository] Failed transaction for updating item ${workItemId}:`, error);
      throw error;
    }
  }

  /**
   * Soft deletes one or more work items by setting their is_active to FALSE.
   * Requires a client for transaction management.
   * @param workItemIds Array of UUIDs to soft delete.
   * @param client - PoolClient for transaction management (required).
   * @returns The number of items whose is_active was set to FALSE.
   */
  public async softDelete(workItemIds: string[], client: PoolClient): Promise<number> {
    if (workItemIds.length === 0) return 0;
    const dbClient = this.getClient(client);

    const now = new Date().toISOString();
    const placeholders = workItemIds.map((_, i) => `$${i + 2}`).join(',');
    const sql = ` UPDATE work_items SET is_active = FALSE, updated_at = $1 WHERE work_item_id IN (${placeholders}) AND is_active = TRUE; `;
    const params = [now, ...workItemIds];

    try {
      const result = await dbClient.query(sql, params);
      logger.info(`[WorkItemRepository] Soft deleted ${result.rowCount ?? 0} work item(s).`);
      return result.rowCount ?? 0;
    } catch (error: unknown) {
      logger.error(`[WorkItemRepository] Failed to soft delete work items:`, error);
      throw error;
    }
  }


   /**
    * Soft deletes dependency links by setting their is_active to FALSE.
    * Requires a client for transaction management.
    * @param compositeKeys Array of composite keys { work_item_id: string, depends_on_work_item_id: string }.
    * @param client - PoolClient for transaction management (required).
    * @returns The number of dependency links whose is_active was set to FALSE.
    */
   public async softDeleteDependenciesByCompositeKeys(
       compositeKeys: { work_item_id: string, depends_on_work_item_id: string }[], client: PoolClient
   ): Promise<number> {
       if (compositeKeys.length === 0) return 0;
       const dbClient = this.getClient(client);

       const whereClauses = compositeKeys.map((_, i) => `(work_item_id = $${i * 2 + 1} AND depends_on_work_item_id = $${i * 2 + 2})`).join(' OR ');
       const params: string[] = compositeKeys.flatMap(key => [key.work_item_id, key.depends_on_work_item_id]);
       const sql = ` UPDATE work_item_dependencies SET is_active = FALSE WHERE (${whereClauses}) AND is_active = TRUE; `;

       try {
           const result = await dbClient.query(sql, params);
           logger.info(`[WorkItemRepository] Soft deleted ${result.rowCount ?? 0} dependency link(s).`);
           return result.rowCount ?? 0;
       } catch (error: unknown) {
           logger.error(`[WorkItemRepository] Failed to soft delete dependency links:`, error);
           throw error;
       }
   }


  /**
   * Finds active work items whose description or name matches a query string (case-insensitive).
   * Accepts an optional client for transaction management (uses pool if not provided).
   * @param query The search string.
   * @param filter - Optional filter { isActive?: boolean }.
   * @param client - Optional PoolClient for transaction management.
   * @returns Array of matching WorkItemData.
   */
  public async searchByNameOrDescription(
    query: string, filter?: { isActive?: boolean }, client?: PoolClient
  ): Promise<WorkItemData[]> {
    const dbClient = this.getClientOrPool(client);

    let sql = ` SELECT * FROM work_items WHERE (name ILIKE $1 OR description ILIKE $1) `;
    const params: (string | boolean)[] = [`%${query}%`];
     let paramIndex = 2;

     if (filter?.isActive !== undefined) {
         sql += ` AND is_active = $${paramIndex++}`; params.push(filter.isActive);
     } else { sql += ` AND is_active = TRUE`; } // Default active
    sql += ` ORDER BY created_at DESC;`;

    try {
      const result = await dbClient.query(sql, params);
      logger.debug(`[WorkItemRepository] Found ${result.rows.length} items matching query "${query}" (active: ${filter?.isActive}).`);
      return result.rows.map(mapRowToWorkItemData);
    } catch (error: unknown) {
      logger.error(`[WorkItemRepository] Failed search for query "${query}":`, error);
      throw error;
    }
  }

  public async getAdjacentOrderKeys(
    parentWorkItemId: string | null, currentOrderKey: string | null, client?: PoolClient
  ): Promise<{ before: string | null; after: string | null }> {
    logger.warn('[WorkItemRepository] getAdjacentOrderKeys needs implementation!');
    return { before: null, after: null };
  }

   // --- Generic Row Manipulation Methods for Undo/Redo Execution ---

     /**
      * Updates a row in a specified table using the primary key(s) within the data object.
      * Requires a client for transaction management.
      * @param client - PoolClient for transaction management.
      * @param tableName - 'work_items' or 'work_item_dependencies'.
      * @param data - The full row data to update, must contain primary key(s).
      */
     public async updateRowState(client: PoolClient, tableName: string, data: object): Promise<void> {
        const dbClient = this.getClient(client);

        const setClauses: string[] = [];
        const params: (string | number | boolean | object | null)[] = [];
        let paramIndex = 1;
        let pkColumns: string[] = [];
        let pkValues: (string | null)[] = [];

         for (const key in data) {
            if (Object.prototype.hasOwnProperty.call(data, key)) {
                 const value = (data as any)[key];
                 if (tableName === 'work_items' && key === 'work_item_id') {
                    pkColumns.push(`"${key}"`); pkValues.push(value);
                 } else if (tableName === 'work_item_dependencies' && (key === 'work_item_id' || key === 'depends_on_work_item_id')) {
                    pkColumns.push(`"${key}"`); pkValues.push(value);
                 } else {
                     setClauses.push(`"${key}" = $${paramIndex++}`);
                     params.push(value === undefined ? null : value); // Convert undefined -> null
                 }
            }
         }

         if (setClauses.length === 0) {
             logger.warn(`[WorkItemRepository] updateRowState called for ${tableName} with no data fields to update.`); return;
         }

         pkValues.forEach(val => params.push(val));
         const whereClause = pkColumns.map((col, i) => `${col} = $${paramIndex + i}`).join(' AND ');
         if (pkColumns.length === 0 || pkValues.some(v => v === null || v === undefined)) {
              throw new Error(`updateRowState: Missing primary key value(s) in data for ${tableName}.`);
         }

         const sql = ` UPDATE "${tableName}" SET ${setClauses.join(', ')} WHERE ${whereClause}; `;
        try {
            const result = await dbClient.query(sql, params);
            if (result.rowCount === 0) logger.warn(`[WorkItemRepository] updateRowState: Row not found in ${tableName} during update based on PKs.`);
            else logger.debug(`[WorkItemRepository] Updated row in ${tableName} based on PKs.`);
        } catch (error: unknown) {
            logger.error(`[WorkItemRepository] Failed to update row in ${tableName}:`, error); throw error;
        }
     }

     /**
      * Inserts a row into the specified table.
      * Requires a client for transaction management.
      * @param client - PoolClient for transaction management.
      * @param tableName - 'work_items' or 'work_item_dependencies'.
      * @param data - The full row data to insert.
      */
     public async insertRow(client: PoolClient, tableName: string, data: object): Promise<void> {
        const dbClient = this.getClient(client);

         const columns: string[] = [];
         const placeholders: string[] = [];
         const params: (string | number | boolean | object | null)[] = [];
         let paramIndex = 1;

         for (const key in data) {
            if (Object.prototype.hasOwnProperty.call(data, key)) {
                 columns.push(`"${key}"`); placeholders.push(`$${paramIndex++}`);
                 params.push((data as any)[key] === undefined ? null : (data as any)[key]); // Convert undefined -> null
            }
         }
          if (columns.length === 0) { logger.warn(`[WorkItemRepository] insertRow called for ${tableName} with no data fields.`); return; }

         const sql = ` INSERT INTO "${tableName}" (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) ON CONFLICT DO NOTHING; `;
         try {
             await dbClient.query(sql, params); logger.debug(`[WorkItemRepository] Attempted insert into ${tableName}.`);
         } catch (error: unknown) {
             logger.error(`[WorkItemRepository] Failed to insert row into ${tableName}:`, error); throw error;
         }
     }

      /**
       * Deletes a row from the specified table using its primary key.
       * Requires a client for transaction management.
       * @param client - PoolClient for transaction management.
       * @param tableName - 'work_items' or 'work_item_dependencies'.
       * @param recordId - Primary key (UUID for work_items, "id1:id2" for dependencies).
       */
     public async deleteRow(client: PoolClient, tableName: string, recordId: string): Promise<void> {
        const dbClient = this.getClient(client);

         let sql;
         const params: string[] = [];

        if (tableName === 'work_items') {
             sql = `DELETE FROM "work_items" WHERE "work_item_id" = $1;`; params.push(recordId);
        } else if (tableName === 'work_item_dependencies' && typeof recordId === 'string' && recordId.includes(':')) {
             const [work_item_id, depends_on_work_item_id] = recordId.split(':');
             if (!work_item_id || !depends_on_work_item_id) throw new Error(`deleteRow: Invalid composite key format for ${tableName}: "${recordId}".`);
             sql = `DELETE FROM "work_item_dependencies" WHERE "work_item_id" = $1 AND "depends_on_work_item_id" = $2;`; params.push(work_item_id, depends_on_work_item_id);
        } else { throw new Error(`deleteRow: Cannot delete row ${recordId} from table "${tableName}". Unsupported table or key format.`); }

         try {
             const result = await dbClient.query(sql, params);
             if (result.rowCount === 0) logger.warn(`[WorkItemRepository] deleteRow: Row ${recordId} not found in ${tableName} during delete.`);
             else logger.debug(`[WorkItemRepository] Deleted row ${recordId} from ${tableName}.`);
         } catch (error: unknown) {
             logger.error(`[WorkItemRepository] Failed to delete row ${recordId} from ${tableName}:`, error); throw error;
         }
     }
}