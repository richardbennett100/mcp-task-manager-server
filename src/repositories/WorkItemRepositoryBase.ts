// src/repositories/WorkItemRepositoryBase.ts
import { Pool, PoolClient } from 'pg';
import { logger } from '../utils/logger.js';
import { validate as uuidValidate } from 'uuid';

// Interface for the unified Work Item data (keep in base for helpers)
export interface WorkItemData {
  work_item_id: string; // UUID
  parent_work_item_id: string | null; // UUID or null
  name: string; // TEXT NOT NULL
  shortname: string | null; // TEXT NULL
  description: string | null; // TEXT NULL
  status: 'todo' | 'in-progress' | 'review' | 'done';
  priority: 'high' | 'medium' | 'low';
  order_key: string | null; // TEXT NULL - for sorting
  created_at: string; // ISO String representation of TIMESTAMPTZ
  updated_at: string; // ISO String representation of TIMESTAMPTZ
  due_date: string | null; // ISO String representation of TIMESTAMPTZ or null
  is_active: boolean; // Flag for soft deletion
}

// Interface for dependency data (keep in base for helpers)
export interface WorkItemDependencyData {
  work_item_id: string; // UUID
  depends_on_work_item_id: string; // UUID
  dependency_type: 'finish-to-start' | 'linked';
  is_active: boolean; // Flag for soft deleting the dependency link
}

/**
 * Base class/utility container for WorkItemRepository helpers.
 * Contains shared properties, types, and helper methods.
 */
export class WorkItemRepositoryBase {
  protected pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /** Expose the pool instance if needed by services */
  public getPool(): Pool {
    return this.pool;
  }

  /** Safely gets a PoolClient, throwing if called without one in a context requiring it. */
  protected getClient(client?: PoolClient): PoolClient {
    if (!client) {
      logger.error('[WorkItemRepositoryBase] Transactional method called without a client.');
      throw new Error('Repository transactional method requires a client instance.');
    }
    return client;
  }

  // getClientOrPool removed as finder methods will now always use this.pool

  /** Helper function to map row data to WorkItemData */
  protected mapRowToWorkItemData(row: any): WorkItemData {
    // FIXME: Replace 'any' with a specific type for database rows if possible.
    return {
      work_item_id: row.work_item_id ?? null, // Should ideally not be null
      parent_work_item_id: row.parent_work_item_id ?? null,
      name: row.name ?? '',
      shortname: row.shortname ?? null,
      description: row.description ?? null,
      status: row.status ?? 'todo',
      priority: row.priority ?? 'medium',
      order_key: row.order_key ?? null,
      created_at:
        row.created_at instanceof Date ? row.created_at.toISOString() : (row.created_at ?? new Date().toISOString()),
      updated_at:
        row.updated_at instanceof Date ? row.updated_at.toISOString() : (row.updated_at ?? new Date().toISOString()),
      due_date: row.due_date === null ? null : row.due_date instanceof Date ? row.due_date.toISOString() : row.due_date,
      is_active: row.is_active === true, // Ensure boolean
    };
  }

  /** Helper function to map row data to WorkItemDependencyData */
  public mapRowToWorkItemDependencyData(row: any): WorkItemDependencyData {
    // FIXME: Replace 'any' with a specific type for database rows if possible.
    return {
      work_item_id: row.work_item_id ?? null,
      depends_on_work_item_id: row.depends_on_work_item_id ?? null,
      dependency_type: row.dependency_type ?? 'linked',
      is_active: row.is_active === true, // Ensure boolean
    };
  }

  /** Basic UUID validation helper */
  protected validateUuid(id: string | null | undefined, context: string): boolean {
    if (id && uuidValidate(id)) {
      return true;
    }
    if (id) {
      // Log only if an invalid non-empty ID was provided
      logger.warn(`[WorkItemRepositoryBase] Invalid UUID provided for ${context}: ${id}`);
    }
    return false;
  }
}
