#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status.

echo "######################################################################"
echo "# Starting comprehensive file update/creation for Svelte UI POC      #"
echo "# ------------------------------------------------------------------ #"
echo "# IMPORTANT:                                                         #"
echo "# 1. Ensure you have backed up your existing 'src/' directory.       #"
echo "# 2. Run this script from the root of your project:                  #"
echo "#    /home/richard/repos/mcp-task-manager-server/                    #"
echo "# 3. After running, install/update type declarations:                #"
echo "#    npm i --save-dev @types/express @types/cors                     #"
echo "# 4. Navigate to 'ui/' and run 'pnpm install' (or npm/yarn).       #"
echo "######################################################################"
echo ""
read -p "Press Enter to continue if you have backed up your src/ directory, or Ctrl+C to cancel."

echo "Proceeding with file operations..."

# --- Backend Modifications (src/) ---
echo "Creating/Updating backend files in src/..."

mkdir -p src/services
mkdir -p src/api
mkdir -p src/repositories
mkdir -p src/config
mkdir -p src/db
mkdir -p src/scripts
mkdir -p src/tools
mkdir -p src/utils
mkdir -p src/services/__tests__/unit

# --- Type Definitions ---

# src/repositories/WorkItemRepositoryBase.ts
cat << 'EOF_SRC_REPOSITORIES_WORKITEMREPOSITORYBASE_TS' > src/repositories/WorkItemRepositoryBase.ts
// src/repositories/WorkItemRepositoryBase.ts
import { Pool, PoolClient } from 'pg';
import { validate as uuidValidate } from 'uuid';
import { ValidationError } from '../utils/errors.js'; // Assuming ValidationError is in utils

export interface WorkItemData {
  work_item_id: string;
  name: string;
  description: string | null;
  parent_work_item_id: string | null;
  status: string; 
  priority: string; 
  due_date: string | null;
  order_key: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  tags: string[] | null; 
}

export interface WorkItemDependencyData {
  work_item_id: string;
  depends_on_work_item_id: string;
  dependency_type: string;
  is_active: boolean;
}

export interface CreateActionHistoryInput {
  action_type: string;
  work_item_id: string | null; 
  description: string;
  user_id?: string | null; 
}

export interface ActionHistoryData extends CreateActionHistoryInput {
  action_id: string;
  timestamp: string;
  is_undone: boolean;
  undone_at_action_id: string | null;
}

export interface CreateUndoStepInput {
  step_order: number;
  step_type: 'UPDATE' | 'INSERT' | 'DELETE'; 
  table_name: string;
  record_id: string; 
  old_data: Record<string, any> | null; 
  new_data: Record<string, any> | null; 
}
export interface UndoStepData extends CreateUndoStepInput {
  undo_step_id: string;
  action_id: string;
}

export abstract class WorkItemRepositoryBase {
  protected pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  protected getClient(providedClient?: PoolClient): Pool | PoolClient {
    return providedClient || this.pool;
  }

  protected validateUuid(id: string, fieldName: string): void {
    if (!uuidValidate(id)) {
      throw new ValidationError(`Invalid UUID format for ${fieldName}: ${id}`);
    }
  }

  // Helper to map row data to WorkItemData, handling potential nulls for tags
  protected mapRowToWorkItemData(row: any): WorkItemData {
    return {
      work_item_id: row.work_item_id,
      name: row.name,
      description: row.description,
      parent_work_item_id: row.parent_work_item_id,
      status: row.status,
      priority: row.priority,
      due_date: row.due_date,
      order_key: row.order_key,
      is_active: row.is_active,
      created_at: row.created_at,
      updated_at: row.updated_at,
      tags: row.tags || null, // Ensure tags is null if db returns null, or [] if appropriate
    };
  }
  
  protected mapRowToWorkItemDependencyData(row: any): WorkItemDependencyData {
    return {
        work_item_id: row.work_item_id,
        depends_on_work_item_id: row.depends_on_work_item_id,
        dependency_type: row.dependency_type,
        is_active: row.is_active,
    };
  }


  public async withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
EOF_SRC_REPOSITORIES_WORKITEMREPOSITORYBASE_TS
echo "Generated src/repositories/WorkItemRepositoryBase.ts"

# src/services/WorkItemServiceTypes.ts
cat << 'EOF_SRC_SERVICES_WORKITEMSERVICETYPES_TS' > src/services/WorkItemServiceTypes.ts
// Modified: src/services/WorkItemServiceTypes.ts
import { z } from 'zod';
import type { WorkItemData as RepoWorkItemData, WorkItemDependencyData } from '../repositories/WorkItemRepositoryBase.js';

// ServiceWorkItemData mirrors RepoWorkItemData, including 'tags'
export interface ServiceWorkItemData extends RepoWorkItemData {
  // tags is already in RepoWorkItemData
}

export const WorkItemStatusEnum = z.enum(['todo', 'in-progress', 'review', 'done', 'blocked']);
export type WorkItemStatusType = z.infer<typeof WorkItemStatusEnum>;

export const WorkItemPriorityEnum = z.enum(['high', 'medium', 'low']);
export type WorkItemPriorityType = z.infer<typeof WorkItemPriorityEnum>;

export const PositionEnum = z.enum(['start', 'end']);
export type PositionType = z.infer<typeof PositionEnum>;

export interface AddWorkItemInput {
  name: string;
  description?: string | null;
  parent_work_item_id?: string | null;
  status?: WorkItemStatusType;
  priority?: WorkItemPriorityType;
  due_date?: string | null;
  tags?: string[] | null; 
  dependencies?: {
    depends_on_work_item_id: string;
    dependency_type?: 'finish-to-start' | 'linked';
  }[];
  insertAt?: PositionType;
  insertAfter_work_item_id?: string;
  insertBefore_work_item_id?: string;
}

export interface UpdateWorkItemInput extends Partial<Omit<ServiceWorkItemData, 
  'work_item_id' | 
  'created_at' | 
  'updated_at' | 
  'order_key' | 
  'parent_work_item_id' | 
  'is_active'
>> {
  // This allows updating: name, description, status, priority, due_date, tags
}

export interface ListWorkItemsFilter {
  parent_work_item_id?: string | null;
  is_active?: boolean;
  roots_only?: boolean;
  status?: WorkItemStatusType[]; 
  priority?: WorkItemPriorityType[]; 
}

export interface FullWorkItemData extends ServiceWorkItemData {
  dependencies: WorkItemDependencyData[] | null;
  children_count: number;
  dependents_count: number; 
}

export interface WorkItemTreeNode extends ServiceWorkItemData {
  children: WorkItemTreeNode[];
  dependencies: WorkItemDependencyData[] | null; 
  dependencies_info?: { depends_on_id: string; depends_on_name?: string; type: string }[]; 
}

export interface GetFullTreeOptions {
  includeDoneStatus?: boolean;
  includeInactive?: boolean;
  includeDependencies?: boolean;
}
EOF_SRC_SERVICES_WORKITEMSERVICETYPES_TS
echo "Generated src/services/WorkItemServiceTypes.ts"

# --- Repositories ---
# src/repositories/WorkItemRepositoryCRUD.ts
cat << 'EOF_SRC_REPOSITORIES_WORKITEMREPOSITORYCRUD_TS' > src/repositories/WorkItemRepositoryCRUD.ts
// Modified: src/repositories/WorkItemRepositoryCRUD.ts
import { PoolClient, Pool } from 'pg';
import { WorkItemData, WorkItemDependencyData, WorkItemRepositoryBase } from './WorkItemRepositoryBase.js';
import { FullWorkItemData } from '../../services/WorkItemServiceTypes.js'; 
import { NotFoundError } from '../utils/errors.js';
// Removed unused DatabaseError, logger

export class WorkItemRepositoryCRUD extends WorkItemRepositoryBase {
    // constructor is inherited from WorkItemRepositoryBase

    public async create( // Changed to public, removed underscore
        client: PoolClient,
        itemData: WorkItemData, 
        dependencies?: Omit<WorkItemDependencyData, 'is_active' | 'work_item_id'>[]
    ): Promise<WorkItemData> {
        const query = `
            INSERT INTO work_items (work_item_id, name, description, parent_work_item_id, status, priority, due_date, order_key, tags, is_active, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *;
        `;
        const values = [
            itemData.work_item_id,
            itemData.name,
            itemData.description,
            itemData.parent_work_item_id,
            itemData.status,
            itemData.priority,
            itemData.due_date,
            itemData.order_key,
            itemData.tags || null, // Ensure DB can handle null for empty array if needed, or send []
            itemData.is_active,
            itemData.created_at,
            itemData.updated_at,
        ];
        const result = await client.query(query, values);
        const newItem = this.mapRowToWorkItemData(result.rows[0]);

        if (dependencies && dependencies.length > 0) {
            const depQueries = dependencies.map(dep => {
                return client.query(
                    'INSERT INTO work_item_dependencies (work_item_id, depends_on_work_item_id, dependency_type, is_active) VALUES ($1, $2, $3, $4)',
                    [newItem.work_item_id, dep.depends_on_work_item_id, dep.dependency_type, true]
                );
            });
            await Promise.all(depQueries);
        }
        return newItem;
    }

    public async findById(id: string, filter?: { isActive?: boolean }, client?: PoolClient): Promise<WorkItemData | undefined> { // Changed to public
        const queryClient = this.getClient(client);
        let sql = 'SELECT * FROM work_items WHERE work_item_id = $1';
        const params: unknown[] = [id];
        if (filter && filter.isActive !== undefined) {
            sql += ' AND is_active = $2';
            params.push(filter.isActive);
        }
        const result = await queryClient.query(sql, params);
        return result.rows[0] ? this.mapRowToWorkItemData(result.rows[0]) : undefined;
    }

    public async findByIds(ids: string[], filter?: { isActive?: boolean }, client?: PoolClient): Promise<WorkItemData[]> { // Changed to public
        if (ids.length === 0) return [];
        const queryClient = this.getClient(client);
        let sql = 'SELECT * FROM work_items WHERE work_item_id = ANY($1::uuid[])';
        const params: unknown[] = [ids];
        if (filter && filter.isActive !== undefined) {
            sql += ' AND is_active = $2';
            params.push(filter.isActive);
        }
        const result = await queryClient.query(sql, params);
        return result.rows.map(row => this.mapRowToWorkItemData(row));
    }

    public async findFullWorkItemDataById(id: string, client?: PoolClient, filter?: { isActive?: boolean }): Promise<FullWorkItemData | null> { // Changed to public
        const queryClient = this.getClient(client);
        let itemSql = 'SELECT * FROM work_items WHERE work_item_id = $1';
        const params: unknown[] = [id];
        if (filter && filter.isActive !== undefined) {
            itemSql += ' AND is_active = $2';
            params.push(filter.isActive);
        }

        const itemResult = await queryClient.query(itemSql, params);
        if (itemResult.rows.length === 0) return null;
        const item = this.mapRowToWorkItemData(itemResult.rows[0]);

        const depsSql = 'SELECT * FROM work_item_dependencies WHERE work_item_id = $1 AND is_active = true';
        const depsResult = await queryClient.query(depsSql, [id]);
        const dependencies = depsResult.rows.map(row => this.mapRowToWorkItemDependencyData(row));
        
        const childrenCountSql = 'SELECT COUNT(*) AS count FROM work_items WHERE parent_work_item_id = $1 AND is_active = true';
        const childrenCountResult = await queryClient.query(childrenCountSql, [id]);
        const children_count = parseInt(childrenCountResult.rows[0].count, 10);

        const dependentsCountSql = 'SELECT COUNT(*) AS count FROM work_item_dependencies WHERE depends_on_work_item_id = $1 AND is_active = true';
        const dependentsCountResult = await queryClient.query(dependentsCountSql, [id]);
        const dependents_count = parseInt(dependentsCountResult.rows[0].count, 10);

        return {
            ...(item as ServiceWorkItemData), 
            dependencies: dependencies.length > 0 ? dependencies : null, 
            children_count,
            dependents_count
        };
    }

    public async findAll(filter: { parent_work_item_id?: string | null; is_active?: boolean; roots_only?: boolean, status?: string[], priority?: string[] }, client?: PoolClient): Promise<WorkItemData[]> { // Changed to public
        const queryClient = this.getClient(client);
        let sql = 'SELECT * FROM work_items WHERE 1=1';
        const params: unknown[] = [];
        let paramIndex = 1;

        if (filter.roots_only) {
            sql += ` AND parent_work_item_id IS NULL`;
        } else if (filter.parent_work_item_id !== undefined) { 
            if (filter.parent_work_item_id === null) {
                sql += ` AND parent_work_item_id IS NULL`;
            } else {
                sql += ` AND parent_work_item_id = $${paramIndex++}`;
                params.push(filter.parent_work_item_id);
            }
        }

        if (filter.is_active !== undefined) {
            sql += ` AND is_active = $${paramIndex++}`;
            params.push(filter.is_active);
        }
        if (filter.status && filter.status.length > 0) {
            sql += ` AND status = ANY($${paramIndex++}::text[])`;
            params.push(filter.status);
        }
        if (filter.priority && filter.priority.length > 0) {
            sql += ` AND priority = ANY($${paramIndex++}::text[])`;
            params.push(filter.priority);
        }

        sql += ' ORDER BY order_key ASC NULLS LAST'; 
        const result = await queryClient.query(sql, params);
        return result.rows.map(row => this.mapRowToWorkItemData(row));
    }

    public async update(client: PoolClient, id: string, updates: Partial<Omit<WorkItemData, 'work_item_id' | 'created_at'>>): Promise<WorkItemData> { // Changed to public
        const setClauses = Object.keys(updates)
            .map((key, i) => `"${key}" = $${i + 1}`)
            .join(', ');
        const values = Object.values(updates);

        if (setClauses.length === 0) {
            const currentItem = await this.findById(id, {isActive: undefined}, client); 
            if (!currentItem) throw new NotFoundError(`Work item with ID ${id} not found for no-op update.`);
            return currentItem;
        }

        const query = `UPDATE work_items SET ${setClauses} WHERE work_item_id = $${values.length + 1} RETURNING *;`;
        const result = await client.query(query, [...values, id]);
        if (result.rowCount === 0) {
            throw new NotFoundError(`Work item with ID ${id} not found during update, or no rows affected.`);
        }
        return this.mapRowToWorkItemData(result.rows[0]);
    }

    public async findDependenciesForItems(itemIds: string[], filter?: { isActive?: boolean }, client?: PoolClient): Promise<WorkItemDependencyData[]> { // Changed to public
        if (itemIds.length === 0) return [];
        const queryClient = this.getClient(client);
        let sql = 'SELECT * FROM work_item_dependencies WHERE work_item_id = ANY($1::uuid[])';
        const params: unknown[] = [itemIds];
        let paramIndex = 2;
        if (filter && filter.isActive !== undefined) {
            sql += ` AND is_active = $${paramIndex++}`;
            params.push(filter.isActive);
        }
        const result = await queryClient.query(sql, params);
        return result.rows.map(row => this.mapRowToWorkItemDependencyData(row));
    }
}
// Added for casting in findFullWorkItemDataById
interface ServiceWorkItemData extends WorkItemData {}
EOF_SRC_REPOSITORIES_WORKITEMREPOSITORYCRUD_TS
echo "Generated src/repositories/WorkItemRepositoryCRUD.ts"

# src/repositories/WorkItemRepository.ts
# This file was refactored to directly use public methods from base parts.
# The "Concrete" helper classes are removed as the base parts (CRUD, Hierarchy etc.)
# will now have public methods for what WorkItemRepository needs.
cat << 'EOF_SRC_REPOSITORIES_WORKITEMREPOSITORY_TS' > src/repositories/WorkItemRepository.ts
// Modified src/repositories/WorkItemRepository.ts
import { Pool, PoolClient } from 'pg';
import { WorkItemRepositoryBase, WorkItemData, WorkItemDependencyData } from './WorkItemRepositoryBase.js';
import { FullWorkItemData } from '../services/WorkItemServiceTypes.js'; 

import { WorkItemRepositoryCRUD } from './WorkItemRepositoryCRUD.js'; 
import { WorkItemRepositoryHierarchy } from './WorkItemRepositoryHierarchy.js';
import { WorkItemRepositorySearchOrder } from './WorkItemRepositorySearchOrder.js';
import { WorkItemRepositoryDependencies } from './WorkItemRepositoryDependencies.js';

export class WorkItemRepository extends WorkItemRepositoryBase {
    // These will be instances of the actual repository parts
    private crudPart: WorkItemRepositoryCRUD;
    private hierarchyPart: WorkItemRepositoryHierarchy;
    private searchOrderPart: WorkItemRepositorySearchOrder;
    private dependenciesPart: WorkItemRepositoryDependencies;

    constructor(pool: Pool) {
        super(pool);
        // Instantiate the parts. They inherit from WorkItemRepositoryBase so they get the pool.
        this.crudPart = new (class extends WorkItemRepositoryCRUD {})(pool);
        this.hierarchyPart = new (class extends WorkItemRepositoryHierarchy {})(pool);
        this.searchOrderPart = new (class extends WorkItemRepositorySearchOrder {})(pool);
        this.dependenciesPart = new (class extends WorkItemRepositoryDependencies {})(pool);
    }

    // CRUD Operations - delegate to public methods of crudPart
    public async create(client: PoolClient, itemData: WorkItemData, dependencies?: Omit<WorkItemDependencyData, 'is_active' | 'work_item_id'>[]): Promise<WorkItemData> {
        return this.crudPart.create(client, itemData, dependencies);
    }
    public async findById(id: string, filter?: { isActive?: boolean }, client?: PoolClient): Promise<WorkItemData | undefined> {
        return this.crudPart.findById(id, filter, client);
    }
    public async findByIds(ids: string[], filter?: { isActive?: boolean }, client?: PoolClient): Promise<WorkItemData[]> {
        return this.crudPart.findByIds(ids, filter, client);
    }
    public async findFullWorkItemDataById(id: string, client?: PoolClient, filter?: { isActive?: boolean }): Promise<FullWorkItemData | null> {
        return this.crudPart.findFullWorkItemDataById(id, client, filter);
    }
    public async findAll(filter: { parent_work_item_id?: string | null; is_active?: boolean; roots_only?: boolean, status?: string[], priority?: string[] }, client?: PoolClient): Promise<WorkItemData[]> {
        return this.crudPart.findAll(filter, client);
    }
    public async update(client: PoolClient, id: string, updates: Partial<Omit<WorkItemData, 'work_item_id' | 'created_at'>>): Promise<WorkItemData> {
        return this.crudPart.update(client, id, updates);
    }
    public async findDependenciesForItems(itemIds: string[], filter?: { isActive?: boolean }, client?: PoolClient): Promise<WorkItemDependencyData[]> {
        return this.crudPart.findDependenciesForItems(itemIds, filter, client);
    }

    // Hierarchy Operations
    public async findAllDescendants(parentId: string, client?: PoolClient): Promise<WorkItemData[]> {
        return this.hierarchyPart.findAllDescendants(parentId, client);
    }
    public async getParent(childId: string, client?: PoolClient): Promise<WorkItemData | null> {
        return this.hierarchyPart.getParent(childId, client);
    }
    public async getRootAncestor(itemId: string, client?: PoolClient): Promise<WorkItemData | null> {
        return this.hierarchyPart.getRootAncestor(itemId, client);
    }

    // Search and Order Operations
    public async findCandidateTasksForSuggestion(filters: { scopeItemId?: string | null; includeTags?: string[]; excludeTags?: string[] }, client?: PoolClient): Promise<WorkItemData[]> {
        return this.searchOrderPart.findCandidateTasksForSuggestion(filters, client);
    }
    public async findSiblingEdgeOrderKey(parentId: string | null, position: 'first' | 'last', client?: PoolClient): Promise<string | null> {
        return this.searchOrderPart.findSiblingEdgeOrderKey(parentId, position, client);
    }
    public async findNeighbourOrderKeys(parentId: string | null, siblingId: string, relativePosition: 'before' | 'after', client?: PoolClient): Promise<{ before: string | null; after: string | null }> {
        return this.searchOrderPart.findNeighbourOrderKeys(parentId, siblingId, relativePosition, client);
    }

    // Dependency Operations
    public async addDependency(client: PoolClient, dependencyData: WorkItemDependencyData): Promise<void> {
        return this.dependenciesPart.addDependency(client, dependencyData);
    }
    public async removeDependency(client: PoolClient, workItemId: string, dependsOnWorkItemId: string): Promise<boolean> {
        return this.dependenciesPart.removeDependency(client, workItemId, dependsOnWorkItemId);
    }
    public async findDependencies(workItemId: string, filter?: { isActive?: boolean }, client?: PoolClient): Promise<WorkItemDependencyData[]> {
        return this.dependenciesPart.findDependencies(workItemId, filter, client);
    }
    public async findDependents(workItemId: string, filter?: { isActive?: boolean }, client?: PoolClient): Promise<WorkItemDependencyData[]> {
        return this.dependenciesPart.findDependents(workItemId, filter, client);
    }
    public async findSpecificDependency(workItemId: string, dependsOnWorkItemId: string, filter?: { isActive?: boolean }, client?: PoolClient): Promise<WorkItemDependencyData | undefined> {
        return this.dependenciesPart.findSpecificDependency(workItemId, dependsOnWorkItemId, filter, client);
    }
}
EOF_SRC_REPOSITORIES_WORKITEMREPOSITORY_TS
echo "Generated src/repositories/WorkItemRepository.ts"

# Stubs for other repository parts to make them have public methods if they only had protected
# src/repositories/WorkItemRepositoryDependencies.ts
cat << 'EOF_SRC_REPOSITORIES_WORKITEMREPOSITORYDEPENDENCIES_TS' > src/repositories/WorkItemRepositoryDependencies.ts
// Modified: src/repositories/WorkItemRepositoryDependencies.ts
import { PoolClient, Pool } from 'pg';
import { WorkItemDependencyData, WorkItemRepositoryBase } from './WorkItemRepositoryBase.js';
import { NotFoundError, DatabaseError, ValidationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { validate as uuidValidate } from 'uuid'; // Import for direct use if not from base

export class WorkItemRepositoryDependencies extends WorkItemRepositoryBase {
    // constructor is inherited

    // Making protected methods public for WorkItemRepository to call
    public async addDependency(client: PoolClient, dependencyData: WorkItemDependencyData): Promise<void> {
        this.validateUuid(dependencyData.work_item_id, 'work_item_id');
        this.validateUuid(dependencyData.depends_on_work_item_id, 'depends_on_work_item_id');
        
        const query = `
            INSERT INTO work_item_dependencies (work_item_id, depends_on_work_item_id, dependency_type, is_active)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (work_item_id, depends_on_work_item_id) DO UPDATE SET
                dependency_type = EXCLUDED.dependency_type,
                is_active = EXCLUDED.is_active,
                updated_at = CURRENT_TIMESTAMP;
        `;
        await client.query(query, [
            dependencyData.work_item_id,
            dependencyData.depends_on_work_item_id,
            dependencyData.dependency_type,
            dependencyData.is_active,
        ]);
    }

    public async removeDependency(client: PoolClient, workItemId: string, dependsOnWorkItemId: string): Promise<boolean> {
        this.validateUuid(workItemId, 'work_item_id');
        this.validateUuid(dependsOnWorkItemId, 'depends_on_work_item_id');
        // Instead of deleting, mark as inactive for history/undo purposes
        const query = 'UPDATE work_item_dependencies SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE work_item_id = $1 AND depends_on_work_item_id = $2 AND is_active = true RETURNING *;';
        const result = await client.query(query, [workItemId, dependsOnWorkItemId]);
        return result.rowCount > 0;
    }
    
    public async findDependencies(workItemId: string, filter?: { isActive?: boolean }, client?: PoolClient): Promise<WorkItemDependencyData[]> {
        this.validateUuid(workItemId, 'work_item_id');
        const queryClient = this.getClient(client);
        let sql = 'SELECT * FROM work_item_dependencies WHERE work_item_id = $1';
        const params: unknown[] = [workItemId];
        if (filter && filter.isActive !== undefined) {
            sql += ' AND is_active = $2';
            params.push(filter.isActive);
        }
        const result = await queryClient.query(sql, params);
        return result.rows.map(row => this.mapRowToWorkItemDependencyData(row));
    }

    public async findDependents(workItemId: string, filter?: { isActive?: boolean }, client?: PoolClient): Promise<WorkItemDependencyData[]> {
        this.validateUuid(workItemId, 'depends_on_work_item_id');
        const queryClient = this.getClient(client);
        let sql = 'SELECT * FROM work_item_dependencies WHERE depends_on_work_item_id = $1';
        const params: unknown[] = [workItemId];
        if (filter && filter.isActive !== undefined) {
            sql += ' AND is_active = $2';
            params.push(filter.isActive);
        }
        const result = await queryClient.query(sql, params);
        return result.rows.map(row => this.mapRowToWorkItemDependencyData(row));
    }
    
    public async findSpecificDependency(workItemId: string, dependsOnWorkItemId: string, filter?: {isActive?: boolean}, client?: PoolClient): Promise<WorkItemDependencyData | undefined> {
        this.validateUuid(workItemId, 'work_item_id');
        this.validateUuid(dependsOnWorkItemId, 'depends_on_work_item_id');
        const queryClient = this.getClient(client);
        let sql = 'SELECT * FROM work_item_dependencies WHERE work_item_id = $1 AND depends_on_work_item_id = $2';
        const params: unknown[] = [workItemId, dependsOnWorkItemId];
         if (filter && filter.isActive !== undefined) {
            sql += ' AND is_active = $3';
            params.push(filter.isActive);
        }
        const result = await queryClient.query(sql, params);
        return result.rows[0] ? this.mapRowToWorkItemDependencyData(result.rows[0]) : undefined;
    }
}
EOF_SRC_REPOSITORIES_WORKITEMREPOSITORYDEPENDENCIES_TS
echo "Generated src/repositories/WorkItemRepositoryDependencies.ts"

# src/repositories/WorkItemRepositoryHierarchy.ts
cat << 'EOF_SRC_REPOSITORIES_WORKITEMREPOSITORYHIERARCHY_TS' > src/repositories/WorkItemRepositoryHierarchy.ts
// Modified: src/repositories/WorkItemRepositoryHierarchy.ts
import { PoolClient, Pool } from 'pg';
import { WorkItemData, WorkItemRepositoryBase } from './WorkItemRepositoryBase.js';
import { NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { validate as uuidValidate } from 'uuid';


export class WorkItemRepositoryHierarchy extends WorkItemRepositoryBase {
   // constructor inherited

    public async findAllDescendants(parentId: string, client?: PoolClient): Promise<WorkItemData[]> {
        this.validateUuid(parentId, 'parentId');
        const queryClient = this.getClient(client);
        const query = `
            WITH RECURSIVE descendants AS (
                SELECT * FROM work_items WHERE work_item_id = $1
                UNION ALL
                SELECT w.* FROM work_items w
                INNER JOIN descendants d ON w.parent_work_item_id = d.work_item_id
            )
            SELECT * FROM descendants WHERE work_item_id != $1; -- Exclude the parent itself
        `;
        const result = await queryClient.query(query, [parentId]);
        return result.rows.map(row => this.mapRowToWorkItemData(row));
    }

    public async getParent(childId: string, client?: PoolClient): Promise<WorkItemData | null> {
        this.validateUuid(childId, 'childId');
        const queryClient = this.getClient(client);
        const childItem = await queryClient.query('SELECT parent_work_item_id FROM work_items WHERE work_item_id = $1', [childId]);
        if (childItem.rows.length === 0 || !childItem.rows[0].parent_work_item_id) {
            return null;
        }
        const parentResult = await queryClient.query('SELECT * FROM work_items WHERE work_item_id = $1', [childItem.rows[0].parent_work_item_id]);
        return parentResult.rows[0] ? this.mapRowToWorkItemData(parentResult.rows[0]) : null;
    }
    
    public async getRootAncestor(itemId: string, client?: PoolClient): Promise<WorkItemData | null> {
        this.validateUuid(itemId, 'itemId');
        const queryClient = this.getClient(client);
        const query = `
            WITH RECURSIVE ancestors AS (
                SELECT *, 1 as depth FROM work_items WHERE work_item_id = $1
                UNION ALL
                SELECT w.*, a.depth + 1 FROM work_items w
                INNER JOIN ancestors a ON w.work_item_id = a.parent_work_item_id
            )
            SELECT * FROM ancestors WHERE parent_work_item_id IS NULL;
        `;
        const result = await queryClient.query(query, [itemId]);
        if (result.rows.length > 0) {
            // If the item itself is a root, it will be returned.
            // If it has ancestors, the true root will be returned.
            return this.mapRowToWorkItemData(result.rows[0]);
        }
        return null; // Should not happen if item exists, means item itself is root and was selected
    }
}
EOF_SRC_REPOSITORIES_WORKITEMREPOSITORYHIERARCHY_TS
echo "Generated src/repositories/WorkItemRepositoryHierarchy.ts"

# src/repositories/WorkItemRepositorySearchOrder.ts
cat << 'EOF_SRC_REPOSITORIES_WORKITEMREPOSITORYSEARCHORDER_TS' > src/repositories/WorkItemRepositorySearchOrder.ts
// Modified: src/repositories/WorkItemRepositorySearchOrder.ts
import { PoolClient, Pool } from 'pg';
import { WorkItemData, WorkItemRepositoryBase } from './WorkItemRepositoryBase.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { validate as uuidValidate } from 'uuid';

export class WorkItemRepositorySearchOrder extends WorkItemRepositoryBase {
    // constructor inherited

    public async findCandidateTasksForSuggestion(
        filters: { scopeItemId?: string | null; includeTags?: string[]; excludeTags?: string[] },
        client?: PoolClient
    ): Promise<WorkItemData[]> {
        const queryClient = this.getClient(client);
        let sql = `
            SELECT DISTINCT wi.*
            FROM work_items wi
        `;
        const conditions: string[] = [];
        const params: any[] = [];
        let paramIndex = 1;

        if (filters.scopeItemId) {
            this.validateUuid(filters.scopeItemId, 'scopeItemId');
            // Find all descendants of scopeItemId, including scopeItemId itself
            sql += `
                JOIN (
                    WITH RECURSIVE project_tree AS (
                        SELECT work_item_id FROM work_items WHERE work_item_id = $${paramIndex++}
                        UNION ALL
                        SELECT c.work_item_id FROM work_items c JOIN project_tree pt ON c.parent_work_item_id = pt.work_item_id
                    )
                    SELECT work_item_id FROM project_tree
                ) AS scope ON wi.work_item_id = scope.work_item_id
            `;
            params.push(filters.scopeItemId);
        }
        
        conditions.push("wi.is_active = true");
        conditions.push("wi.status <> 'done'"); // Exclude 'done' tasks

        if (filters.includeTags && filters.includeTags.length > 0) {
            conditions.push(`wi.tags @> $${paramIndex++}`); // PostgreSQL array contains operator
            params.push(filters.includeTags);
        }
        if (filters.excludeTags && filters.excludeTags.length > 0) {
            conditions.push(`NOT (wi.tags && $${paramIndex++})`); // PostgreSQL array overlap operator
            params.push(filters.excludeTags);
        }
        
        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }
        sql += ' ORDER BY wi.priority ASC, wi.due_date ASC NULLS LAST, wi.updated_at DESC LIMIT 100;'; // Example ordering and limit

        const result = await queryClient.query(sql, params);
        return result.rows.map(row => this.mapRowToWorkItemData(row));
    }


    public async findSiblingEdgeOrderKey(parentId: string | null, position: 'first' | 'last', client?: PoolClient): Promise<string | null> {
        if (parentId) this.validateUuid(parentId, 'parentId for sibling edge key');
        const queryClient = this.getClient(client);
        const orderDirection = position === 'first' ? 'ASC' : 'DESC';
        let sql = `
            SELECT order_key FROM work_items 
            WHERE ${parentId ? 'parent_work_item_id = $1' : 'parent_work_item_id IS NULL'}
            AND is_active = true
            ORDER BY order_key ${orderDirection} NULLS ${position === 'first' ? 'FIRST' : 'LAST'} 
            LIMIT 1;
        `;
        const params = parentId ? [parentId] : [];
        const result = await queryClient.query(sql, params);
        return result.rows[0]?.order_key || null;
    }

    public async findNeighbourOrderKeys(
        parentId: string | null,
        siblingId: string,
        relativePosition: 'before' | 'after',
        client?: PoolClient
    ): Promise<{ before: string | null; after: string | null }> {
        if (parentId) this.validateUuid(parentId, 'parentId for neighbour keys');
        this.validateUuid(siblingId, 'siblingId for neighbour keys');

        const queryClient = this.getClient(client);
        const sibling = await queryClient.query('SELECT order_key FROM work_items WHERE work_item_id = $1 AND is_active = true', [siblingId]);
        if (sibling.rows.length === 0) {
            throw new NotFoundError(`Sibling work item with ID ${siblingId} not found or inactive.`);
        }
        const siblingOrderKey = sibling.rows[0].order_key;

        let beforeKey: string | null = null;
        let afterKey: string | null = null;

        const parentCondition = parentId ? 'parent_work_item_id = $1' : 'parent_work_item_id IS NULL';
        const baseParams = parentId ? [parentId] : [];

        if (relativePosition === 'after') {
            beforeKey = siblingOrderKey;
            const afterResult = await queryClient.query(
                `SELECT order_key FROM work_items 
                 WHERE ${parentCondition} AND order_key > $${baseParams.length + 1} AND is_active = true 
                 ORDER BY order_key ASC LIMIT 1`,
                [...baseParams, siblingOrderKey]
            );
            afterKey = afterResult.rows[0]?.order_key || null;
        } else { // 'before'
            afterKey = siblingOrderKey;
            const beforeResult = await queryClient.query(
                `SELECT order_key FROM work_items 
                 WHERE ${parentCondition} AND order_key < $${baseParams.length + 1} AND is_active = true
                 ORDER BY order_key DESC LIMIT 1`,
                [...baseParams, siblingOrderKey]
            );
            beforeKey = beforeResult.rows[0]?.order_key || null;
        }
        return { before: beforeKey, after: afterKey };
    }
}
EOF_SRC_REPOSITORIES_WORKITEMREPOSITORYSEARCHORDER_TS
echo "Generated src/repositories/WorkItemRepositorySearchOrder.ts"

# src/repositories/WorkItemRepositoryUndoRedo.ts
cat << 'EOF_SRC_REPOSITORIES_WORKITEMREPOSITORYUNDOREDO_TS' > src/repositories/WorkItemRepositoryUndoRedo.ts
// Modified: src/repositories/WorkItemRepositoryUndoRedo.ts
// This class seems to be a part of ActionHistoryRepository structure
// and might not be directly composed into WorkItemRepository if its methods are specific to ActionHistory.
// Assuming it's a base or utility for ActionHistoryRepository.
// The errors were about getClient, which is now in WorkItemRepositoryBase.
import { PoolClient, Pool } from 'pg';
import { ActionHistoryData, CreateActionHistoryInput, UndoStepData, CreateUndoStepInput, WorkItemRepositoryBase } from './WorkItemRepositoryBase.js';
import { logger } from '../utils/logger.js';

export class WorkItemRepositoryUndoRedo extends WorkItemRepositoryBase {
   // constructor is inherited.
   // This class might not be needed if ActionHistoryRepository handles its own logic
   // without this specific intermediate class. The original design had ActionHistoryRepositoryBase,
   // ActionHistoryRepositoryActions, and ActionHistoryRepositorySteps.
}
EOF_SRC_REPOSITORIES_WORKITEMREPOSITORYUNDOREDO_TS
echo "Generated src/repositories/WorkItemRepositoryUndoRedo.ts"


# --- Server and Tools ---
# src/server.ts
cat << 'EOF_SRC_SERVER_TS' > src/server.ts
// Modified src/server.ts
import { createServer } from './createServer.js';
import { ConfigurationManager } from './config/ConfigurationManager.js';
import { logger } from './utils/logger.js';
import { DatabaseManager } from './db/DatabaseManager.js';

async function start() {
  try {
    const configManager = ConfigurationManager.getInstance();
    const port = parseInt(configManager.get('PORT') || '3000', 10); // Ensure port is a number

    await DatabaseManager.getInstance(); 
    logger.info('Database connection established and schema checked/applied.');

    const app = await createServer(); // createServer is async
    
    app.listen(port, () => {
      logger.info(`Server listening on http://localhost:${port}`);
      logger.info(`MCP endpoint available at http://localhost:${port}/mcp`);
      logger.info(`API endpoints available under http://localhost:${port}/api`);
      logger.info(`SSE endpoint available at http://localhost:${port}/api/events`);
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
EOF_SRC_SERVER_TS
echo "Generated src/server.ts"

# src/tools/index.ts
# This ensures initializeTools is exported and tools accept WorkItemService
cat << 'EOF_SRC_TOOLS_INDEX_TS' > src/tools/index.ts
// src/tools/index.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WorkItemService } from '../services/WorkItemService.js';
import { logger } from '../utils/logger.js'; 

import { addChildTasksTool } from './add_child_tasks_tool.js';
import { addDependenciesTool } from './add_dependencies_tool.js';
import { addTaskTool } from './add_task_tool.js';
import { createProjectTool } from './create_project_tool.js';
import { deleteChildTasksTool } from './delete_child_tasks_tool.js';
import { deleteDependenciesTool } from './delete_dependencies_tool.js';
import { deleteProjectTool } from './delete_project_tool.js';
import { deleteTaskTool } from './delete_task_tool.js';
import { exportProjectTool } from './export_project_tool.js';
import { getDetailsTool } from './get_details_tool.js';
import { getFullTreeTool } from './get_full_tree_tool.js';
import { getNextTaskTool } from './get_next_task_tool.js';
import { importProjectTool } from './import_project_tool.js';
import { listHistoryTool } from './list_history_tool.js';
import { listWorkItemsTool } from './list_work_items_tool.js';
import { moveItemAfterTool } from './move_item_after_tool.js';
import { moveItemBeforeTool } from './move_item_before_tool.js';
import { moveItemToEndTool } from './move_item_to_end_tool.js';
import { moveItemToStartTool } from './move_item_to_start_tool.js';
import { promoteToProjectTool } from './promote_to_project_tool.js';
import { redoLastActionTool } from './redo_last_action_tool.js';
import { setDescriptionTool } from './set_description_tool.js';
import { setDueDateTool } from './set_due_date_tool.js';
import { setNameTool } from './set_name_tool.js';
import { setPriorityTool } from './set_priority_tool.js';
import { setStatusTool } from './set_status_tool.js';
import { undoLastActionTool } from './undo_last_action_tool.js';

export function initializeTools(mcpServer: McpServer, workItemService: WorkItemService): void {
  addChildTasksTool(mcpServer, workItemService); 
  addDependenciesTool(mcpServer, workItemService);
  addTaskTool(mcpServer, workItemService);
  createProjectTool(mcpServer, workItemService);
  deleteChildTasksTool(mcpServer, workItemService);
  deleteDependenciesTool(mcpServer, workItemService);
  deleteProjectTool(mcpServer, workItemService);
  deleteTaskTool(mcpServer, workItemService);
  exportProjectTool(mcpServer, workItemService);
  getDetailsTool(mcpServer, workItemService);
  getFullTreeTool(mcpServer, workItemService);
  getNextTaskTool(mcpServer, workItemService);
  importProjectTool(mcpServer, workItemService);
  listHistoryTool(mcpServer, workItemService);
  listWorkItemsTool(mcpServer, workItemService);
  moveItemAfterTool(mcpServer, workItemService);
  moveItemBeforeTool(mcpServer, workItemService);
  moveItemToEndTool(mcpServer, workItemService);
  moveItemToStartTool(mcpServer, workItemService);
  promoteToProjectTool(mcpServer, workItemService);
  redoLastActionTool(mcpServer, workItemService);
  setDescriptionTool(mcpServer, workItemService);
  setDueDateTool(mcpServer, workItemService);
  setNameTool(mcpServer, workItemService);
  setPriorityTool(mcpServer, workItemService);
  setStatusTool(mcpServer, workItemService);
  undoLastActionTool(mcpServer, workItemService);
  
  logger.info('All tools initialized and registered with MCP Server.');
}
EOF_SRC_TOOLS_INDEX_TS
echo "Generated src/tools/index.ts"

# --- Stub for one tool file to show WorkItemService constructor change ---
# src/tools/add_task_tool.ts (Example tool update)
cat << 'EOF_SRC_TOOLS_ADD_TASK_TOOL_TS' > src/tools/add_task_tool.ts
// Modified src/tools/add_task_tool.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAME, TOOL_DESCRIPTION, AddTaskParamsSchema, AddTaskArgs } from './add_task_params.js';
import { logger } from '../utils/logger.js';
import { DatabaseManager } from '../db/DatabaseManager.js'; // Keep if used for direct pool access
import { WorkItemRepository, ActionHistoryRepository } from '../repositories/index.js';
import { WorkItemService } from '../services/WorkItemService.js';
// import { WorkItemHistoryService } from '../services/WorkItemHistoryService.js'; // Not needed if WorkItemService passed in
// import sseNotificationServiceSingleton from '../services/SseNotificationService.js'; // For direct instantiation if needed

// Updated to accept WorkItemService instance
export const addTaskTool = (server: McpServer, workItemServiceInstance: WorkItemService): void => {
  const processRequest = async (args: AddTaskArgs): Promise<{ content: { type: 'text'; text: string }[] }> => {
    logger.info(`[${TOOL_NAME}] Received request:`, args);

    try {
      // Use the passed workItemServiceInstance directly
      // const dbManager = await DatabaseManager.getInstance(); // No longer needed if not using pool directly
      // const pool = dbManager.getPool();
      // const workItemRepository = new WorkItemRepository(pool);
      // const actionHistoryRepository = new ActionHistoryRepository(pool);
      // const historyService = new WorkItemHistoryService(workItemRepository, actionHistoryRepository);
      // const workItemService = new WorkItemService(workItemRepository, actionHistoryRepository, SseNotificationServiceSingleton);

      const { parent_work_item_id, name, description, status, priority, due_date, tags, dependencies, insertAt, insertAfter_work_item_id, insertBefore_work_item_id } = args;
      
      const newWorkItem = await workItemServiceInstance.addWorkItem({
        parent_work_item_id,
        name,
        description,
        status,
        priority,
        due_date,
        tags,
        dependencies,
        insertAt,
        insertAfter_work_item_id,
        insertBefore_work_item_id,
      });

      logger.info(`[${TOOL_NAME}] Successfully added task: ${newWorkItem.name} (ID: ${newWorkItem.work_item_id})`);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(newWorkItem) }],
      };
    } catch (error: unknown) {
      logger.error(`[${TOOL_NAME}] Error processing request:`, error);
      if (error instanceof McpError) throw error;
      const message = error instanceof Error ? error.message : 'An unknown error occurred while adding the task.';
      throw new McpError(ErrorCode.InternalError, message);
    }
  };

  server.tool(TOOL_NAME, TOOL_DESCRIPTION, AddTaskParamsSchema.shape, processRequest);
};
EOF_SRC_TOOLS_ADD_TASK_TOOL_TS
echo "Generated example tool src/tools/add_task_tool.ts (REMEMBER TO UPDATE ALL OTHER TOOLS)"

# --- Stub for integrationSetup.ts ---
# src/services/__tests__/integrationSetup.ts
cat << 'EOF_SRC_SERVICES_TESTS_INTEGRATIONSETUP_TS' > src/services/__tests__/integrationSetup.ts
// Modified: src/services/__tests__/integrationSetup.ts
import { Pool } from 'pg';
import { DatabaseManager } from '../../db/DatabaseManager.js';
import { WorkItemRepository, ActionHistoryRepository } from '../../repositories/index.js';
import { WorkItemService } from '../WorkItemService.js';
// import sseNotificationServiceSingleton from '../SseNotificationService.js'; // Import singleton
import { logger } from '../../utils/logger.js';

export interface TestEnvironment {
  dbManager: DatabaseManager;
  pool: Pool;
  workItemRepository: WorkItemRepository;
  actionHistoryRepository: ActionHistoryRepository;
  workItemService: WorkItemService;
  clearDatabase: () => Promise<void>;
  disconnect: () => Promise<void>;
}

export const setupTestEnvironment = async (): Promise<TestEnvironment> => {
  logger.info('[TestSetup] Initializing test environment...');
  const dbManager = await DatabaseManager.getInstance();
  const pool = dbManager.getPool();
  
  // Ensure schema is current for tests - this might be handled by your test runner or a global setup
  // Forcing schema run for each test suite might be slow.
  // Consider if this is needed here or handled elsewhere.
  // await dbManager.runSchema(); 

  const workItemRepository = new WorkItemRepository(pool);
  const actionHistoryRepository = new ActionHistoryRepository(pool);
  
  // Pass SseNotificationServiceSingleton to WorkItemService constructor
  const workItemService = new WorkItemService(workItemRepository, actionHistoryRepository, SseNotificationServiceSingleton);
  logger.info('[TestSetup] Test environment initialized.');

  const clearDatabase = async () => {
    // Simple clearing for POC: delete from all relevant tables
    // More robust would be to use TRUNCATE ... RESTART IDENTITY CASCADE
    logger.warn('[TestSetup] Clearing database for test...');
    const client = await pool.connect();
    try {
      await client.query('DELETE FROM work_item_dependencies;');
      await client.query('DELETE FROM undo_steps;');
      await client.query('DELETE FROM action_history;');
      await client.query('DELETE FROM work_items;'); 
      // Add other tables if necessary
      logger.info('[TestSetup] Database cleared.');
    } finally {
      client.release();
    }
  };

  const disconnect = async () => {
    logger.info('[TestSetup] Disconnecting database pool...');
    await dbManager.close(); // Assuming DatabaseManager has a close method
    logger.info('[TestSetup] Database pool disconnected.');
  };

  return { 
    dbManager, 
    pool, 
    workItemRepository, 
    actionHistoryRepository, 
    workItemService,
    clearDatabase,
    disconnect
  };
};

// Helper to get an initialized service for simpler test files
export async function getInitializedWorkItemService(): Promise<WorkItemService> {
    const dbManager = await DatabaseManager.getInstance();
    const pool = dbManager.getPool();
    const workItemRepository = new WorkItemRepository(pool);
    const actionHistoryRepository = new ActionHistoryRepository(pool);
    return new WorkItemService(workItemRepository, actionHistoryRepository, SseNotificationServiceSingleton);
}
EOF_SRC_SERVICES_TESTS_INTEGRATIONSETUP_TS
echo "Generated src/services/__tests__/integrationSetup.ts"

# --- Service Files (Remaining fixes) ---

# src/services/WorkItemAddingService.ts
cat << 'EOF_SRC_SERVICES_WORKITEMADDINGSERVICE_TS_FINAL' > src/services/WorkItemAddingService.ts
// Modified src/services/WorkItemAddingService.ts
import { PoolClient } from 'pg';
import { v4 as uuidv4, validate as uuidValidate } from 'uuid';
import {
  WorkItemRepository,
  ActionHistoryRepository,
  WorkItemData,
  WorkItemDependencyData,
  CreateActionHistoryInput,
  CreateUndoStepInput,
} from '../repositories/index.js';
import { AddWorkItemInput, PositionEnum, ServiceWorkItemData } from './WorkItemServiceTypes.js'; // Added ServiceWorkItemData
import { ChildTaskInputRecursive } from '../tools/add_child_tasks_params.js'; 
import { WorkItemHistoryService } from './WorkItemHistoryService.js';
// import sseNotificationServiceInstance from './SseNotificationService.js'; 
import { WorkItemUtilsService } from './WorkItemUtilsService.js';
import { NotFoundError, ValidationError, DatabaseError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export class WorkItemAddingService {
  private workItemRepository: WorkItemRepository;
  private actionHistoryRepository: ActionHistoryRepository;
  private historyService: WorkItemHistoryService;
  private sseService: typeof SseNotificationServiceInstance;

  constructor(
    workItemRepository: WorkItemRepository,
    actionHistoryRepository: ActionHistoryRepository,
    historyService: WorkItemHistoryService,
    sseService: typeof SseNotificationServiceInstance
  ) {
    this.workItemRepository = workItemRepository;
    this.actionHistoryRepository = actionHistoryRepository;
    this.historyService = historyService;
    this.sseService = sseService;
  }

  private async determineOrderKeys(
    client: PoolClient,
    parentId: string | null,
    insertAt?: PositionEnum, // Corrected type
    insertAfterId?: string,
    insertBeforeId?: string
  ): Promise<{ keyBefore: string | null; keyAfter: string | null }> {
    let keyBefore: string | null = null;
    let keyAfter: string | null = null;

    if (insertAfterId) {
      const afterItem = await this.workItemRepository.findById(insertAfterId, { isActive: true }, client);
      if (!afterItem) {
        throw new NotFoundError(\`Work item with ID \${insertAfterId} (for insertAfter) not found or is inactive.\`);
      }
      if (afterItem.parent_work_item_id !== parentId) {
        throw new ValidationError(\`Item \${insertAfterId} (for insertAfter) is not a sibling under parent \${parentId}.\`);
      }
      keyBefore = afterItem.order_key;
      const neighbours = await this.workItemRepository.findNeighbourOrderKeys(parentId, insertAfterId, 'after', client);
      keyAfter = neighbours.after;
    } else if (insertBeforeId) {
      const beforeItem = await this.workItemRepository.findById(insertBeforeId, { isActive: true }, client);
      if (!beforeItem) {
        throw new NotFoundError(\`Work item with ID \${insertBeforeId} (for insertBefore) not found or is inactive.\`);
      }
      if (beforeItem.parent_work_item_id !== parentId) {
        throw new ValidationError(
          \`Item \${insertBeforeId} (for insertBefore) is not a sibling under parent \${parentId}.\`
        );
      }
      keyAfter = beforeItem.order_key;
      const neighbours = await this.workItemRepository.findNeighbourOrderKeys(
        parentId,
        insertBeforeId,
        'before',
        client
      );
      keyBefore = neighbours.before;
    } else if (insertAt === 'start') {
      keyBefore = null;
      keyAfter = await this.workItemRepository.findSiblingEdgeOrderKey(parentId, 'first', client);
    } else { 
      keyBefore = await this.workItemRepository.findSiblingEdgeOrderKey(parentId, 'last', client);
      keyAfter = null;
    }
    return { keyBefore, keyAfter };
  }

  private async determineOrderKeysForNewItemInTree(client: PoolClient, parentId: string | null): Promise<string> {
    const keyBefore = await this.workItemRepository.findSiblingEdgeOrderKey(parentId, 'last', client);
    const keyAfter = null;
    const order_key = WorkItemUtilsService.calculateOrderKey(keyBefore, keyAfter);
    if (order_key === null) {
      logger.error('[WorkItemAddingService] Failed to calculate order key for new tree item.', { parentId });
      throw new DatabaseError('Failed to calculate a valid order key for the new work item in tree.');
    }
    return order_key;
  }

  private async createSingleWorkItemInTree(
    itemData: ChildTaskInputRecursive, 
    parentId: string | null,
    client: PoolClient
  ): Promise<WorkItemData> {
    logger.debug(
      \`[WorkItemAddingService-createSingleWorkItemInTree] Creating item: "\${itemData.name}" under parent: \${parentId}\`
    );

    const order_key = await this.determineOrderKeysForNewItemInTree(client, parentId);
    const now = new Date().toISOString();
    const newWorkItemData: WorkItemData = {
      work_item_id: uuidv4(),
      name: itemData.name,
      description: itemData.description || null,
      parent_work_item_id: parentId,
      status: itemData.status || 'todo',
      priority: itemData.priority || 'medium',
      due_date: itemData.due_date || null,
      order_key: order_key,
      is_active: true,
      created_at: now,
      updated_at: now,
      tags: (itemData as any).tags || null, // Handle potential missing tags on ChildTaskInputRecursive
    };

    const createdItem = await this.workItemRepository.create(client, newWorkItemData); // Dependencies handled separately if ChildTaskInputRecursive supports them
    if (!createdItem) {
      throw new DatabaseError(\`Failed to create work item "\${itemData.name}" in repository.\`);
    }
    logger.info(
      \`[WorkItemAddingService] Created single item in tree: \${createdItem.work_item_id} ("\${createdItem.name}")\`
    );
    return createdItem;
  }

  private async addWorkItemTreeRecursiveInternal(
    currentParentId: string | null,
    tasksToCreate: ChildTaskInputRecursive[],
    client: PoolClient,
    accumulatedCreatedItems: WorkItemData[]
  ): Promise<void> {
    if (currentParentId) {
      const parentItem = await this.workItemRepository.findById(currentParentId, {isActive: true}, client); 
      if (!parentItem) {
        throw new NotFoundError(\`Parent work item with ID \${currentParentId} not found or is inactive for adding children.\`);
      }
      if (parentItem.status === 'done') {
        throw new ValidationError(
          \`Parent work item "\${parentItem.name}" (ID: \${currentParentId}) is "done", cannot add children.\`
        );
      }
    }

    for (const taskDef of tasksToCreate) {
      const createdItem = await this.createSingleWorkItemInTree(taskDef, currentParentId, client);
      accumulatedCreatedItems.push(createdItem);
      if (taskDef.children && taskDef.children.length > 0) {
        await this.addWorkItemTreeRecursiveInternal(
          createdItem.work_item_id,
          taskDef.children,
          client,
          accumulatedCreatedItems
        );
      }
    }
  }

  public async addWorkItemTree(
    initialParentId: string,
    childTasksTree: ChildTaskInputRecursive[]
  ): Promise<WorkItemData[]> {
    logger.info(\`[WorkItemAddingService] Adding work item tree under initial parent \${initialParentId}\`);
    if (!uuidValidate(initialParentId)) { 
      throw new ValidationError(\`Invalid parent_work_item_id format: \${initialParentId}\`);
    }
    const parentItem = await this.workItemRepository.findById(initialParentId, {isActive: true}); 
    if (!parentItem) {
      throw new NotFoundError(\`Initial parent work item with ID \${initialParentId} not found or is inactive.\`);
    }
    if (parentItem.status === 'done') {
      throw new ValidationError(
        \`Initial parent work item "\${parentItem.name}" (ID: \${initialParentId}) is marked as "done" and cannot have new tasks added.\`
      );
    }
    const allCreatedItems: WorkItemData[] = [];
    await this.actionHistoryRepository.withTransaction(async (txClient) => {
      await this.addWorkItemTreeRecursiveInternal(initialParentId, childTasksTree, txClient, allCreatedItems);
      if (allCreatedItems.length > 0) {
        const topLevelCreatedNames = childTasksTree.map((t) => t.name).join(', ');
        const description = \`Added task tree (\${allCreatedItems.length} total items) under "\${parentItem.name}": \${topLevelCreatedNames}\`;
        const actionData: CreateActionHistoryInput = {
          action_type: 'ADD_TASK_TREE',
          work_item_id: initialParentId,
          description: description.substring(0, 250),
        };
        const undoStepsForBatch: CreateUndoStepInput[] = allCreatedItems.map((createdItem, index) => ({
            step_order: index + 1, 
            step_type: 'UPDATE',
            table_name: 'work_items',
            record_id: createdItem.work_item_id,
            old_data: { is_active: false }, 
            new_data: { ...createdItem, is_active: true }, 
        }));
        const createdAction = await this.actionHistoryRepository.createActionWithSteps(actionData, undoStepsForBatch); // Removed txClient
        await this.historyService.invalidateRedoStack(txClient, createdAction.action_id); 
        logger.info(
          \`[WorkItemAddingService] Task tree creation transaction committed. Action ID: \${createdAction.action_id}. Total items: \${allCreatedItems.length}.\`
        );
      } else {
        logger.info(\`[WorkItemAddingService] No items were specified in the task tree for parent \${initialParentId}.\`);
      }
    });
    if (allCreatedItems.length > 0) {
        this.sseService.notifyWorkItemUpdated(parentItem, parentItem.parent_work_item_id); 
    }
    return allCreatedItems;
  }

  public async addWorkItem(input: AddWorkItemInput): Promise<WorkItemData> {
    logger.info('[WorkItemAddingService] addWorkItem called with input:', input);
    let createdItemGlobal: WorkItemData | undefined;
    await this.actionHistoryRepository.withTransaction(async (txClient) => {
        if (input.parent_work_item_id && !uuidValidate(input.parent_work_item_id)) {
          throw new ValidationError(\`Invalid parent_work_item_id format: \${input.parent_work_item_id}\`);
        }
        const parentId = input.parent_work_item_id || null;
        if (parentId) {
            const parentItemData = await this.workItemRepository.findById(parentId, {isActive: true}, txClient);
            if (!parentItemData) throw new NotFoundError(\`Parent work item with ID \${parentId} not found or is inactive.\`);
            if (parentItemData.status === 'done')
            throw new ValidationError(\`Parent work item "\${parentItemData.name}" (ID: \${parentId}) is "done".\`);
        }
        const { keyBefore, keyAfter } = await this.determineOrderKeys(
            txClient, parentId, input.insertAt,
            input.insertAfter_work_item_id, input.insertBefore_work_item_id
        );
        const order_key = WorkItemUtilsService.calculateOrderKey(keyBefore, keyAfter);
        if (order_key === null) throw new DatabaseError('Failed to calculate order key.');
        const now = new Date().toISOString();
        const newWorkItemData: WorkItemData = { 
            work_item_id: uuidv4(),
            name: input.name,
            description: input.description || null,
            parent_work_item_id: parentId,
            status: input.status || 'todo',
            priority: input.priority || 'medium',
            due_date: input.due_date || null,
            order_key: order_key,
            is_active: true,
            created_at: now,
            updated_at: now,
            tags: input.tags || null, // Handle tags from input
        };
        let dependenciesForRepoCreate: Omit<WorkItemDependencyData, 'is_active' | 'work_item_id'>[] | undefined = undefined;
        if (input.dependencies && input.dependencies.length > 0) {
            dependenciesForRepoCreate = input.dependencies.map((d) => ({
            depends_on_work_item_id: d.depends_on_work_item_id,
            dependency_type: d.dependency_type || 'finish-to-start',
            }));
        }
        const createdItem = await this.workItemRepository.create(txClient, newWorkItemData, dependenciesForRepoCreate);
        if (!createdItem) throw new DatabaseError('Failed to create item in repository.');
        createdItemGlobal = createdItem; 
        const undoStepsForSingleAdd: CreateUndoStepInput[] = [{
            step_order: 1, step_type: 'UPDATE', table_name: 'work_items', record_id: createdItem.work_item_id,
            old_data: { is_active: false }, new_data: { ...createdItem }, 
        }];
        if (dependenciesForRepoCreate) { 
            dependenciesForRepoCreate.forEach((dep, index) => {
            undoStepsForSingleAdd.push({
                step_order: 2 + index, step_type: 'UPDATE', table_name: 'work_item_dependencies',
                record_id: \`\${createdItem.work_item_id}:\${dep.depends_on_work_item_id}\`,
                old_data: { is_active: false }, 
                new_data: { ...dep, work_item_id: createdItem.work_item_id, is_active: true }, 
            });
            });
        }
        const actionInput: CreateActionHistoryInput = {
            action_type: 'ADD_WORK_ITEM', work_item_id: createdItem.work_item_id,
            description: \`Added work item "\${createdItem.name}"\`,
        };
        const createdAction = await this.actionHistoryRepository.createActionWithSteps(actionInput, undoStepsForSingleAdd); // Removed txClient
        await this.historyService.invalidateRedoStack(txClient, createdAction.action_id);
        logger.info(
            \`[WorkItemAddingService] Added single work item \${createdItem.work_item_id}. Action ID: \${createdAction.action_id}\`
        );
    });
    if (!createdItemGlobal) {
        throw new DatabaseError('Failed to create work item, item reference not set.');
    }
    this.sseService.notifyWorkItemCreated(createdItemGlobal, createdItemGlobal.parent_work_item_id);
    return createdItemGlobal;
  }
}
EOF_SRC_SERVICES_WORKITEMADDINGSERVICE_TS_FINAL'
echo "Generated src/services/WorkItemAddingService.ts"

# ... (Other service files would follow a similar pattern of corrections) ...

echo "---"
echo "IMPORTANT: This script has corrected a foundational set of files."
echo "Due to the large number of errors, other files (especially services and tools) will likely still have errors."
echo "Please run 'npm run dev' or 'npm run build' for the backend again."
echo "Provide the NEW error list for the next iteration of fixes."
echo "Remember to install @types/express and @types/cors: npm i --save-dev @types/express @types/cors"
echo "---"