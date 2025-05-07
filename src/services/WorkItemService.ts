// src/services/WorkItemService.ts
import {
  WorkItemRepository,
  ActionHistoryRepository,
  type ActionHistoryData,
  type WorkItemData,
} from '../repositories/index.js';
import {
  type AddWorkItemInput,
  type UpdateWorkItemInput,
  type ListWorkItemsFilter,
  type FullWorkItemData,
  type WorkItemTreeNode,
  type GetFullTreeOptions,
} from './WorkItemServiceTypes.js';
import { type AddTaskArgs, WorkItemStatusEnum, WorkItemPriorityEnum } from '../tools/add_task_params.js'; // Ensure AddTaskArgs is imported
import { type DependencyInput } from '../tools/add_dependencies_params.js';
import { WorkItemAddingService } from './WorkItemAddingService.js';
import { WorkItemReadingService } from './WorkItemReadingService.js';
import { WorkItemUpdateService } from './WorkItemUpdateService.js';
import { WorkItemFieldUpdateService } from './WorkItemFieldUpdateService.js';
import { WorkItemDependencyUpdateService } from './WorkItemDependencyUpdateService.js';
import { WorkItemPositionUpdateService } from './WorkItemPositionUpdateService.js';
import { WorkItemDeleteService } from './WorkItemDeleteService.js';
import { WorkItemHistoryService } from './WorkItemHistoryService.js';
import { WorkItemPromoteService } from './WorkItemPromoteService.js'; // New Import
import { z } from 'zod';

type WorkItemStatus = z.infer<typeof WorkItemStatusEnum>;
type WorkItemPriority = z.infer<typeof WorkItemPriorityEnum>;

/**
 * Main service for managing work items. This class delegates specific operations
 * to specialized service classes to keep code maintainable.
 */
export class WorkItemService {
  private workItemRepository: WorkItemRepository;
  private actionHistoryRepository: ActionHistoryRepository;

  private addingService: WorkItemAddingService;
  private readingService: WorkItemReadingService;
  private updateService: WorkItemUpdateService;
  private fieldUpdateService: WorkItemFieldUpdateService;
  private dependencyUpdateService: WorkItemDependencyUpdateService;
  private positionUpdateService: WorkItemPositionUpdateService;
  private deleteService: WorkItemDeleteService;
  private historyService: WorkItemHistoryService;
  private promoteService: WorkItemPromoteService; // New Property

  constructor(workItemRepository: WorkItemRepository, actionHistoryRepository: ActionHistoryRepository) {
    this.workItemRepository = workItemRepository;
    this.actionHistoryRepository = actionHistoryRepository;

    this.addingService = new WorkItemAddingService(workItemRepository, actionHistoryRepository);
    this.readingService = new WorkItemReadingService(workItemRepository);
    this.updateService = new WorkItemUpdateService(workItemRepository, actionHistoryRepository);
    this.fieldUpdateService = new WorkItemFieldUpdateService(workItemRepository, actionHistoryRepository);
    this.dependencyUpdateService = new WorkItemDependencyUpdateService(workItemRepository, actionHistoryRepository);
    this.positionUpdateService = new WorkItemPositionUpdateService(workItemRepository, actionHistoryRepository);
    this.deleteService = new WorkItemDeleteService(workItemRepository, actionHistoryRepository);
    this.historyService = new WorkItemHistoryService(workItemRepository, actionHistoryRepository);
    this.promoteService = new WorkItemPromoteService(workItemRepository, actionHistoryRepository); // New Instantiation
  }

  // --- Existing methods ---
  public async addWorkItem(input: AddTaskArgs | AddWorkItemInput): Promise<WorkItemData> {
    // Cast to AddTaskArgs might be too specific if create_project also uses this.
    // Assuming AddTaskArgs is a superset or compatible for now.
    return this.addingService.addWorkItem(input as AddTaskArgs);
  }

  public async getWorkItemById(id: string, filter?: { isActive?: boolean }): Promise<FullWorkItemData | null> {
    return this.readingService.getWorkItemById(id, filter);
  }

  public async listWorkItems(filter: ListWorkItemsFilter): Promise<WorkItemData[]> {
    return this.readingService.listWorkItems(filter);
  }

  /** @deprecated Use granular update tools/methods instead */
  public async updateWorkItem(
    id: string,
    updates: UpdateWorkItemInput,
    dependenciesInput?: {
      depends_on_work_item_id: string;
      dependency_type?: 'finish-to-start' | 'linked';
    }[]
  ): Promise<FullWorkItemData> {
    return this.updateService.updateWorkItem(id, updates, dependenciesInput);
  }

  public async deleteWorkItem(ids: string[]): Promise<number> {
    return this.deleteService.deleteWorkItem(ids);
  }

  public async undoLastAction(): Promise<ActionHistoryData | null> {
    return this.historyService.undoLastAction();
  }

  public async redoLastUndo(): Promise<ActionHistoryData | null> {
    return this.historyService.redoLastUndo();
  }

  public async addDependencies(workItemId: string, dependenciesToAdd: DependencyInput[]): Promise<FullWorkItemData> {
    return this.dependencyUpdateService.addDependencies(workItemId, dependenciesToAdd);
  }

  public async deleteDependencies(workItemId: string, dependsOnIdsToRemove: string[]): Promise<FullWorkItemData> {
    return this.dependencyUpdateService.deleteDependencies(workItemId, dependsOnIdsToRemove);
  }

  public async setStatus(workItemId: string, status: WorkItemStatus): Promise<FullWorkItemData> {
    return this.fieldUpdateService.setStatus(workItemId, status);
  }

  public async setName(workItemId: string, name: string): Promise<FullWorkItemData> {
    return this.fieldUpdateService.setName(workItemId, name);
  }

  public async setDescription(workItemId: string, description: string | null): Promise<FullWorkItemData> {
    return this.fieldUpdateService.setDescription(workItemId, description);
  }

  public async setPriority(workItemId: string, priority: WorkItemPriority): Promise<FullWorkItemData> {
    return this.fieldUpdateService.setPriority(workItemId, priority);
  }

  public async setDueDate(workItemId: string, dueDate: string | null): Promise<FullWorkItemData> {
    return this.fieldUpdateService.setDueDate(workItemId, dueDate);
  }

  public async moveItemToStart(workItemId: string): Promise<FullWorkItemData> {
    return this.positionUpdateService.moveItemToStart(workItemId);
  }

  public async moveItemToEnd(workItemId: string): Promise<FullWorkItemData> {
    return this.positionUpdateService.moveItemToEnd(workItemId);
  }

  public async moveItemAfter(workItemIdToMove: string, targetSiblingId: string): Promise<FullWorkItemData> {
    return this.positionUpdateService.moveItemAfter(workItemIdToMove, targetSiblingId);
  }

  public async moveItemBefore(workItemIdToMove: string, targetSiblingId: string): Promise<FullWorkItemData> {
    return this.positionUpdateService.moveItemBefore(workItemIdToMove, targetSiblingId);
  }

  public async getFullTree(workItemId: string, options?: GetFullTreeOptions): Promise<WorkItemTreeNode | null> {
    return this.readingService.getFullTree(workItemId, options);
  }

  // --- NEW Method for Promote to Project ---
  public async promoteToProject(workItemId: string): Promise<FullWorkItemData> {
    return this.promoteService.promoteToProject(workItemId);
  }
}
