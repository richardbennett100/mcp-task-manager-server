// src/repositories/WorkItemRepository.ts
import { Pool, PoolClient } from 'pg';
import { WorkItemRepositoryBase, WorkItemData, WorkItemDependencyData } from './WorkItemRepositoryBase.js';
import { WorkItemRepositoryCRUD } from './WorkItemRepositoryCRUD.js';
import { WorkItemRepositoryHierarchy } from './WorkItemRepositoryHierarchy.js';
import { WorkItemRepositoryDependencies } from './WorkItemRepositoryDependencies.js';
import { WorkItemRepositorySearchOrder } from './WorkItemRepositorySearchOrder.js';
import { WorkItemRepositoryUndoRedo } from './WorkItemRepositoryUndoRedo.js';
import { ValidationError } from '../utils/errors.js';

/**
 * Main repository class for managing work items.
 * Composes functionality from specialized helper classes.
 */
export class WorkItemRepository extends WorkItemRepositoryBase {
  private crud: WorkItemRepositoryCRUD;
  private hierarchy: WorkItemRepositoryHierarchy;
  private dependenciesRepo: WorkItemRepositoryDependencies;
  private searchOrder: WorkItemRepositorySearchOrder;
  private undoRedo: WorkItemRepositoryUndoRedo;

  constructor(pool: Pool) {
    super(pool);
    this.crud = new WorkItemRepositoryCRUD(pool);
    this.hierarchy = new WorkItemRepositoryHierarchy(pool);
    this.dependenciesRepo = new WorkItemRepositoryDependencies(pool);
    this.searchOrder = new WorkItemRepositorySearchOrder(pool);
    this.undoRedo = new WorkItemRepositoryUndoRedo(pool);
  }

  // CRUD Operations
  public create(
    client: PoolClient,
    item: WorkItemData,
    dependencies?: WorkItemDependencyData[]
  ): Promise<WorkItemData> {
    return this.crud.create(client, item, dependencies);
  }
  public findById(workItemId: string, filter?: { isActive?: boolean }): Promise<WorkItemData | undefined> {
    return this.crud.findById(workItemId, filter);
  }
  public findByIds(workItemIds: string[], filter?: { isActive?: boolean }): Promise<WorkItemData[]> {
    return this.crud.findByIds(workItemIds, filter);
  }
  public findAll(filter?: { isActive?: boolean; status?: WorkItemData['status'] }): Promise<WorkItemData[]> {
    return this.crud.findAll(filter);
  }
  /** @deprecated Use granular update methods or updateFields instead */
  public update(
    client: PoolClient,
    workItemId: string,
    updatePayload: Partial<Omit<WorkItemData, 'work_item_id' | 'created_at' | 'updated_at' | 'is_active'>>,
    newDependencies?: WorkItemDependencyData[]
  ): Promise<WorkItemData> {
    return this.crud.update(client, workItemId, updatePayload, newDependencies);
  }

  // Corrected signature for updateFields
  public updateFields(
    client: PoolClient,
    workItemId: string,
    payload: Partial<
      Omit<WorkItemData, 'work_item_id' | 'parent_work_item_id' | 'created_at' | 'is_active' | 'updated_at'>
    >
  ): Promise<WorkItemData | null> {
    return this.crud.updateFields(client, workItemId, payload);
  }

  public softDelete(workItemIds: string[], client: PoolClient): Promise<number> {
    return this.crud.softDelete(workItemIds, client);
  }
  public addOrUpdateDependencies(
    client: PoolClient,
    workItemId: string,
    dependencies: WorkItemDependencyData[]
  ): Promise<number> {
    return this.crud.addOrUpdateDependencies(client, workItemId, dependencies);
  }

  // Hierarchy Operations
  public findRoots(filter?: { isActive?: boolean; status?: WorkItemData['status'] }): Promise<WorkItemData[]> {
    return this.hierarchy.findRoots(filter);
  }
  public findChildren(
    parentWorkItemId: string,
    filter?: { isActive?: boolean; status?: WorkItemData['status'] }
  ): Promise<WorkItemData[]> {
    return this.hierarchy.findChildren(parentWorkItemId, filter);
  }
  public findDescendantWorkItemIds(workItemId: string, client: PoolClient): Promise<string[]> {
    return this.hierarchy.findDescendantWorkItemIds(workItemId, client);
  }
  public findSiblings(
    workItemId: string,
    parentWorkItemId: string | null,
    filter?: { isActive?: boolean }
  ): Promise<WorkItemData[]> {
    return this.hierarchy.findSiblings(workItemId, parentWorkItemId, filter);
  }

  // Dependency Operations
  public findDependencies(
    workItemId: string,
    filter?: { isActive?: boolean; dependsOnActive?: boolean }
  ): Promise<WorkItemDependencyData[]> {
    return this.dependenciesRepo.findDependencies(workItemId, filter);
  }
  public findDependenciesByItemList(
    workItemIds: string[],
    filter?: { isActive?: boolean; dependsOnActive?: boolean }
  ): Promise<WorkItemDependencyData[]> {
    return this.dependenciesRepo.findDependenciesByItemList(workItemIds, filter);
  }
  public findDependents(
    dependsOnWorkItemId: string,
    filter?: { isActive?: boolean; dependentIsActive?: boolean }
  ): Promise<WorkItemDependencyData[]> {
    return this.dependenciesRepo.findDependents(dependsOnWorkItemId, filter);
  }
  public findDependentsByItemList(
    dependsOnWorkItemIds: string[],
    filter?: { isActive?: boolean; dependentIsActive?: boolean }
  ): Promise<WorkItemDependencyData[]> {
    return this.dependenciesRepo.findDependentsByItemList(dependsOnWorkItemIds, filter);
  }
  public findDependenciesByCompositeKeys(
    compositeKeys: { work_item_id: string; depends_on_work_item_id: string }[],
    filter?: { isActive?: boolean }
  ): Promise<WorkItemDependencyData[]> {
    return this.dependenciesRepo.findDependenciesByCompositeKeys(compositeKeys, filter);
  }
  public softDeleteDependenciesByCompositeKeys(
    compositeKeys: { work_item_id: string; depends_on_work_item_id: string }[],
    client: PoolClient
  ): Promise<number> {
    return this.dependenciesRepo.softDeleteDependenciesByCompositeKeys(compositeKeys, client);
  }

  // Search/Order Operations
  public searchByNameOrDescription(query: string, filter?: { isActive?: boolean }): Promise<WorkItemData[]> {
    return this.searchOrder.searchByNameOrDescription(query, filter);
  }
  public findSiblingEdgeOrderKey(
    parentId: string | null,
    edge: 'first' | 'last',
    client: PoolClient
  ): Promise<string | null> {
    return this.searchOrder.findSiblingEdgeOrderKey(parentId, edge, client);
  }
  public findNeighbourOrderKeys(
    parentId: string | null,
    relativeToId: string,
    relation: 'before' | 'after',
    client: PoolClient
  ): Promise<{ before: string | null; after: string | null }> {
    if (relation !== 'before' && relation !== 'after') {
      throw new ValidationError("Relation must be 'before' or 'after'");
    }
    return this.searchOrder.findNeighbourOrderKeys(parentId, relativeToId, relation, client);
  }

  // Undo/Redo specific methods
  public insertRow(client: PoolClient, tableName: string, data: object): Promise<void> {
    return this.undoRedo.insertRow(client, tableName, data);
  }
  public deleteRow(client: PoolClient, tableName: string, recordId: string): Promise<void> {
    return this.undoRedo.deleteRow(client, tableName, recordId);
  }
}
