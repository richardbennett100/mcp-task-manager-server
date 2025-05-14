// File: src/services/WorkItemService.ts
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
  WorkItemStatusEnum,
  WorkItemPriorityEnum,
} from './WorkItemServiceTypes.js';
import { type DependencyInput } from '../tools/add_dependencies_params.js';
import { type GetNextTaskParams } from '../tools/get_next_task_params.js';
import { WorkItemAddingService } from './WorkItemAddingService.js';
import { WorkItemReadingService } from './WorkItemReadingService.js';
import { WorkItemUpdateService } from './WorkItemUpdateService.js';
import { WorkItemFieldUpdateService } from './WorkItemFieldUpdateService.js';
import { WorkItemDependencyUpdateService } from './WorkItemDependencyUpdateService.js';
import { WorkItemPositionUpdateService } from './WorkItemPositionUpdateService.js';
import { WorkItemDeleteService } from './WorkItemDeleteService.js';
import { WorkItemHistoryService } from './WorkItemHistoryService.js';
import { WorkItemPromoteService } from './WorkItemPromoteService.js';
import { logger } from '../utils/logger.js';
import { z } from 'zod';

type WorkItemStatus = z.infer<typeof WorkItemStatusEnum>;
type WorkItemPriority = z.infer<typeof WorkItemPriorityEnum>;

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
  private promoteService: WorkItemPromoteService;

  constructor(workItemRepository: WorkItemRepository, actionHistoryRepository: ActionHistoryRepository) {
    this.workItemRepository = workItemRepository;
    this.actionHistoryRepository = actionHistoryRepository;

    this.historyService = new WorkItemHistoryService(workItemRepository, actionHistoryRepository);
    this.addingService = new WorkItemAddingService(workItemRepository, actionHistoryRepository, this.historyService);
    this.readingService = new WorkItemReadingService(workItemRepository);

    // MODIFIED: Reverted constructor calls for these services to 2 arguments
    // Assuming their current constructors only expect workItemRepository and actionHistoryRepository.
    // If they later need historyService for invalidateRedoStack, their constructors will need updating.
    this.updateService = new WorkItemUpdateService(workItemRepository, actionHistoryRepository);
    this.fieldUpdateService = new WorkItemFieldUpdateService(workItemRepository, actionHistoryRepository);
    this.dependencyUpdateService = new WorkItemDependencyUpdateService(workItemRepository, actionHistoryRepository);
    this.positionUpdateService = new WorkItemPositionUpdateService(workItemRepository, actionHistoryRepository);
    this.deleteService = new WorkItemDeleteService(workItemRepository, actionHistoryRepository);
    this.promoteService = new WorkItemPromoteService(workItemRepository, actionHistoryRepository);
  }

  public async addWorkItem(input: AddWorkItemInput): Promise<WorkItemData> {
    return this.addingService.addWorkItem(input);
  }

  public async getWorkItemById(id: string, filter?: { isActive?: boolean }): Promise<FullWorkItemData | null> {
    return this.readingService.getWorkItemById(id, filter);
  }

  public async listWorkItems(filter: ListWorkItemsFilter): Promise<WorkItemData[]> {
    return this.readingService.listWorkItems(filter);
  }

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

  public async listHistory(filter?: { work_item_id?: string | null; limit?: number }): Promise<ActionHistoryData[]> {
    return this.actionHistoryRepository.listRecentActions(filter);
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

  public async promoteToProject(workItemId: string): Promise<FullWorkItemData> {
    return this.promoteService.promoteToProject(workItemId);
  }

  public async getNextTask(params: GetNextTaskParams): Promise<WorkItemData | null> {
    logger.info(`[WorkItemService] getNextTask called with params:`, params);
    const candidateFilters = {
      scopeItemId: params.scope_item_id,
      includeTags: params.include_tags,
      excludeTags: params.exclude_tags,
    };
    const candidates = await this.workItemRepository.findCandidateTasksForSuggestion(candidateFilters);
    logger.debug(`[WorkItemService] Found ${candidates.length} initial candidates.`);

    if (candidates.length === 0) {
      logger.info('[WorkItemService] No candidate tasks found matching filters.');
      return null;
    }
    for (const candidate of candidates) {
      logger.debug(`[WorkItemService] Checking candidate: ${candidate.work_item_id} (${candidate.name})`);
      const dependencies = await this.workItemRepository.findDependencies(candidate.work_item_id, { isActive: true });
      if (dependencies.length === 0) {
        logger.info(`[WorkItemService] Found next task (no active dependencies): ${candidate.work_item_id}`);
        return candidate;
      }
      let allDependenciesMet = true;
      const dependencyIds = dependencies.map((dep) => dep.depends_on_work_item_id);
      if (dependencyIds.length > 0) {
        const dependencyItems = await this.workItemRepository.findByIds(dependencyIds, { isActive: true });
        const dependencyStatusMap = new Map(dependencyItems.map((item) => [item.work_item_id, item.status]));
        for (const depLink of dependencies) {
          const depStatus = dependencyStatusMap.get(depLink.depends_on_work_item_id);
          if (depStatus !== 'done') {
            allDependenciesMet = false;
            logger.debug(
              `[WorkItemService] Candidate ${candidate.work_item_id} blocked by dependency ${depLink.depends_on_work_item_id} (status: ${depStatus ?? 'not found/inactive'})`
            );
            break;
          }
        }
      }
      if (allDependenciesMet) {
        logger.info(`[WorkItemService] Found next task (all active dependencies met): ${candidate.work_item_id}`);
        return candidate;
      }
    }
    logger.info('[WorkItemService] No suitable task found after checking dependencies for all candidates.');
    return null;
  }
}
