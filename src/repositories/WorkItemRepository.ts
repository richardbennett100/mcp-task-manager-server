import { Pool, PoolClient, QueryResult } from 'pg';
import { logger } from '../utils/logger.js';

// Interface for the unified Work Item data
export interface WorkItemData {
  work_item_id: string; // UUID
  parent_work_item_id: string | null; // UUID or null
  name: string; // TEXT NOT NULL
  shortname: string | null; // TEXT NULL
  description: string | null; // TEXT NULL
  status: 'todo' | 'in-progress' | 'review' | 'done' | 'deleted'; // Includes soft delete status
  priority: 'high' | 'medium' | 'low';
  order_key: string | null; // TEXT NULL - for sorting
  created_at: string; // ISO String representation of TIMESTAMPTZ
  updated_at: string; // ISO String representation of TIMESTAMPTZ
  due_date: string | null; // ISO String representation of TIMESTAMPTZ or null
}

// Interface for dependency data
export interface WorkItemDependencyData {
  work_item_id: string; // UUID
  depends_on_work_item_id: string; // UUID
  dependency_type: 'finish-to-start' | 'linked'; // New type field
}

// Helper function to map row data to WorkItemData, handling dates and nulls
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
    // Ensure due_date is null if DB returns null, or ISO string if Date
    due_date:
      row.due_date === null
        ? null
        : row.due_date instanceof Date
          ? row.due_date.toISOString()
          : row.due_date,
  };
}

export class WorkItemRepository {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Creates a new work item and its dependencies using a transaction.
   * Handles potential dependency insertion.
   * @param item - The core work item data.
   * @param dependencies - Optional list of dependencies to add.
   * @returns The created WorkItemData.
   */
  public async create(
    item: Omit<WorkItemData, 'created_at' | 'updated_at'>, // Input doesn't have timestamps
    dependencies?: Omit<WorkItemDependencyData, 'work_item_id'>[]
  ): Promise<WorkItemData> {
    const client: PoolClient = await this.pool.connect();
    const now = new Date().toISOString();
    const newItemData: WorkItemData = {
      ...item,
      created_at: now,
      updated_at: now,
    };

    logger.debug(
      `[WorkItemRepository] Starting transaction for creating item ${newItemData.work_item_id}`
    );
    try {
      await client.query('BEGIN');

      // Insert the main item
      const insertItemSql = `
                INSERT INTO work_items (
                    work_item_id, parent_work_item_id, name, shortname, description,
                    status, priority, order_key, created_at, updated_at, due_date
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                RETURNING *; -- Return the created row
            `;
      const itemParams = [
        newItemData.work_item_id,
        newItemData.parent_work_item_id,
        newItemData.name,
        newItemData.shortname,
        newItemData.description,
        newItemData.status,
        newItemData.priority,
        newItemData.order_key,
        newItemData.created_at,
        newItemData.updated_at,
        newItemData.due_date,
      ];
      const itemInsertResult = await client.query(insertItemSql, itemParams);

      if (itemInsertResult.rowCount !== 1) {
        throw new Error(
          `Failed to insert work item ${newItemData.work_item_id}. Row count: ${itemInsertResult.rowCount ?? 'null'}`
        );
      }
      const createdItem = mapRowToWorkItemData(itemInsertResult.rows[0]);

      // Insert dependencies if provided
      if (dependencies && dependencies.length > 0) {
        const insertDepSql = `
                    INSERT INTO work_item_dependencies (work_item_id, depends_on_work_item_id, dependency_type)
                    VALUES ($1, $2, $3)
                    ON CONFLICT(work_item_id, depends_on_work_item_id) DO NOTHING;
                `;
        for (const dep of dependencies) {
          await client.query(insertDepSql, [
            createdItem.work_item_id,
            dep.depends_on_work_item_id,
            dep.dependency_type, // Use provided type or rely on default 'finish-to-start'
          ]);
        }
      }

      await client.query('COMMIT');
      logger.info(
        `[WorkItemRepository] Created work item ${createdItem.work_item_id} with ${dependencies?.length ?? 0} dependencies (Transaction committed).`
      );
      return createdItem; // Return the full data of the created item
    } catch (error: unknown) {
      logger.error(
        `[WorkItemRepository] Error in transaction for creating item ${newItemData.work_item_id}, rolling back:`,
        error
      );
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
      logger.debug(
        `[WorkItemRepository] Released client after item creation attempt for ${newItemData.work_item_id}`
      );
    }
  }

  /**
   * Finds a single active work item by its ID.
   * @param workItemId UUID of the item to find.
   * @returns WorkItemData or undefined if not found or deleted.
   */
  public async findById(workItemId: string): Promise<WorkItemData | undefined> {
    const sql = `
            SELECT * FROM work_items
            WHERE work_item_id = $1 AND status != 'deleted';
        `;
    try {
      const result = await this.pool.query(sql, [workItemId]);
      if (result.rows.length === 0) {
        logger.debug(
          `[WorkItemRepository] Work item ${workItemId} not found or is deleted.`
        );
        return undefined;
      }
      logger.debug(`[WorkItemRepository] Found work item ${workItemId}.`);
      return mapRowToWorkItemData(result.rows[0]);
    } catch (error: unknown) {
      logger.error(
        `[WorkItemRepository] Failed to find work item ${workItemId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Finds all active root work items (projects).
   * @returns Array of WorkItemData for root items.
   */
  public async findRoots(): Promise<WorkItemData[]> {
    const sql = `
            SELECT * FROM work_items
            WHERE parent_work_item_id IS NULL AND status != 'deleted'
            ORDER BY order_key ASC, created_at ASC; -- Order roots
        `;
    try {
      const result = await this.pool.query(sql);
      logger.debug(
        `[WorkItemRepository] Found ${result.rows.length} root work items.`
      );
      return result.rows.map(mapRowToWorkItemData);
    } catch (error: unknown) {
      logger.error(
        `[WorkItemRepository] Failed to find root work items:`,
        error
      );
      throw error;
    }
  }

  /**
   * Finds all active direct children of a given parent work item.
   * @param parentWorkItemId UUID of the parent item.
   * @returns Array of WorkItemData for child items, ordered by order_key.
   */
  public async findChildren(parentWorkItemId: string): Promise<WorkItemData[]> {
    const sql = `
            SELECT * FROM work_items
            WHERE parent_work_item_id = $1 AND status != 'deleted'
            ORDER BY order_key ASC, created_at ASC; -- Order children
        `;
    try {
      const result = await this.pool.query(sql, [parentWorkItemId]);
      logger.debug(
        `[WorkItemRepository] Found ${result.rows.length} children for parent ${parentWorkItemId}.`
      );
      return result.rows.map(mapRowToWorkItemData);
    } catch (error: unknown) {
      logger.error(
        `[WorkItemRepository] Failed to find children for parent ${parentWorkItemId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Finds all active sibling work items (same parent, excluding self).
   * Used for shortname/order_key generation logic.
   * @param workItemId The ID of the item whose siblings are needed.
   * @param parentWorkItemId The parent ID (can be null for roots).
   * @returns Array of sibling WorkItemData.
   */
  public async findSiblings(
    workItemId: string,
    parentWorkItemId: string | null
  ): Promise<WorkItemData[]> {
    const sql =
      parentWorkItemId === null
        ? `SELECT * FROM work_items WHERE parent_work_item_id IS NULL AND work_item_id != $1 AND status != 'deleted' ORDER BY order_key ASC, created_at ASC;`
        : `SELECT * FROM work_items WHERE parent_work_item_id = $1 AND work_item_id != $2 AND status != 'deleted' ORDER BY order_key ASC, created_at ASC;`;

    const params =
      parentWorkItemId === null ? [workItemId] : [parentWorkItemId, workItemId];

    try {
      const result = await this.pool.query(sql, params);
      logger.debug(
        `[WorkItemRepository] Found ${result.rows.length} siblings for item ${workItemId}.`
      );
      return result.rows.map(mapRowToWorkItemData);
    } catch (error: unknown) {
      logger.error(
        `[WorkItemRepository] Failed to find siblings for item ${workItemId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Finds dependencies for a given work item.
   * @param workItemId UUID of the item.
   * @returns Array of WorkItemDependencyData.
   */
  public async findDependencies(
    workItemId: string
  ): Promise<WorkItemDependencyData[]> {
    const sql = `
            SELECT work_item_id, depends_on_work_item_id, dependency_type
            FROM work_item_dependencies
            WHERE work_item_id = $1;
        `;
    try {
      const result = await this.pool.query(sql, [workItemId]);
      logger.debug(
        `[WorkItemRepository] Found ${result.rows.length} dependencies for item ${workItemId}.`
      );
      // Assuming column names match interface directly here
      return result.rows;
    } catch (error: unknown) {
      logger.error(
        `[WorkItemRepository] Failed to find dependencies for item ${workItemId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Finds items that depend on the given work item (dependents).
   * @param dependsOnWorkItemId UUID of the item being depended on.
   * @returns Array of WorkItemDependencyData.
   */
  public async findDependents(
    dependsOnWorkItemId: string
  ): Promise<WorkItemDependencyData[]> {
    const sql = `
            SELECT work_item_id, depends_on_work_item_id, dependency_type
            FROM work_item_dependencies
            WHERE depends_on_work_item_id = $1;
            `;
    try {
      const result = await this.pool.query(sql, [dependsOnWorkItemId]);
      logger.debug(
        `[WorkItemRepository] Found ${result.rows.length} dependents for item ${dependsOnWorkItemId}.`
      );
      return result.rows;
    } catch (error: unknown) {
      logger.error(
        `[WorkItemRepository] Failed to find dependents for item ${dependsOnWorkItemId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Updates a work item and its dependencies within a transaction.
   * Allows updating various fields and replacing the entire dependency list.
   * @param workItemId UUID of the item to update.
   * @param updatePayload Object containing fields to update. Can include name, shortname, description, status, priority, order_key, parent_work_item_id, due_date.
   * @param newDependencies Optional array of dependencies to set (replaces old ones).
   * @returns The updated WorkItemData.
   */
  public async update(
    workItemId: string,
    updatePayload: Partial<
      Omit<WorkItemData, 'work_item_id' | 'created_at' | 'updated_at'>
    >, // Allow updating most fields
    newDependencies?: Omit<WorkItemDependencyData, 'work_item_id'>[] // Can update deps too
  ): Promise<WorkItemData> {
    const client: PoolClient = await this.pool.connect();
    logger.debug(
      `[WorkItemRepository] Starting transaction for updating item ${workItemId}`
    );
    try {
      await client.query('BEGIN');

      const now = new Date().toISOString();
      const setClauses: string[] = [];
      const params: (string | null | number | boolean)[] = []; // Adjust type as needed
      let paramIndex = 1;

      // Build SET clauses dynamically
      for (const key in updatePayload) {
        if (Object.prototype.hasOwnProperty.call(updatePayload, key)) {
          // Type assertion needed as key access isn't strictly typed here
          const typedKey = key as keyof typeof updatePayload;
          if (updatePayload[typedKey] !== undefined) {
            // Ensure value is not undefined
            setClauses.push(`${typedKey} = $${paramIndex++}`);
            // Handle potential date objects passed in payload if needed
            params.push(updatePayload[typedKey]);
          }
        }
      }

      // Always update updated_at timestamp
      setClauses.push(`updated_at = $${paramIndex++}`);
      params.push(now);

      // Add work_item_id for WHERE clause
      const workItemIdParamIndex = paramIndex++;
      params.push(workItemId);

      let updatedItem: WorkItemData | undefined;

      if (setClauses.length > 1) {
        // More than just updated_at
        const updateSql = `
                    UPDATE work_items
                    SET ${setClauses.join(', ')}
                    WHERE work_item_id = $${workItemIdParamIndex}
                    AND status != 'deleted' -- Only update active items? Or allow updating deleted? Assuming active only.
                    RETURNING *; -- Return updated row
                `;
        const updateResult = await client.query(updateSql, params);
        if (updateResult.rowCount === 0) {
          // Might be deleted or not found
          throw new Error(
            `Work item ${workItemId} not found, is deleted, or update failed.`
          );
        }
        updatedItem = mapRowToWorkItemData(updateResult.rows[0]);
        logger.debug(
          `[WorkItemRepository] Updated work item ${workItemId} fields.`
        );
      } else {
        logger.warn(
          `[WorkItemRepository] Update called for ${workItemId} with no fields to change other than timestamp.`
        );
        // If only timestamp changes, fetch current data
        const currentData = await client.query(
          'SELECT * FROM work_items WHERE work_item_id = $1',
          [workItemId]
        );
        if (currentData.rowCount === 0) {
          throw new Error(`Work item ${workItemId} not found.`);
        }
        updatedItem = mapRowToWorkItemData(currentData.rows[0]);
        // Manually update the timestamp in the returned object
        updatedItem.updated_at = now;
      }

      // Handle dependencies if provided (replaces existing)
      if (newDependencies !== undefined) {
        // 1. Delete existing dependencies
        const deleteDepsSql = `DELETE FROM work_item_dependencies WHERE work_item_id = $1`;
        const deleteInfo = await client.query(deleteDepsSql, [workItemId]);
        logger.debug(
          `[WorkItemRepository] Deleted ${deleteInfo.rowCount ?? 0} existing dependencies for item ${workItemId}.`
        );

        // 2. Insert new dependencies
        if (newDependencies.length > 0) {
          const insertDepSql = `
                        INSERT INTO work_item_dependencies (work_item_id, depends_on_work_item_id, dependency_type)
                        VALUES ($1, $2, $3)
                        ON CONFLICT(work_item_id, depends_on_work_item_id) DO NOTHING;
                    `;
          for (const dep of newDependencies) {
            await client.query(insertDepSql, [
              workItemId,
              dep.depends_on_work_item_id,
              dep.dependency_type,
            ]);
          }
          logger.debug(
            `[WorkItemRepository] Inserted ${newDependencies.length} new dependencies for item ${workItemId}.`
          );
        }
      }

      await client.query('COMMIT');
      logger.info(
        `[WorkItemRepository] Successfully updated item ${workItemId} (Transaction committed).`
      );

      if (!updatedItem) {
        // Should not happen with the logic above, but defensive check
        throw new Error(`Failed to retrieve updated data for ${workItemId}.`);
      }
      return updatedItem; // Return the latest data
    } catch (error: unknown) {
      logger.error(
        `[WorkItemRepository] Failed transaction for updating item ${workItemId}, rolling back:`,
        error
      );
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
      logger.debug(
        `[WorkItemRepository] Released client after item update attempt for ${workItemId}`
      );
    }
  }

  /**
   * Soft deletes one or more work items by setting their status to 'deleted'.
   * Does NOT physically delete rows. Does not cascade to children via FK.
   * @param workItemIds Array of UUIDs to soft delete.
   * @returns The number of items whose status was set to 'deleted'.
   */
  public async softDelete(workItemIds: string[]): Promise<number> {
    if (workItemIds.length === 0) {
      return 0;
    }
    const now = new Date().toISOString();
    // Generate placeholders: $2, $3, ...
    const placeholders = workItemIds.map((_, i) => `$${i + 2}`).join(',');
    const sql = `
            UPDATE work_items
            SET status = 'deleted', updated_at = $1
            WHERE work_item_id IN (${placeholders})
            AND status != 'deleted'; -- Avoid re-deleting or updating timestamp unnecessarily
        `;
    const params = [now, ...workItemIds];

    try {
      const result = await this.pool.query(sql, params);
      logger.info(
        `[WorkItemRepository] Soft deleted ${result.rowCount ?? 0} work items.`
      );
      return result.rowCount ?? 0;
    } catch (error: unknown) {
      logger.error(
        `[WorkItemRepository] Failed to soft delete work items:`,
        error
      );
      throw error;
    }
  }

  /**
   * Finds active work items whose description or name matches a query string (case-insensitive).
   * Basic LIKE search example. Full-text search would be more robust.
   * @param query The search string.
   * @returns Array of matching WorkItemData.
   */
  public async searchByNameOrDescription(
    query: string
  ): Promise<WorkItemData[]> {
    const sql = `
          SELECT * FROM work_items
          WHERE status != 'deleted'
          AND (
              name ILIKE $1 OR
              description ILIKE $1
          )
          ORDER BY created_at DESC; -- Or relevance if using full-text search
      `;
    const params = [`%${query}%`]; // Add wildcards for LIKE search
    try {
      const result = await this.pool.query(sql, params);
      logger.debug(
        `[WorkItemRepository] Found ${result.rows.length} items matching query "${query}".`
      );
      return result.rows.map(mapRowToWorkItemData);
    } catch (error: unknown) {
      logger.error(
        `[WorkItemRepository] Failed search for query "${query}":`,
        error
      );
      throw error;
    }
  }

  // --- Add other specific query methods as needed ---
  // e.g., findByStatus, findByPriority, findByDueDateRange, etc.
  // e.g., methods to get adjacent siblings for order_key calculation
  public async getAdjacentOrderKeys(
    parentWorkItemId: string | null,
    currentOrderKey: string | null
  ): Promise<{ before: string | null; after: string | null }> {
    // This logic needs careful implementation based on the chosen fractional indexing library/algorithm
    // For now, placeholder returning nulls
    logger.warn(
      '[WorkItemRepository] getAdjacentOrderKeys needs implementation!'
    );
    return { before: null, after: null };
    // Real implementation would query for the item immediately before/after the currentOrderKey *for the same parent*
  }
}
