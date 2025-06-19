// src/repositories/WorkItemRepository.ts
import { type Pool, type PoolClient } from 'pg';
import { WorkItemRepositoryBase, type WorkItemData, type WorkItemDependencyData } from './WorkItemRepositoryBase.js';
import { WorkItemRepositoryCRUD } from './WorkItemRepositoryCRUD.js';
import { WorkItemRepositoryHierarchy } from './WorkItemRepositoryHierarchy.js';
import { WorkItemRepositoryDependencies } from './WorkItemRepositoryDependencies.js';
import { WorkItemRepositorySearchOrder, type CandidateTaskFilters } from './WorkItemRepositorySearchOrder.js';
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
  public findById(
    workItemId: string,
    filter?: { isActive?: boolean },
    client?: PoolClient | Pool
  ): Promise<WorkItemData | undefined> {
    return this.crud.findById(workItemId, filter, client);
  }
  public findByIds(
    workItemIds: string[],
    filter?: { isActive?: boolean },
    client?: PoolClient | Pool
  ): Promise<WorkItemData[]> {
    return this.crud.findByIds(workItemIds, filter, client);
  }
  public findAll(
    filter?: { isActive?: boolean; status?: WorkItemData['status'] },
    client?: PoolClient | Pool
  ): Promise<WorkItemData[]> {
    return this.crud.findAll(filter, client);
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

  public updateFields(
    client: PoolClient,
    workItemId: string,
    payload: Partial<Omit<WorkItemData, 'work_item_id' | 'created_at' | 'is_active' | 'updated_at'>>
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
  public findRoots(
    filter?: { isActive?: boolean; status?: WorkItemData['status'] },
    client?: PoolClient | Pool
  ): Promise<WorkItemData[]> {
    return this.hierarchy.findRoots(filter, client);
  }
  public findChildren(
    parentWorkItemId: string,
    filter?: { isActive?: boolean; status?: WorkItemData['status'] },
    client?: PoolClient | Pool
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
    client?: PoolClient | Pool
  ): Promise<WorkItemData[]> {
    return this.hierarchy.findSiblings(workItemId, parentWorkItemId, filter, client);
  }

  // Dependency Operations
  public findDependencies(
    workItemId: string,
    filter?: { isActive?: boolean; dependsOnActive?: boolean },
    client?: PoolClient | Pool
  ): Promise<WorkItemDependencyData[]> {
    return this.dependenciesRepo.findDependencies(workItemId, filter, client);
  }
  public findDependenciesByItemList(
    workItemIds: string[],
    filter?: { isActive?: boolean; dependsOnActive?: boolean },
    client?: PoolClient | Pool
  ): Promise<WorkItemDependencyData[]> {
    return this.dependenciesRepo.findDependenciesByItemList(workItemIds, filter, client);
  }
  public findDependents(
    dependsOnWorkItemId: string,
    filter?: { isActive?: boolean; dependentIsActive?: boolean },
    client?: PoolClient | Pool
  ): Promise<WorkItemDependencyData[]> {
    return this.dependenciesRepo.findDependents(dependsOnWorkItemId, filter, client);
  }
  public findDependentsByItemList(
    dependsOnWorkItemIds: string[],
    filter?: { isActive?: boolean; dependentIsActive?: boolean },
    client?: PoolClient | Pool
  ): Promise<WorkItemDependencyData[]> {
    return this.dependenciesRepo.findDependentsByItemList(dependsOnWorkItemIds, filter, client);
  }
  public findDependenciesByCompositeKeys(
    compositeKeys: { work_item_id: string; depends_on_work_item_id: string }[],
    filter?: { isActive?: boolean },
    client?: PoolClient | Pool
  ): Promise<WorkItemDependencyData[]> {
    return this.dependenciesRepo.findDependenciesByCompositeKeys(compositeKeys, filter, client);
  }
  public softDeleteDependenciesByCompositeKeys(
    compositeKeys: { work_item_id: string; depends_on_work_item_id: string }[],
    client: PoolClient
  ): Promise<number> {
    return this.dependenciesRepo.softDeleteDependenciesByCompositeKeys(compositeKeys, client);
  }

  // Search/Order Operations
  public searchByNameOrDescription(
    query: string,
    filter?: { isActive?: boolean },
    client?: PoolClient | Pool
  ): Promise<WorkItemData[]> {
    return this.searchOrder.searchByNameOrDescription(query, filter?.isActive, client);
  }

  public findSiblingEdgeOrderKey(
    parentId: string | null,
    edge: 'first' | 'last',
    client: PoolClient // Keeping as PoolClient as it's likely used within transactions
  ): Promise<string | null> {
    return this.searchOrder.findSiblingEdgeOrderKey(parentId, edge, client);
  }
  public findNeighbourOrderKeys(
    parentId: string | null,
    relativeToId: string,
    relation: 'before' | 'after',
    client: PoolClient // Keeping as PoolClient as it's likely used within transactions
  ): Promise<{ before: string | null; after: string | null }> {
    if (relation !== 'before' && relation !== 'after') {
      throw new ValidationError("Relation must be 'before' or 'after'");
    }
    return this.searchOrder.findNeighbourOrderKeys(parentId, relativeToId, relation, client);
  }

  public findCandidateTasksForSuggestion(
    filters: CandidateTaskFilters,
    client?: PoolClient | Pool
  ): Promise<WorkItemData[]> {
    return this.searchOrder.findCandidateTasksForSuggestion(filters, client);
  }

  // Undo/Redo specific methods
  public insertRow(client: PoolClient, tableName: string, data: object): Promise<void> {
    return this.undoRedo.insertRow(client, tableName, data);
  }
  public deleteRow(client: PoolClient, tableName: string, recordId: string): Promise<void> {
    return this.undoRedo.deleteRow(client, tableName, recordId);
  }
}
