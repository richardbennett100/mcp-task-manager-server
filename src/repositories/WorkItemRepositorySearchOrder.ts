// src/repositories/WorkItemRepositorySearchOrder.ts
import { Pool, PoolClient } from 'pg';
import { logger } from '../utils/logger.js';
import { WorkItemRepositoryBase, WorkItemData } from './WorkItemRepositoryBase.js';

/**
 * Handles search and order-related operations for Work Items.
 */
export class WorkItemRepositorySearchOrder extends WorkItemRepositoryBase {
  constructor(pool: Pool) {
    super(pool);
  }

  /**
   * Finds work items whose description or name matches a query string (case-insensitive).
   * Optionally filters by active status.
   */
  public async searchByNameOrDescription(
    query: string,
    filter?: { isActive?: boolean },
    client?: PoolClient
  ): Promise<WorkItemData[]> {
    const dbClient = this.getClientOrPool(client);

    let sql = ` SELECT * FROM work_items WHERE (name ILIKE $1 OR description ILIKE $1) `;
    const params: (string | boolean)[] = [`%${query}%`];
    let paramIndex = 2;

    const itemIsActive = filter?.isActive === undefined ? true : filter.isActive;
    sql += ` AND is_active = $${paramIndex++}`;
    params.push(itemIsActive);

    sql += ` ORDER BY updated_at DESC, created_at DESC;`; // Order by update time

    try {
      const result = await dbClient.query(sql, params);
      logger.debug(
        `[WorkItemRepositorySearchOrder] Found ${result.rows.length} items matching query "${query}" (active: ${itemIsActive}).`
      );
      return result.rows.map(this.mapRowToWorkItemData);
    } catch (error: unknown) {
      logger.error(`[WorkItemRepositorySearchOrder] Failed search for query "${query}":`, error);
      throw error;
    }
  }

  /**
   * Placeholder for fetching order keys of adjacent siblings.
   */
  public async getAdjacentOrderKeys(
    parentWorkItemId: string | null // Added type annotation
  ): Promise<{ before: string | null; after: string | null }> {
    // Basic validation
    if (parentWorkItemId !== null && !this.validateUuid(parentWorkItemId, 'getAdjacentOrderKeys parentId')) {
      logger.warn('[WorkItemRepositorySearchOrder] getAdjacentOrderKeys called with invalid parent UUID.');
      return { before: null, after: null };
    }

    // Placeholder Implementation
    logger.warn('[WorkItemRepositorySearchOrder] getAdjacentOrderKeys needs implementation!');
    // In a real implementation, you would query work_items table:
    // WHERE parent_work_item_id = parentWorkItemId (or IS NULL)
    // ORDER BY order_key
    // Find the item with currentOrderKey and return the keys of the items immediately before and after it.
    // This requires a robust order_key strategy (like LexoRank).
    return { before: null, after: null };
  }
}
