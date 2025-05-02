// src/services/WorkItemService.ts
import {
  WorkItemRepository, // Import main repo class
  ActionHistoryRepository, // Import main repo class
  ActionHistoryData, // Import type via index
} from '../repositories/index.js'; // USE BARREL FILE
import {
  AddWorkItemInput, // Import type
  UpdateWorkItemInput, // Import type
  ListWorkItemsFilter, // Import type
  FullWorkItemData, // Import type
} from './WorkItemServiceTypes.js'; // Assuming path is correct
import { WorkItemAddingService } from './WorkItemAddingService.js';
import { WorkItemReadingService } from './WorkItemReadingService.js';
import { WorkItemUpdateService } from './WorkItemUpdateService.js';
import { WorkItemDeleteService } from './WorkItemDeleteService.js';
import { WorkItemHistoryService } from './WorkItemHistoryService.js';

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
  private deleteService: WorkItemDeleteService;
  private historyService: WorkItemHistoryService;

  constructor(workItemRepository: WorkItemRepository, actionHistoryRepository: ActionHistoryRepository) {
    this.workItemRepository = workItemRepository;
    this.actionHistoryRepository = actionHistoryRepository;

    // Initialize specialized service classes, passing the repositories
    this.addingService = new WorkItemAddingService(workItemRepository, actionHistoryRepository);
    this.readingService = new WorkItemReadingService(workItemRepository);
    this.updateService = new WorkItemUpdateService(workItemRepository, actionHistoryRepository);
    this.deleteService = new WorkItemDeleteService(workItemRepository, actionHistoryRepository);
    this.historyService = new WorkItemHistoryService(workItemRepository, actionHistoryRepository);
  }

  /**
   * Creates a new work item with optional dependencies.
   */
  public async addWorkItem(input: AddWorkItemInput): Promise<any> {
    return this.addingService.addWorkItem(input);
  }

  /**
   * Gets a work item with its dependencies, dependents, and children.
   */
  public async getWorkItemById(id: string, filter?: { isActive?: boolean }): Promise<FullWorkItemData | null> {
    return this.readingService.getWorkItemById(id, filter);
  }

  /**
   * Lists work items based on filters.
   */
  public async listWorkItems(filter: ListWorkItemsFilter): Promise<any[]> {
    return this.readingService.listWorkItems(filter);
  }

  /**
   * Updates a work item and optionally its dependencies.
   */
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

  /**
   * Soft deletes work items and their dependencies.
   */
  public async deleteWorkItem(ids: string[]): Promise<number> {
    return this.deleteService.deleteWorkItem(ids);
  }

  /**
   * Undoes the last action.
   */
  public async undoLastAction(): Promise<ActionHistoryData | null> {
    return this.historyService.undoLastAction();
  }

  /**
   * Redoes the last undone action.
   */
  public async redoLastUndo(): Promise<ActionHistoryData | null> {
    return this.historyService.redoLastUndo();
  }
}
