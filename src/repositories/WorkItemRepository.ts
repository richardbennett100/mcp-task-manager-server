// src/repositories/WorkItemRepository.ts
import { Pool, PoolClient } from 'pg';
import { WorkItemRepositoryBase, WorkItemData, WorkItemDependencyData } from './WorkItemRepositoryBase.js';
import { WorkItemRepositoryCRUD } from './WorkItemRepositoryCRUD.js';
import { WorkItemRepositoryHierarchy } from './WorkItemRepositoryHierarchy.js';
import { WorkItemRepositoryDependencies } from './WorkItemRepositoryDependencies.js';
import { WorkItemRepositorySearchOrder } from './WorkItemRepositorySearchOrder.js';
import { WorkItemRepositoryUndoRedo } from './WorkItemRepositoryUndoRedo.js';

/**
 * Main repository class for managing work items.
 * Composes functionality from specialized helper classes.
 */
export class WorkItemRepository extends WorkItemRepositoryBase {
  private crud: WorkItemRepositoryCRUD;
  private hierarchy: WorkItemRepositoryHierarchy;
  private dependencies: WorkItemRepositoryDependencies;
  private searchOrder: WorkItemRepositorySearchOrder;
  private undoRedo: WorkItemRepositoryUndoRedo;

  constructor(pool: Pool) {
    super(pool); // Pass pool to base
    this.crud = new WorkItemRepositoryCRUD(pool);
    this.hierarchy = new WorkItemRepositoryHierarchy(pool);
    this.dependencies = new WorkItemRepositoryDependencies(pool);
    this.searchOrder = new WorkItemRepositorySearchOrder(pool);
    this.undoRedo = new WorkItemRepositoryUndoRedo(pool);
  }

  // --- Delegated Methods ---

  // CRUD Operations
  public create(
    client: PoolClient,
    item: WorkItemData,
    dependencies?: WorkItemDependencyData[]
  ): Promise<WorkItemData> {
    return this.crud.create(client, item, dependencies);
  }
  public findById(
    workItemId: string,
    filter?: { isActive?: boolean },
    client?: PoolClient
  ): Promise<WorkItemData | undefined> {
    return this.crud.findById(workItemId, filter, client);
  }
  public findByIds(
    workItemIds: string[],
    filter?: { isActive?: boolean },
    client?: PoolClient
  ): Promise<WorkItemData[]> {
    return this.crud.findByIds(workItemIds, filter, client);
  }
  public findAll(
    filter?: { isActive?: boolean; status?: WorkItemData['status'] },
    client?: PoolClient
  ): Promise<WorkItemData[]> {
    return this.crud.findAll(filter, client);
  }
  public update(
    client: PoolClient,
    workItemId: string,
    updatePayload: Partial<Omit<WorkItemData, 'work_item_id' | 'created_at' | 'updated_at' | 'is_active'>>,
    newDependencies?: WorkItemDependencyData[]
  ): Promise<WorkItemData> {
    return this.crud.update(client, workItemId, updatePayload, newDependencies);
  }
  public softDelete(workItemIds: string[], client: PoolClient): Promise<number> {
    return this.crud.softDelete(workItemIds, client);
  }

  // Hierarchy Operations
  public findRoots(
    filter?: { isActive?: boolean; status?: WorkItemData['status'] },
    client?: PoolClient
  ): Promise<WorkItemData[]> {
    return this.hierarchy.findRoots(filter, client);
  }
  public findChildren(
    parentWorkItemId: string,
    filter?: { isActive?: boolean; status?: WorkItemData['status'] },
    client?: PoolClient
  ): Promise<WorkItemData[]> {
    return this.hierarchy.findChildren(parentWorkItemId, filter, client);
  }
  public findDescendantWorkItemIds(workItemId: string, client: PoolClient): Promise<string[]> {
    return this.hierarchy.findDescendantWorkItemIds(workItemId, client);
  }
  public findSiblings(
    workItemId: string,
    parentWorkItemId: string | null,
    filter?: { isActive?: boolean },
    client?: PoolClient
  ): Promise<WorkItemData[]> {
    return this.hierarchy.findSiblings(workItemId, parentWorkItemId, filter, client);
  }

  // Dependency Operations
  public findDependencies(
    workItemId: string,
    filter?: { isActive?: boolean; dependsOnActive?: boolean },
    client?: PoolClient
  ): Promise<WorkItemDependencyData[]> {
    return this.dependencies.findDependencies(workItemId, filter, client);
  }
  public findDependenciesByItemList(
    workItemIds: string[],
    filter?: { isActive?: boolean; dependsOnActive?: boolean },
    client?: PoolClient
  ): Promise<WorkItemDependencyData[]> {
    return this.dependencies.findDependenciesByItemList(workItemIds, filter, client);
  }
  public findDependents(
    dependsOnWorkItemId: string,
    filter?: { isActive?: boolean; dependentIsActive?: boolean },
    client?: PoolClient
  ): Promise<WorkItemDependencyData[]> {
    return this.dependencies.findDependents(dependsOnWorkItemId, filter, client);
  }
  public findDependentsByItemList(
    dependsOnWorkItemIds: string[],
    filter?: { isActive?: boolean; dependentIsActive?: boolean },
    client?: PoolClient
  ): Promise<WorkItemDependencyData[]> {
    return this.dependencies.findDependentsByItemList(dependsOnWorkItemIds, filter, client);
  }
  public findDependenciesByCompositeKeys(
    compositeKeys: { work_item_id: string; depends_on_work_item_id: string }[],
    filter?: { isActive?: boolean },
    client?: PoolClient
  ): Promise<WorkItemDependencyData[]> {
    return this.dependencies.findDependenciesByCompositeKeys(compositeKeys, filter, client);
  }
  public softDeleteDependenciesByCompositeKeys(
    compositeKeys: { work_item_id: string; depends_on_work_item_id: string }[],
    client: PoolClient
  ): Promise<number> {
    return this.dependencies.softDeleteDependenciesByCompositeKeys(compositeKeys, client);
  }

  // Search/Order Operations
  public searchByNameOrDescription(
    query: string,
    filter?: { isActive?: boolean },
    client?: PoolClient
  ): Promise<WorkItemData[]> {
    return this.searchOrder.searchByNameOrDescription(query, filter, client);
  }
  public getAdjacentOrderKeys(
    parentWorkItemId: string | null
  ): Promise<{ before: string | null; after: string | null }> {
    return this.searchOrder.getAdjacentOrderKeys(parentWorkItemId);
  }
  public updateRowState(client: PoolClient, tableName: string, data: object): Promise<void> {
    return this.undoRedo.updateRowState(client, tableName, data);
  }
  public insertRow(client: PoolClient, tableName: string, data: object): Promise<void> {
    return this.undoRedo.insertRow(client, tableName, data);
  }
  public deleteRow(client: PoolClient, tableName: string, recordId: string): Promise<void> {
    return this.undoRedo.deleteRow(client, tableName, recordId);
  }
}
