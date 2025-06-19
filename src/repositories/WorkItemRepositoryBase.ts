// src/repositories/WorkItemRepositoryBase.ts
import { type Pool, type PoolClient } from 'pg';
import { logger } from '../utils/logger.js';
import { validate as uuidValidate } from 'uuid';

export interface WorkItemData {
  work_item_id: string;
  parent_work_item_id: string | null;
  name: string;
  //shortname: string | null; // Will be removed later, keep for now
  description: string | null;
  status: 'todo' | 'in-progress' | 'review' | 'done' | 'blocked';
  priority: 'high' | 'medium' | 'low';
  order_key: string | null;
  created_at: string;
  updated_at: string;
  due_date: string | null;
  is_active: boolean;
}

export interface WorkItemDependencyData {
  work_item_id: string;
  depends_on_work_item_id: string;
  dependency_type: 'finish-to-start' | 'linked';
  is_active: boolean;
  // This field is optional and only populated by specific queries (like findDependencies)
  depends_on_status?: WorkItemData['status'];
}

export class WorkItemRepositoryBase {
  protected pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  public getPool(): Pool {
    return this.pool;
  }

  // This helper is mainly for methods that *require* a client (writes)
  protected getClient(client?: PoolClient): PoolClient {
    if (!client) {
      logger.error('[WorkItemRepositoryBase] Transactional method called without a client.');
      throw new Error('Repository transactional method requires a client instance.');
    }
    return client;
  }

  protected mapRowToWorkItemData(row: any): WorkItemData {
    return {
      work_item_id: row.work_item_id ?? null,
      parent_work_item_id: row.parent_work_item_id ?? null,
      name: row.name ?? '',
      // shortname: row.shortname ?? null,
      description: row.description ?? null,
      status: row.status ?? 'todo',
      priority: row.priority ?? 'medium',
      order_key: row.order_key ?? null,
      created_at:
        row.created_at instanceof Date ? row.created_at.toISOString() : (row.created_at ?? new Date().toISOString()),
      updated_at:
        row.updated_at instanceof Date ? row.updated_at.toISOString() : (row.updated_at ?? new Date().toISOString()),
      due_date: row.due_date === null ? null : row.due_date instanceof Date ? row.due_date.toISOString() : row.due_date,
      is_active: row.is_active === true,
    };
  }

  public mapRowToWorkItemDependencyData(row: any): WorkItemDependencyData {
    const dependencyData: WorkItemDependencyData = {
      work_item_id: row.work_item_id ?? null,
      depends_on_work_item_id: row.depends_on_work_item_id ?? null,
      dependency_type: row.dependency_type ?? 'linked',
      is_active: row.is_active === true,
    };

    // Safely add the optional field if it exists on the row
    if (row.depends_on_status) {
      dependencyData.depends_on_status = row.depends_on_status;
    }

    return dependencyData;
  }

  protected validateUuid(id: string | null | undefined, context: string): boolean {
    if (id && uuidValidate(id)) {
      return true;
    }
    if (id) {
      logger.warn(`[WorkItemRepositoryBase] Invalid UUID provided for ${context}: ${id}`);
    }
    return false;
  }
}
