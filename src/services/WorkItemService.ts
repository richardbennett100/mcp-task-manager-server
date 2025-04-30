// src/services/WorkItemService.ts
import { v4 as uuidv4 } from 'uuid';
import { PoolClient } from 'pg';
import {
  WorkItemRepository,
  WorkItemData,
  WorkItemDependencyData,
} from '../repositories/WorkItemRepository.js';
import {
  ActionHistoryRepository,
  CreateActionHistoryInput,
  CreateUndoStepInput,
  ActionHistoryData,
} from '../repositories/ActionHistoryRepository.js';
import { logger } from '../utils/logger.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import {
  AddWorkItemInput,
  UpdateWorkItemInput,
  ListWorkItemsFilter,
  FullWorkItemData
} from './WorkItemServiceTypes.js';
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

  constructor(
    workItemRepository: WorkItemRepository,
    actionHistoryRepository: ActionHistoryRepository
  ) {
    this.workItemRepository = workItemRepository;
    this.actionHistoryRepository = actionHistoryRepository;
    
    // Initialize specialized service classes
    this.addingService = new WorkItemAddingService(workItemRepository, actionHistoryRepository);
    this.readingService = new WorkItemReadingService(workItemRepository);
    this.updateService = new WorkItemUpdateService(workItemRepository, actionHistoryRepository);
    this.deleteService = new WorkItemDeleteService(workItemRepository, actionHistoryRepository);
    this.historyService = new WorkItemHistoryService(workItemRepository, actionHistoryRepository);
  }

  /**
   * Creates a new work item with optional dependencies.
   */
  public async addWorkItem(input: AddWorkItemInput): Promise<WorkItemData> {
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
  public async listWorkItems(filter: ListWorkItemsFilter): Promise<WorkItemData[]> {
    return this.readingService.listWorkItems(filter);
  }

  /**
   * Updates a work item and optionally its dependencies.
   */
  public async updateWorkItem(
    id: string,
    updates: UpdateWorkItemInput,
    dependenciesInput?: { depends_on_work_item_id: string; dependency_type?: 'finish-to-start' | 'linked' }[],
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