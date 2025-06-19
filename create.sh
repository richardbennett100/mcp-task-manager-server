#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status.

echo "Starting file creation for Svelte UI POC..."

# --- Backend Modifications (src/) ---
echo "Creating/Updating backend files in src/..."

# Create directories if they don't exist
mkdir -p src/services
mkdir -p src/api
mkdir -p src/repositories

# src/services/SseNotificationService.ts
cat << 'EOF_SRC_SERVICES_SSENOTIFICATIONSERVICE_TS' > src/services/SseNotificationService.ts
// src/services/SseNotificationService.ts
import { Response } from 'express';
import { WorkItemData, WorkItemTreeNode } from '../repositories';
import { logger } from '../utils';

interface Client {
  id: string;
  res: Response;
}

export type SseEventType = 'workItemCreated' | 'workItemUpdated' | 'workItemDeleted' | 'projectListUpdated' | 'projectTreeUpdated';

export interface SseEvent {
  type: SseEventType;
  payload: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

class SseNotificationService {
  private clients: Client[] = [];

  constructor() {
    logger.info('[SseNotificationService] Initialized');
  }

  addClient(res: Response): string {
    const clientId = Date.now().toString(); // Simple ID for POC
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // Flush the headers to establish the connection.

    const newClient = { id: clientId, res };
    this.clients.push(newClient);
    logger.info(`[SseNotificationService] Client connected: ${clientId}, Total clients: ${this.clients.length}`);

    // Send a simple connected message
    res.write(`event: connected\ndata: ${JSON.stringify({ clientId })}\n\n`);

    res.on('close', () => {
      this.removeClient(clientId);
    });

    return clientId;
  }

  removeClient(clientId: string): void {
    this.clients = this.clients.filter((client) => client.id !== clientId);
    logger.info(`[SseNotificationService] Client disconnected: ${clientId}, Total clients: ${this.clients.length}`);
  }

  public broadcast(event: SseEvent): void { // Made public for direct use if needed, e.g. by WorkItemService for undo/redo
    if (this.clients.length === 0) {
      // logger.debug('[SseNotificationService] No clients connected, skipping broadcast.');
      return;
    }
    const message = `event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`;
    logger.info(`[SseNotificationService] Broadcasting event: ${event.type} to ${this.clients.length} client(s)`);
    // logger.debug(`[SseNotificationService] Broadcast message: ${message.substring(0,100)}...`);
    this.clients.forEach((client) => client.res.write(message));
  }

  // --- Specific Notification Methods --- 

  notifyWorkItemCreated(workItem: WorkItemData, parentWorkItemId: string | null): void {
    // For simplicity, POC might just trigger a tree refresh for the parent or list refresh if root
    if (parentWorkItemId) {
        this.broadcast({ type: 'projectTreeUpdated', payload: { projectId: parentWorkItemId, reason: 'child_created', newItemId: workItem.work_item_id } });
    } else {
        this.broadcast({ type: 'projectListUpdated', payload: { reason: 'project_created', newItemId: workItem.work_item_id } });
    }
  }

  notifyWorkItemUpdated(workItem: WorkItemData, parentWorkItemId: string | null): void {
    if (parentWorkItemId) {
      this.broadcast({ type: 'projectTreeUpdated', payload: { projectId: parentWorkItemId, reason: 'item_updated', updatedItemId: workItem.work_item_id } });
      if (this.isProject(workItem)) { 
        this.broadcast({ type: 'projectTreeUpdated', payload: { projectId: workItem.work_item_id, reason: 'item_updated', updatedItemId: workItem.work_item_id } });
      }
    } else {
      this.broadcast({ type: 'projectListUpdated', payload: { reason: 'project_updated', updatedItemId: workItem.work_item_id } });
      this.broadcast({ type: 'projectTreeUpdated', payload: { projectId: workItem.work_item_id, reason: 'item_updated', updatedItemId: workItem.work_item_id } });
    }
  }

  notifyWorkItemDeleted(workItemId: string, parentWorkItemId: string | null, isProject: boolean): void {
    if (parentWorkItemId) {
      this.broadcast({ type: 'projectTreeUpdated', payload: { projectId: parentWorkItemId, reason: 'item_deleted', deletedItemId: workItemId } });
    } else if (isProject) { 
      this.broadcast({ type: 'projectListUpdated', payload: { reason: 'project_deleted', deletedItemId: workItemId } });
    }
    this.broadcast({ type: 'projectTreeUpdated', payload: { projectId: workItemId, reason: 'project_deleted_itself', deletedItemId: workItemId } });
  }

  private isProject(item: WorkItemData): boolean {
    return !item.parent_work_item_id;
  }

  notifyDependencyChanged(workItemId: string, parentWorkItemId: string | null): void {
    logger.info(`[SseNotificationService] Dependency changed for: ${workItemId}`);
    if (parentWorkItemId) {
      this.broadcast({ type: 'projectTreeUpdated', payload: { projectId: parentWorkItemId, reason: 'dependency_changed', itemId: workItemId } });
    }
    // If the item itself is a project, its tree might also need an update
    this.broadcast({ type: 'projectTreeUpdated', payload: { projectId: workItemId, reason: 'dependency_changed', itemId: workItemId } });
  }
}

const sseNotificationService = new SseNotificationService();
export default sseNotificationService;
EOF_SRC_SERVICES_SSENOTIFICATIONSERVICE_TS

# src/api/projectRoutes.ts
cat << 'EOF_SRC_API_PROJECTROUTES_TS' > src/api/projectRoutes.ts
// src/api/projectRoutes.ts
import { Router, Request, Response, NextFunction } from 'express';
import { WorkItemService } from '../services';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types'; 
import { logger } from '../utils';
import { validate as uuidValidate } from 'uuid';

export const projectRoutes = (workItemService: WorkItemService): Router => {
  const router = Router();

  // GET /api/projects - List root projects
  router.get('/projects', async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info('[API] GET /api/projects called');
      const projects = await workItemService.listWorkItems({ roots_only: true, is_active: true });
      res.json(projects);
    } catch (error) {
      logger.error('[API] Error in GET /api/projects:', error);
      if (error instanceof McpError) return next(error); 
      next(new McpError(ErrorCode.InternalError, 'Failed to list projects'));
    }
  });

  // GET /api/projects/:projectId/tree - Get full tree for a project
  router.get('/projects/:projectId/tree', async (req: Request, res: Response, next: NextFunction) => {
    const { projectId } = req.params;
    try {
      logger.info(`[API] GET /api/projects/${projectId}/tree called`);
      if (!projectId || !uuidValidate(projectId)) { // Added UUID validation
        throw new McpError(ErrorCode.InvalidParams, `Invalid Project ID format: ${projectId}`);
      }
      
      const projectTree = await workItemService.getFullTree(projectId, { 
        includeDependencies: true, 
        includeDoneStatus: true, // Show done items in the tree for read-only UI
        includeInactive: false // Typically don't show inactive unless specified
      }); 
      
      if (!projectTree) {
        // Check if the project ID itself is valid but not found, vs. just an empty tree for an existing project
        const projectExists = await workItemService.getWorkItemById(projectId);
        if (!projectExists) {
            throw new McpError(ErrorCode.NotFound, `Project with ID ${projectId} not found.`);
        }
        // If project exists but tree is null (e.g. it's 'done' and includeDoneStatus was false), send empty tree or appropriate response
        // For POC, sending the (potentially null) tree is fine. Client can handle.
      }
      res.json(projectTree); // projectTree can be null if root item doesn't meet criteria
    } catch (error) {
      logger.error(`[API] Error in GET /api/projects/${projectId}/tree:`, error);
      if (error instanceof McpError) return next(error);
      // Basic check for NotFoundError message content
      if ((error as Error).message?.toLowerCase().includes('not found')) { 
        next(new McpError(ErrorCode.NotFound, (error as Error).message));
      } else {
        next(new McpError(ErrorCode.InternalError, `Failed to get project tree for ${projectId}`));
      }
    }
  });

  return router;
};
EOF_SRC_API_PROJECTROUTES_TS

# src/api/sseRoutes.ts
cat << 'EOF_SRC_API_SSEROUTES_TS' > src/api/sseRoutes.ts
// src/api/sseRoutes.ts
import { Router, Request, Response } from 'express';
// import sseNotificationService from '../services/SseNotificationService'; 
import { logger } from '../utils';

export const sseRoutes = (): Router => {
  const router = Router();

  router.get('/events', (req: Request, res: Response) => {
    logger.info('[SSE] Client attempting to connect to /api/events');
    
    // Immediately set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // Ensure headers are sent to establish the connection

    const clientId = sseNotificationService.addClient(res); // addClient now handles setting headers and initial message

    req.on('close', () => {
      logger.info(`[SSE] Client connection closed for /api/events (ID: ${clientId})`);
      sseNotificationService.removeClient(clientId); // Ensure removeClient is called with the ID
    });
  });

  return router;
};
EOF_SRC_API_SSEROUTES_TS

# src/services/WorkItemReadingService.ts (Modified)
cat << 'EOF_SRC_SERVICES_WORKITEMREADINGSERVICE_TS' > src/services/WorkItemReadingService.ts
// Modified src/services/WorkItemReadingService.ts
import { PoolClient } from 'pg';
import {
  WorkItemRepository,
  WorkItemData,
  WorkItemDependencyData,
} from '../repositories/index.js';
import {
  FullWorkItemData,
  WorkItemTreeNode,
  GetFullTreeOptions,
} from './WorkItemServiceTypes.js';
import { NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export class WorkItemReadingService {
  private workItemRepository: WorkItemRepository;

  constructor(workItemRepository: WorkItemRepository) {
    this.workItemRepository = workItemRepository;
  }

  public async getWorkItemById(id: string, filter?: { isActive?: boolean }): Promise<FullWorkItemData | null> {
    logger.debug(`[WorkItemReadingService] Getting item by ID: ${id}, filter: ${JSON.stringify(filter)}`);
    const item = await this.workItemRepository.findFullWorkItemDataById(id, undefined, filter);
    if (!item) {
      // logger.warn(`[WorkItemReadingService] Item with ID ${id} not found.`); // Less noisy for UI calls
      return null;
    }
    return item;
  }

  public async listWorkItems(filter: { 
    parent_work_item_id?: string | null; 
    is_active?: boolean;
    roots_only?: boolean;
    status?: string[];
    priority?: string[];
  }): Promise<WorkItemData[]> {
    logger.debug('[WorkItemReadingService] Listing items with filter:', filter);
    return this.workItemRepository.findAll(filter);
  }

  private async buildTreeRecursive(
    rootItemId: string,
    allDescendants: WorkItemData[],
    allDependenciesMap: Map<string, WorkItemDependencyData[]>, 
    options: GetFullTreeOptions,
    client?: PoolClient
  ): Promise<WorkItemTreeNode | null> {
    const rootItemData = await this.workItemRepository.findById(rootItemId, { 
        isActive: options.includeInactive ? undefined : true 
    }, client);

    if (!rootItemData) return null;
    if (options.includeDoneStatus === false && rootItemData.status === 'done' && !options.includeInactive) { // Only skip if not explicitly including inactive
        // If we are including inactive items, we should not skip 'done' items based on this flag alone.
        // The includeInactive flag should take precedence for visibility if true.
        if (options.includeInactive === false) return null;
    }


    const childrenData = allDescendants.filter(
      (item) => item.parent_work_item_id === rootItemId && 
                (options.includeInactive || item.is_active) && 
                (options.includeDoneStatus || item.status !== 'done' || options.includeInactive)
    );

    const childrenNodes: WorkItemTreeNode[] = [];
    for (const childData of childrenData) {
      const childNode = await this.buildTreeRecursive(childData.work_item_id, allDescendants, allDependenciesMap, options, client);
      if (childNode) {
        childrenNodes.push(childNode);
      }
    }
    childrenNodes.sort((a, b) => (a.order_key || '').localeCompare(b.order_key || ''));

    const nodeDependencies = options.includeDependencies ? (allDependenciesMap.get(rootItemData.work_item_id) || []) : null;
    
    // Fetch names for dependencies
    let dependenciesInfo: { depends_on_id: string; depends_on_name?: string; type: string }[] | undefined = undefined;
    if (nodeDependencies && nodeDependencies.length > 0) {
        dependenciesInfo = [];
        const depIdsToFetchNames = nodeDependencies.map(d => d.depends_on_work_item_id);
        if (depIdsToFetchNames.length > 0) {
            const depItems = await this.workItemRepository.findByIds(depIdsToFetchNames, {isActive: undefined}, client); // Fetch even if inactive/done for name
            const depNameMap = new Map(depItems.map(item => [item.work_item_id, item.name]));
            for (const dep of nodeDependencies) {
                dependenciesInfo.push({
                    depends_on_id: dep.depends_on_work_item_id,
                    depends_on_name: depNameMap.get(dep.depends_on_work_item_id) || 'Unknown Task',
                    type: dep.dependency_type
                });
            }
        }
    }


    return {
      ...rootItemData,
      tags: rootItemData.tags || [], 
      dependencies: nodeDependencies, // Keep raw dependencies if needed by backend logic
      dependencies_info: dependenciesInfo, // Add user-friendly dependency info
      children: childrenNodes,
    };
  }

  public async getFullTree(
    workItemId: string,
    options?: GetFullTreeOptions,
    client?: PoolClient
  ): Promise<WorkItemTreeNode | null> {
    const effectiveOptions: GetFullTreeOptions = {
      includeDoneStatus: false, 
      includeInactive: false, 
      includeDependencies: false, 
      ...options,
    };
    logger.debug(`[WorkItemReadingService] Getting full tree for ID: ${workItemId}, options: ${JSON.stringify(effectiveOptions)}`);

    const rootItem = await this.workItemRepository.findById(workItemId, { 
        isActive: effectiveOptions.includeInactive ? undefined : true 
    }, client);

    if (!rootItem) {
      logger.info(`[WorkItemReadingService] Root item for tree with ID ${workItemId} not found or filtered out by active status.`);
      return null;
    }
     if (effectiveOptions.includeDoneStatus === false && rootItem.status === 'done' && !effectiveOptions.includeInactive) {
      logger.debug(`[WorkItemReadingService] Root item ${workItemId} is 'done' and includeDoneStatus is false (and not including inactive), returning null tree.`);
      return null;
    }

    const allDescendants = await this.workItemRepository.findAllDescendants(workItemId, client);
    
    let allDependenciesMap = new Map<string, WorkItemDependencyData[]>();
    if (effectiveOptions.includeDependencies) {
        const allItemIdsInTree = [workItemId, ...allDescendants.map(d => d.work_item_id)];
        if (allItemIdsInTree.length > 0) {
            const allDepsData = await this.workItemRepository.findDependenciesForItems(allItemIdsInTree, {isActive: true}, client);
            allDepsData.forEach(dep => {
                if (!allDependenciesMap.has(dep.work_item_id)) {
                    allDependenciesMap.set(dep.work_item_id, []);
                }
                allDependenciesMap.get(dep.work_item_id)!.push(dep);
            });
        }
    }

    return this.buildTreeRecursive(workItemId, allDescendants, allDependenciesMap, effectiveOptions, client);
  }
}
EOF_SRC_SERVICES_WORKITEMREADINGSERVICE_TS

# src/services/WorkItemService.ts (Modified)
cat << 'EOF_SRC_SERVICES_WORKITEMSERVICE_TS' > src/services/WorkItemService.ts
// Modified src/services/WorkItemService.ts
import { validate as uuidValidate } from 'uuid';
import {
  WorkItemRepository,
  ActionHistoryRepository,
  type ActionHistoryData,
  type WorkItemData,
  type CreateActionHistoryInput,
  type CreateUndoStepInput,
  WorkItemDependencyData, // Keep if used by sub-services directly
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
  PositionEnum, // Keep if used by sub-services directly
} from './WorkItemServiceTypes.js';
import { type ChildTaskInputRecursive } from '../tools/add_child_tasks_params.js';
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
// import sseNotificationServiceSingleton from './SseNotificationService'; // Import the singleton

import { logger } from '../utils/logger.js';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '../utils/errors.js';

type WorkItemStatus = z.infer<typeof WorkItemStatusEnum>;
type WorkItemPriority = z.infer<typeof WorkItemPriorityEnum>;

export class WorkItemService {
  private workItemRepository: WorkItemRepository;
  private actionHistoryRepository: ActionHistoryRepository;
  private sseNotificationService: typeof SseNotificationServiceSingleton; 

  private addingService: WorkItemAddingService;
  private readingService: WorkItemReadingService;
  private updateService: WorkItemUpdateService;
  private fieldUpdateService: WorkItemFieldUpdateService;
  private dependencyUpdateService: WorkItemDependencyUpdateService;
  private positionUpdateService: WorkItemPositionUpdateService;
  private deleteService: WorkItemDeleteService;
  private historyService: WorkItemHistoryService;
  private promoteService: WorkItemPromoteService;

  constructor(
    workItemRepository: WorkItemRepository, 
    actionHistoryRepository: ActionHistoryRepository,
    // SseNotificationService is a singleton, injected here for clarity and testability
    sseNotificationServiceInstance: typeof SseNotificationServiceSingleton 
  ) {
    this.workItemRepository = workItemRepository;
    this.actionHistoryRepository = actionHistoryRepository;
    this.sseNotificationService = sseNotificationServiceInstance;

    this.historyService = new WorkItemHistoryService(workItemRepository, actionHistoryRepository);
    
    // Pass SseNotificationService to services that need it
    this.addingService = new WorkItemAddingService(workItemRepository, actionHistoryRepository, this.historyService, this.sseNotificationService);
    this.readingService = new WorkItemReadingService(workItemRepository); 
    this.updateService = new WorkItemUpdateService(workItemRepository, actionHistoryRepository, this.sseNotificationService);
    this.fieldUpdateService = new WorkItemFieldUpdateService(workItemRepository, actionHistoryRepository, this.sseNotificationService);
    this.dependencyUpdateService = new WorkItemDependencyUpdateService(workItemRepository, actionHistoryRepository, this.sseNotificationService);
    this.positionUpdateService = new WorkItemPositionUpdateService(workItemRepository, actionHistoryRepository, this.sseNotificationService);
    this.deleteService = new WorkItemDeleteService(workItemRepository, actionHistoryRepository, this.sseNotificationService);
    this.promoteService = new WorkItemPromoteService(workItemRepository, actionHistoryRepository, this.sseNotificationService);
  }

  // --- Delegated Methods ---
  public async addWorkItem(input: AddWorkItemInput): Promise<WorkItemData> {
    // Basic validation, more specific validation can be in AddWorkItemInput schema for tools
    if (input.parent_work_item_id && !uuidValidate(input.parent_work_item_id)) {
      throw new ValidationError(`Invalid parent_work_item_id format: ${input.parent_work_item_id}`);
    }
    return this.addingService.addWorkItem(input);
  }

  public async addWorkItemTree(
    initialParentId: string,
    childTasksTree: ChildTaskInputRecursive[]
  ): Promise<WorkItemData[]> {
    if (!uuidValidate(initialParentId)) {
        throw new ValidationError(`Invalid parent_work_item_id format: ${initialParentId}`);
    }
    return this.addingService.addWorkItemTree(initialParentId, childTasksTree);
  }

  public async getWorkItemById(id: string, filter?: { isActive?: boolean }): Promise<FullWorkItemData | null> {
    if (!uuidValidate(id)) {
        // For direct service calls, it's good to validate. Tools might have Zod validation.
        // logger.warn(`[WorkItemService] getWorkItemById called with invalid UUID format: ${id}`);
        // Depending on strictness, could throw ValidationError or let repository handle it (likely returns null)
        return null; 
    }
    return this.readingService.getWorkItemById(id, filter);
  }

  public async listWorkItems(filter: ListWorkItemsFilter): Promise<WorkItemData[]> {
    return this.readingService.listWorkItems(filter);
  }

  public async updateWorkItem(
    id: string,
    updates: UpdateWorkItemInput,
    dependenciesInput?: DependencyInput[] 
  ): Promise<FullWorkItemData> {
     if (!uuidValidate(id)) {
      throw new ValidationError(`Invalid work_item_id format for update: ${id}`);
    }
    return this.updateService.updateWorkItem(id, updates, dependenciesInput);
  }

  public async deleteWorkItem(ids: string[]): Promise<number> {
    ids.forEach(id => {
        if (!uuidValidate(id)) throw new ValidationError(`Invalid work_item_id format in delete list: ${id}`);
    });
    return this.deleteService.deleteWorkItem(ids);
  }

  public async undoLastAction(): Promise<ActionHistoryData | null> {
    const result = await this.historyService.undoLastAction();
    if (result && result.work_item_id) {
        const affectedItem = await this.readingService.getWorkItemById(result.work_item_id, {isActive: undefined}); // Check current state
        if (affectedItem) {
            this.sseNotificationService.notifyWorkItemUpdated(affectedItem, affectedItem.parent_work_item_id);
        } else { // Item might have been "undone" into non-existence (e.g. undo add)
            this.sseNotificationService.notifyWorkItemDeleted(result.work_item_id, null, true); // Assume it could be a project
        }
    }
    return result;
  }

  public async redoLastUndo(): Promise<ActionHistoryData | null> {
    const result = await this.historyService.redoLastUndo();
     if (result && result.work_item_id) {
        const affectedItem = await this.readingService.getWorkItemById(result.work_item_id, {isActive: undefined});
        if (affectedItem) {
            this.sseNotificationService.notifyWorkItemUpdated(affectedItem, affectedItem.parent_work_item_id);
        }
        // If redo made an item exist again, it's an update/create from UI perspective
    }
    return result;
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
     if (!uuidValidate(workItemId)) {
        // logger.warn(`[WorkItemService] getFullTree called with invalid UUID format: ${id}`);
        return null;
    }
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
EOF_SRC_SERVICES_WORKITEMSERVICE_TS

# src/createServer.ts (Modified)
cat << 'EOF_SRC_CREATESERVER_TS' > src/createServer.ts
// Modified src/createServer.ts
import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { McpServer, McpSession } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ConfigurationManager } from './config/ConfigurationManager.js';
import { logger } from './utils/logger.js';
import { DatabaseManager } from './db/DatabaseManager.js';
import { WorkItemRepository, ActionHistoryRepository } from './repositories/index.js';
import { WorkItemService } from './services/WorkItemService.js';
import { initializeTools } from './tools/index.js';
import { projectRoutes } from './api/projectRoutes.js'; // Ensure .js extension if your tsconfig module is ESNext
import { sseRoutes } from './api/sseRoutes.js';       // Ensure .js extension
// import sseNotificationServiceSingleton from './services/SseNotificationService.js'; // Import the singleton

export async function createServer(): Promise<Express> {
  const app = express();
  
  // CORS configuration - make it more specific if needed for production
  app.use(cors({
    origin: '*', // Allow all origins for POC, restrict in production
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));
  app.options('*', cors()); // Enable pre-flight requests for all routes

  app.use(express.json());

  const configManager = ConfigurationManager.getInstance();
  logger.info('Configuration Manager initialized.');
  logger.info(`Log level set to: ${configManager.get('LOG_LEVEL')}`);

  const dbManager = await DatabaseManager.getInstance();
  logger.info('Database Manager initialized.');

  const pool = dbManager.getPool();
  const workItemRepository = new WorkItemRepository(pool);
  const actionHistoryRepository = new ActionHistoryRepository(pool);
  logger.info('Repositories initialized.');

  // SseNotificationService is a singleton, imported directly
  const workItemService = new WorkItemService(workItemRepository, actionHistoryRepository, SseNotificationServiceSingleton);
  logger.info('Services initialized.');

  const mcpServer = new McpServer({
    validateIncomingMessages: true,
    validateOutgoingMessages: true,
    logMessages: configManager.get('MCP_LOG_MESSAGES') === 'true',
  });
  logger.info('MCP Server initialized.');

  initializeTools(mcpServer, workItemService);
  logger.info('Tools initialized and registered.');

  app.post('/mcp', async (req: Request, res: Response) => {
    // const { id, method, params, jsonrpc } = req.body; // Unused vars
    logger.debug('MCP request received:', req.body);
    const session: McpSession | null = null;
    const response = await mcpServer.process(req.body, session);
    logger.debug('MCP response:', response);
    if (response) {
      res.json(response);
    } else {
      res.status(204).send();
    }
  });

  // HTTP API Routes
  app.use('/api', projectRoutes(workItemService));
  logger.info('HTTP API routes for projects registered under /api.');

  // SSE Routes
  app.use('/api', sseRoutes()); 
  logger.info('SSE event route registered under /api/events.');

  // Default error handler
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => { // Added next
    logger.error('Unhandled error:', err);
    if (err instanceof McpError) {
      let statusCode = 500;
      // Simplified status code mapping
      if (err.code === ErrorCode.InvalidParams || err.code === ErrorCode.ParseError || err.code === ErrorCode.InvalidRequest) statusCode = 400;
      else if (err.code === ErrorCode.NotFound) statusCode = 404;
      else if (err.code === ErrorCode.Unauthorized) statusCode = 401;
      else if (err.code === ErrorCode.Forbidden) statusCode = 403;
      else if (err.code === ErrorCode.MethodNotFound) statusCode = 405;
      
      return res.status(statusCode).json({
        jsonrpc: "2.0", // MCP errors should also follow JSON-RPC structure if possible
        error: {
          code: err.code,
          message: err.message,
          data: err.details, // MCP details often go into data
        },
        id: (req.body && req.body.id !== undefined) ? req.body.id : null, // Try to include request ID
      });
    }
    // For other errors, send a generic 500
    return res.status(500).json({
      jsonrpc: "2.0",
      error: {
        code: -32000, // Generic server error code
        message: err.message || 'An unexpected internal error occurred.',
      },
      id: (req.body && req.body.id !== undefined) ? req.body.id : null,
    });
  });

  return app;
}
EOF_SRC_CREATESERVER_TS

# src/services/WorkItemAddingService.ts (Modified - ensure tags and dependencies are handled if part of input)
cat << 'EOF_SRC_SERVICES_WORKITEMADDINGSERVICE_TS' > src/services/WorkItemAddingService.ts
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
import { AddWorkItemInput, PositionEnum } from './WorkItemServiceTypes.js';
import { ChildTaskInputRecursive } from '../tools/add_child_tasks_params.js'; // Assuming tags might be part of this
import { WorkItemHistoryService } from './WorkItemHistoryService.js';
// import sseNotificationServiceInstance from './SseNotificationService'; 
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
    insertAt?: typeof PositionEnum._type,
    insertAfterId?: string,
    insertBeforeId?: string
  ): Promise<{ keyBefore: string | null; keyAfter: string | null }> {
    let keyBefore: string | null = null;
    let keyAfter: string | null = null;

    if (insertAfterId) {
      const afterItem = await this.workItemRepository.findById(insertAfterId, { isActive: true }, client);
      if (!afterItem) {
        throw new NotFoundError(`Work item with ID ${insertAfterId} (for insertAfter) not found or is inactive.`);
      }
      if (afterItem.parent_work_item_id !== parentId) {
        throw new ValidationError(`Item ${insertAfterId} (for insertAfter) is not a sibling under parent ${parentId}.`);
      }
      keyBefore = afterItem.order_key;
      const neighbours = await this.workItemRepository.findNeighbourOrderKeys(parentId, insertAfterId, 'after', client);
      keyAfter = neighbours.after;
    } else if (insertBeforeId) {
      const beforeItem = await this.workItemRepository.findById(insertBeforeId, { isActive: true }, client);
      if (!beforeItem) {
        throw new NotFoundError(`Work item with ID ${insertBeforeId} (for insertBefore) not found or is inactive.`);
      }
      if (beforeItem.parent_work_item_id !== parentId) {
        throw new ValidationError(
          `Item ${insertBeforeId} (for insertBefore) is not a sibling under parent ${parentId}.`
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
    } else { // Default to end
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
    itemData: ChildTaskInputRecursive, // This type should include optional tags
    parentId: string | null,
    client: PoolClient
  ): Promise<WorkItemData> {
    logger.debug(
      `[WorkItemAddingService-createSingleWorkItemInTree] Creating item: \"${itemData.name}\" under parent: ${parentId}`
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
      tags: itemData.tags || [], // Ensure tags are handled
    };

    // For createSingleWorkItemInTree, dependencies are not handled here, only in addWorkItem or if ChildTaskInputRecursive includes them.
    const createdItem = await this.workItemRepository.create(client, newWorkItemData, undefined);

    if (!createdItem) {
      throw new DatabaseError(`Failed to create work item \"${itemData.name}\" in repository.`);
    }
    logger.info(
      `[WorkItemAddingService] Created single item in tree: ${createdItem.work_item_id} (\"${createdItem.name}\")`
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
      const parentItem = await this.workItemRepository.findById(currentParentId, {isActive: true}, client); // Check active parent
      if (!parentItem) {
        throw new NotFoundError(`Parent work item with ID ${currentParentId} not found or is inactive for adding children.`);
      }
      if (parentItem.status === 'done') {
        throw new ValidationError(
          `Parent work item \"${parentItem.name}\" (ID: ${currentParentId}) is \"done\", cannot add children.`
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
    logger.info(`[WorkItemAddingService] Adding work item tree under initial parent ${initialParentId}`);

    if (!uuidValidate(initialParentId)) { // Validation moved to WorkItemService, but good to have defensively
      throw new ValidationError(`Invalid parent_work_item_id format: ${initialParentId}`);
    }

    const parentItem = await this.workItemRepository.findById(initialParentId, {isActive: true}); // Check active parent
    if (!parentItem) {
      throw new NotFoundError(`Initial parent work item with ID ${initialParentId} not found or is inactive.`);
    }
    if (parentItem.status === 'done') {
      throw new ValidationError(
        `Initial parent work item \"${parentItem.name}\" (ID: ${initialParentId}) is marked as \"done\" and cannot have new tasks added.`
      );
    }

    const allCreatedItems: WorkItemData[] = [];

    await this.actionHistoryRepository.withTransaction(async (txClient) => {
      await this.addWorkItemTreeRecursiveInternal(initialParentId, childTasksTree, txClient, allCreatedItems);

      if (allCreatedItems.length > 0) {
        const topLevelCreatedNames = childTasksTree.map((t) => t.name).join(', ');
        const description = `Added task tree (${allCreatedItems.length} total items) under \"${parentItem.name}\": ${topLevelCreatedNames}`;

        const actionData: CreateActionHistoryInput = {
          action_type: 'ADD_TASK_TREE',
          work_item_id: initialParentId,
          description: description.substring(0, 250),
        };

        const undoStepsForBatch: CreateUndoStepInput[] = [];
        // For undoing a tree creation, mark all created items as inactive
        allCreatedItems.forEach((createdItem, index) => {
          undoStepsForBatch.push({
            step_order: index + 1, // Order might matter for complex undos, simple for now
            step_type: 'UPDATE',
            table_name: 'work_items',
            record_id: createdItem.work_item_id,
            old_data: { is_active: false }, // The state before this action (non-existent, effectively inactive)
            new_data: { ...createdItem, is_active: true }, // The state after this action
          });
        });
        
        const createdAction = await this.actionHistoryRepository.createActionWithSteps(actionData, undoStepsForBatch, txClient);
        // Invalidate redo stack within the same transaction
        await this.historyService.invalidateRedoStack(txClient, createdAction.action_id); 
        logger.info(
          `[WorkItemAddingService] Task tree creation transaction committed. Action ID: ${createdAction.action_id}. Total items: ${allCreatedItems.length}.`
        );
        
      } else {
        logger.info(`[WorkItemAddingService] No items were specified in the task tree for parent ${initialParentId}.`);
      }
    });
    
    // Notify SSE after transaction commits
    // For addWorkItemTree, a single notification for the parent tree update is often sufficient for POC
    if (allCreatedItems.length > 0) {
        this.sseService.notifyWorkItemUpdated(parentItem, parentItem.parent_work_item_id); // Notify parent tree has changed
    }


    return allCreatedItems;
  }

  public async addWorkItem(input: AddWorkItemInput): Promise<WorkItemData> {
    logger.info('[WorkItemAddingService] addWorkItem called with input:', input);
    let createdItemGlobal: WorkItemData | undefined;

    await this.actionHistoryRepository.withTransaction(async (txClient) => {
        if (input.parent_work_item_id && !uuidValidate(input.parent_work_item_id)) {
          throw new ValidationError(`Invalid parent_work_item_id format: ${input.parent_work_item_id}`);
        }
        
        const parentId = input.parent_work_item_id || null;
        if (parentId) {
            const parentItemData = await this.workItemRepository.findById(parentId, {isActive: true}, txClient);
            if (!parentItemData) throw new NotFoundError(`Parent work item with ID ${parentId} not found or is inactive.`);
            if (parentItemData.status === 'done')
            throw new ValidationError(`Parent work item \"${parentItemData.name}\" (ID: ${parentId}) is \"done\".`);
        }

        const { keyBefore, keyAfter } = await this.determineOrderKeys(
            txClient,
            parentId,
            input.insertAt,
            input.insertAfter_work_item_id,
            input.insertBefore_work_item_id
        );
        const order_key = WorkItemUtilsService.calculateOrderKey(keyBefore, keyAfter);
        if (order_key === null) throw new DatabaseError('Failed to calculate order key.');

        const now = new Date().toISOString();
        const newWorkItemData: WorkItemData = { // Explicitly WorkItemData
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
            tags: input.tags || [], // Ensure tags are handled
        };

        let dependenciesForRepoCreate: Omit<WorkItemDependencyData, 'is_active'>[] | undefined = undefined;
        if (input.dependencies && input.dependencies.length > 0) {
            dependenciesForRepoCreate = input.dependencies.map((d) => ({
            work_item_id: newWorkItemData.work_item_id, // This is correct, work_item_id is of the item being created
            depends_on_work_item_id: d.depends_on_work_item_id,
            dependency_type: d.dependency_type || 'finish-to-start',
            // is_active will be set by repository.create or handled there
            }));
        }
        const createdItem = await this.workItemRepository.create(txClient, newWorkItemData, dependenciesForRepoCreate);
        if (!createdItem) throw new DatabaseError('Failed to create item in repository.');
        createdItemGlobal = createdItem; 

        const undoStepsForSingleAdd: CreateUndoStepInput[] = [
            {
            step_order: 1,
            step_type: 'UPDATE', // To undo a create, we mark it as inactive
            table_name: 'work_items',
            record_id: createdItem.work_item_id,
            old_data: { is_active: false }, 
            new_data: { ...createdItem }, // The state after creation
            },
        ];

        if (dependenciesForRepoCreate) { // These are the dependencies that were just created
            dependenciesForRepoCreate.forEach((dep, index) => {
            undoStepsForSingleAdd.push({
                step_order: 2 + index,
                step_type: 'UPDATE', // To undo adding a dependency, mark it inactive
                table_name: 'work_item_dependencies',
                record_id: `${createdItem.work_item_id}:${dep.depends_on_work_item_id}`,
                old_data: { is_active: false }, 
                new_data: { ...dep, work_item_id: createdItem.work_item_id, is_active: true }, 
            });
            });
        }
        
        const actionInput: CreateActionHistoryInput = {
            action_type: 'ADD_WORK_ITEM',
            work_item_id: createdItem.work_item_id,
            description: `Added work item \"${createdItem.name}\"`,
        };
        
        const createdAction = await this.actionHistoryRepository.createActionWithSteps(
            actionInput,
            undoStepsForSingleAdd,
            txClient // Pass client for transaction consistency
        );
        await this.historyService.invalidateRedoStack(txClient, createdAction.action_id);

        logger.info(
            `[WorkItemAddingService] Added single work item ${createdItem.work_item_id}. Action ID: ${createdAction.action_id}`
        );
    });

    if (!createdItemGlobal) {
        throw new DatabaseError('Failed to create work item, item reference not set.');
    }
    
    this.sseService.notifyWorkItemCreated(createdItemGlobal, createdItemGlobal.parent_work_item_id);
    return createdItemGlobal;
  }
}
EOF_SRC_SERVICES_WORKITEMADDINGSERVICE_TS

# src/services/WorkItemUpdateService.ts (Modified)
cat << 'EOF_SRC_SERVICES_WORKITEMUPDATESERVICE_TS' > src/services/WorkItemUpdateService.ts
// Modified src/services/WorkItemUpdateService.ts
import { PoolClient } from 'pg';
import { validate as uuidValidate } from 'uuid';
import {
  WorkItemRepository,
  ActionHistoryRepository,
  WorkItemData,
  WorkItemDependencyData,
  FullWorkItemData,
  CreateActionHistoryInput,
  CreateUndoStepInput
} from '../repositories/index.js';
import { UpdateWorkItemInput } from './WorkItemServiceTypes.js';
import { DependencyInput } from '../tools/add_dependencies_params.js'; // Ensure this type is correctly defined/used
// import sseNotificationServiceInstance from './SseNotificationService';
import { NotFoundError, ValidationError, DatabaseError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export class WorkItemUpdateService {
  private workItemRepository: WorkItemRepository;
  private actionHistoryRepository: ActionHistoryRepository;
  private sseService: typeof SseNotificationServiceInstance;

  constructor(
    workItemRepository: WorkItemRepository,
    actionHistoryRepository: ActionHistoryRepository,
    sseService: typeof SseNotificationServiceInstance
  ) {
    this.workItemRepository = workItemRepository;
    this.actionHistoryRepository = actionHistoryRepository;
    this.sseService = sseService;
  }

  public async updateWorkItem(
    workItemId: string,
    updates: UpdateWorkItemInput, // This is Partial<WorkItemData> essentially
    dependenciesInput?: DependencyInput[] // This is for ADDING/SETTING dependencies
  ): Promise<FullWorkItemData> {
    logger.info(`[WorkItemUpdateService] Updating work item ID: ${workItemId} with data:`, { updates, dependenciesInput });
    if (!uuidValidate(workItemId)) {
      throw new ValidationError(`Invalid work_item_id format: ${workItemId}`);
    }

    let finalUpdatedFullItem: FullWorkItemData | null = null;

    await this.actionHistoryRepository.withTransaction(async (txClient) => {
      const originalItem = await this.workItemRepository.findFullWorkItemDataById(workItemId, txClient, { isActive: undefined });
      if (!originalItem) {
        throw new NotFoundError(`Work item with ID ${workItemId} not found.`);
      }

      const undoSteps: CreateUndoStepInput[] = [];
      
      // 1. Handle field updates
      const itemUpdatePayload: Partial<WorkItemData> = { ...updates };
      // Remove fields that are not direct properties of work_items or handled separately
      delete (itemUpdatePayload as any).dependencies; 

      if (Object.keys(itemUpdatePayload).length > 0) {
        itemUpdatePayload.updated_at = new Date().toISOString();
        
        const originalItemFieldsForUndo: Partial<WorkItemData> = {};
        for (const key in itemUpdatePayload) {
            if (Object.prototype.hasOwnProperty.call(originalItem, key)) {
                (originalItemFieldsForUndo as any)[key] = (originalItem as any)[key];
            }
        }
        originalItemFieldsForUndo.updated_at = originalItem.updated_at; // Capture original updated_at

        await this.workItemRepository.update(txClient, workItemId, itemUpdatePayload);
        undoSteps.push({
          step_order: undoSteps.length + 1,
          step_type: 'UPDATE',
          table_name: 'work_items',
          record_id: workItemId,
          old_data: originalItemFieldsForUndo,
          new_data: { ...itemUpdatePayload, work_item_id: workItemId },
        });
      }

      // 2. Handle dependencies (if provided, assume it's a "set" operation for POC: remove old, add new)
      if (dependenciesInput !== undefined) { // Check for undefined to allow empty array to clear deps
        const existingDeps = await this.workItemRepository.findDependencies(workItemId, {isActive: true}, txClient);
        
        // Mark existing dependencies for "undo add" (i.e., they were active)
        for (const dep of existingDeps) {
            await this.workItemRepository.removeDependency(txClient, workItemId, dep.depends_on_work_item_id);
            undoSteps.push({
                step_order: undoSteps.length + 1,
                step_type: 'UPDATE', 
                table_name: 'work_item_dependencies',
                record_id: `${workItemId}:${dep.depends_on_work_item_id}`,
                old_data: { ...dep, is_active: true }, // It was active
                new_data: { is_active: false },       // It becomes inactive (deleted)
            });
        }

        // Add new dependencies and mark them for "undo remove" (i.e., they were not active)
        for (const depInput of dependenciesInput) {
            const depTargetItem = await this.workItemRepository.findById(depInput.depends_on_work_item_id, {isActive: true}, txClient);
            if (!depTargetItem) throw new NotFoundError(`Dependency target ${depInput.depends_on_work_item_id} not found or inactive.`);

            const newDepData: WorkItemDependencyData = {
                work_item_id: workItemId,
                depends_on_work_item_id: depInput.depends_on_work_item_id,
                dependency_type: depInput.dependency_type || 'finish-to-start',
                is_active: true
            };
            await this.workItemRepository.addDependency(txClient, newDepData);
            undoSteps.push({
                step_order: undoSteps.length + 1,
                step_type: 'UPDATE', 
                table_name: 'work_item_dependencies',
                record_id: `${workItemId}:${depInput.depends_on_work_item_id}`,
                old_data: { is_active: false },       // It was not active/existent
                new_data: { ...newDepData }, // It becomes active
            });
        }
         // If dependencies were modified, the main item's updated_at should also be touched if not already by field updates
        if (Object.keys(itemUpdatePayload).length === 0 && dependenciesInput.length > 0) { // Only if no other fields changed
            const newUpdatedAt = new Date().toISOString();
            await this.workItemRepository.update(txClient, workItemId, { updated_at: newUpdatedAt });
            undoSteps.push({
                step_order: undoSteps.length + 1,
                step_type: 'UPDATE',
                table_name: 'work_items',
                record_id: workItemId,
                old_data: { updated_at: originalItem.updated_at }, // originalItem.updated_at might be stale if itemUpdatePayload was processed
                new_data: { updated_at: newUpdatedAt },
            });
        }
      }
      
      if (undoSteps.length > 0) {
        const actionDescription = `Updated work item \"${originalItem.name}\" (ID: ${workItemId}).`;
        const actionInput: CreateActionHistoryInput = {
          action_type: 'UPDATE_WORK_ITEM',
          work_item_id: workItemId,
          description: actionDescription.substring(0, 250),
        };
        await this.actionHistoryRepository.createActionWithSteps(actionInput, undoSteps, txClient);
      } else {
        logger.info(`[WorkItemUpdateService] No actual changes made to work item ${workItemId}.`);
      }
    });

    finalUpdatedFullItem = await this.workItemRepository.findFullWorkItemDataById(workItemId, undefined, {isActive: undefined}); // Fetch final state
    if (!finalUpdatedFullItem) {
      throw new DatabaseError('Failed to retrieve updated work item after transaction.');
    }

    this.sseService.notifyWorkItemUpdated(finalUpdatedFullItem, finalUpdatedFullItem.parent_work_item_id);
    return finalUpdatedFullItem;
  }
}
EOF_SRC_SERVICES_WORKITEMUPDATESERVICE_TS

# src/services/WorkItemDeleteService.ts (Modified)
cat << 'EOF_SRC_SERVICES_WORKITEMDELETESERVICE_TS' > src/services/WorkItemDeleteService.ts
// Modified src/services/WorkItemDeleteService.ts
import { PoolClient } from 'pg';
import { validate as uuidValidate } from 'uuid';
import {
  WorkItemRepository,
  ActionHistoryRepository,
  CreateActionHistoryInput,
  CreateUndoStepInput,
  WorkItemData
} from '../repositories/index.js';
// import sseNotificationServiceInstance from './SseNotificationService';
import { logger } from '../utils/logger.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';

export class WorkItemDeleteService {
  private workItemRepository: WorkItemRepository;
  private actionHistoryRepository: ActionHistoryRepository;
  private sseService: typeof SseNotificationServiceInstance;


  constructor(
    workItemRepository: WorkItemRepository,
    actionHistoryRepository: ActionHistoryRepository,
    sseService: typeof SseNotificationServiceInstance
  ) {
    this.workItemRepository = workItemRepository;
    this.actionHistoryRepository = actionHistoryRepository;
    this.sseService = sseService;
  }

  private async collectItemsForDeletion(itemId: string, client: PoolClient, collectedItems: WorkItemData[]): Promise<void> {
    const item = await this.workItemRepository.findById(itemId, { isActive: true }, client); 
    if (item) {
      collectedItems.push(item); // Add current item first
      const children = await this.workItemRepository.findAll({ parent_work_item_id: itemId, is_active: true }, client);
      for (const child of children) {
        await this.collectItemsForDeletion(child.work_item_id, client, collectedItems); // Recurse
      }
    }
  }

  public async deleteWorkItem(ids: string[]): Promise<number> {
    logger.info(`[WorkItemDeleteService] Attempting to delete work items with IDs: ${ids.join(', ')}`);
    let successfullyDeletedCount = 0;
    const allAffectedItemsForSse: { id: string; parentId: string | null, isProject: boolean }[] = [];

    for (const id of ids) {
      if (!uuidValidate(id)) {
        logger.warn(`[WorkItemDeleteService] Invalid UUID format for deletion: ${id}. Skipping.`);
        continue;
      }

      const itemsToDeleteInTx: WorkItemData[] = [];
      let rootItemForActionName = 'Unknown Item';
      let rootItemParentId: string | null = null;
      let rootItemIsProject = false;

      await this.actionHistoryRepository.withTransaction(async (txClient) => {
        const rootItem = await this.workItemRepository.findById(id, { isActive: true }, txClient);
        if (!rootItem) {
          logger.warn(`[WorkItemDeleteService] Work item ${id} not found or already inactive. Skipping.`);
          return; // Exit this specific item's transaction
        }
        rootItemForActionName = rootItem.name;
        rootItemParentId = rootItem.parent_work_item_id;
        rootItemIsProject = !rootItem.parent_work_item_id;

        await this.collectItemsForDeletion(id, txClient, itemsToDeleteInTx);
        
        if (itemsToDeleteInTx.length === 0) {
            logger.warn(`[WorkItemDeleteService] No active items found for deletion hierarchy starting with ${id}.`);
            return;
        }

        const undoSteps: CreateUndoStepInput[] = [];
        // Process in reverse order for correct undo (children first, then parent)
        // This ensures parent is reactivated after children if undoing.
        const itemsToProcessForUndo = [...itemsToDeleteInTx].reverse(); 

        for (const item of itemsToProcessForUndo) {
            undoSteps.push({
                step_order: undoSteps.length + 1,
                step_type: 'UPDATE',
                table_name: 'work_items',
                record_id: item.work_item_id,
                old_data: { ...item, is_active: true }, // It was active
                new_data: { is_active: false },         // It becomes inactive
            });
            await this.workItemRepository.update(txClient, item.work_item_id, { is_active: false, updated_at: new Date().toISOString() });
            
            // Add to SSE list if it's the primary item or for general notification
             allAffectedItemsForSse.push({ 
                id: item.work_item_id, 
                parentId: item.parent_work_item_id, 
                isProject: !item.parent_work_item_id
            });
        }
        
        const actionDescription = `Deleted work item \"${rootItemForActionName}\" (ID: ${id}) and ${itemsToDeleteInTx.length -1} of its active descendants.`;
        const actionInput: CreateActionHistoryInput = {
            action_type: 'DELETE_WORK_ITEM',
            work_item_id: id, // Action is on the root item of this delete operation
            description: actionDescription.substring(0, 250),
        };

        await this.actionHistoryRepository.createActionWithSteps(actionInput, undoSteps, txClient);
        successfullyDeletedCount++; 
      });
    }

    // Notify SSE after all transactions for the batch are done
    // This sends individual delete events. The UI might prefer projectTreeUpdated for parent.
    const uniqueSseNotifications = new Map<string, { id: string; parentId: string | null, isProject: boolean }>();
    allAffectedItemsForSse.forEach(item => uniqueSseNotifications.set(item.id, item));
    
    uniqueSseNotifications.forEach(detail => {
        this.sseService.notifyWorkItemDeleted(detail.id, detail.parentId, detail.isProject);
    });


    logger.info(`[WorkItemDeleteService] Finished deletion process. Root items marked inactive: ${successfullyDeletedCount}`);
    return successfullyDeletedCount;
  }
}
EOF_SRC_SERVICES_WORKITEMDELETESERVICE_TS

# src/services/WorkItemFieldUpdateService.ts (Modified)
cat << 'EOF_SRC_SERVICES_WORKITEMFIELDUPDATESERVICE_TS' > src/services/WorkItemFieldUpdateService.ts
// Modified src/services/WorkItemFieldUpdateService.ts
import { PoolClient } from 'pg';
import { validate as uuidValidate } from 'uuid';
import {
  WorkItemRepository,
  ActionHistoryRepository,
  WorkItemData,
  FullWorkItemData,
  CreateActionHistoryInput,
  CreateUndoStepInput,
} from '../repositories/index.js';
import { WorkItemStatusEnum, WorkItemPriorityEnum } from './WorkItemServiceTypes.js';
// import sseNotificationServiceInstance from './SseNotificationService';
import { NotFoundError, ValidationError, DatabaseError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { z } from 'zod';

type WorkItemStatus = z.infer<typeof WorkItemStatusEnum>;
type WorkItemPriority = z.infer<typeof WorkItemPriorityEnum>;

export class WorkItemFieldUpdateService {
  private workItemRepository: WorkItemRepository;
  private actionHistoryRepository: ActionHistoryRepository;
  private sseService: typeof SseNotificationServiceInstance;

  constructor(
    workItemRepository: WorkItemRepository,
    actionHistoryRepository: ActionHistoryRepository,
    sseService: typeof SseNotificationServiceInstance
  ) {
    this.workItemRepository = workItemRepository;
    this.actionHistoryRepository = actionHistoryRepository;
    this.sseService = sseService;
  }

  private async updateFieldAndNotify<T extends WorkItemData[K], K extends keyof WorkItemData>(
    workItemId: string,
    fieldName: K,
    value: T,
    actionType: CreateActionHistoryInput['action_type'],
    descriptionTemplate: string
  ): Promise<FullWorkItemData> {
    if (!uuidValidate(workItemId)) {
      throw new ValidationError(`Invalid work_item_id format: ${workItemId}`);
    }

    let finalUpdatedFullItem: FullWorkItemData | null = null;

    await this.actionHistoryRepository.withTransaction(async (txClient) => {
      const originalItem = await this.workItemRepository.findById(workItemId, {isActive: true}, txClient);
      if (!originalItem) {
        throw new NotFoundError(`Work item with ID ${workItemId} not found or is inactive.`);
      }

      const oldValue = originalItem[fieldName];
      
      // Deep comparison for objects/arrays might be needed if field can be complex type
      if (JSON.stringify(oldValue) === JSON.stringify(value)) {
        logger.info(`[WorkItemFieldUpdateService] Field ${String(fieldName)} for item ${workItemId} already has value ${String(value)}. No update needed.`);
        // finalUpdatedFullItem = await this.workItemRepository.findFullWorkItemDataById(workItemId, txClient, {isActive: true});
        // if (!finalUpdatedFullItem) throw new NotFoundError(`Work item ${workItemId} disappeared after no-op update check.`);
        // Skip history creation and SSE if no change
        return; 
      }

      const updatePayload = { [fieldName]: value, updated_at: new Date().toISOString() } as Partial<WorkItemData>; 
      await this.workItemRepository.update(txClient, workItemId, updatePayload);

      const undoSteps: CreateUndoStepInput[] = [{\n        step_order: 1,
        step_type: 'UPDATE',
        table_name: 'work_items',
        record_id: workItemId,
        // For undo, restore original value and original updated_at
        old_data: { [fieldName]: oldValue, updated_at: originalItem.updated_at }, 
        new_data: { [fieldName]: value, updated_at: updatePayload.updated_at },
      }];

      const description = descriptionTemplate
        .replace('{itemName}', originalItem.name)
        .replace('{itemId}', workItemId)
        .replace('{oldValue}', String(oldValue)) // Simple string conversion for description
        .replace('{newValue}', String(value)); 

      const actionInput: CreateActionHistoryInput = {
        action_type: actionType,
        work_item_id: workItemId,
        description: description.substring(0, 250),
      };
      await this.actionHistoryRepository.createActionWithSteps(actionInput, undoSteps, txClient);
    });
    
    // Fetch the full item outside the transaction to ensure it reflects the committed state
    // This is important because if the transaction was skipped due to no change, finalUpdatedFullItem would be null
    finalUpdatedFullItem = await this.workItemRepository.findFullWorkItemDataById(workItemId, undefined, {isActive: true});
    if (!finalUpdatedFullItem) {
        // This could happen if the item became inactive by another process, or if the no-op check logic has a flaw
        const checkItem = await this.workItemRepository.findById(workItemId, {isActive: undefined});
        if (!checkItem) throw new NotFoundError(`Work item with ID ${workItemId} not found after update attempt.`);
        throw new DatabaseError(`Work item with ID ${workItemId} found but could not be retrieved as FullWorkItemData or is inactive.`);
    }

    this.sseService.notifyWorkItemUpdated(finalUpdatedFullItem, finalUpdatedFullItem.parent_work_item_id);
    return finalUpdatedFullItem;
  }

  public async setStatus(workItemId: string, status: WorkItemStatus): Promise<FullWorkItemData> {
    WorkItemStatusEnum.parse(status); 
    return this.updateFieldAndNotify<'status', WorkItemStatus>(\n      workItemId, 'status', status, 'SET_STATUS',
      `Set status of \"{itemName}\" (ID: {itemId}) from \"{oldValue}\" to \"{newValue}\"`
    );
  }

  public async setName(workItemId: string, name: string): Promise<FullWorkItemData> {
    if (name.trim().length === 0) throw new ValidationError('Name cannot be empty.');
    return this.updateFieldAndNotify<'name', string>(\n      workItemId, 'name', name, 'SET_NAME',
      `Set name of item (ID: {itemId}) from \"{oldValue}\" to \"{newValue}\"`
    );
  }

  public async setDescription(workItemId: string, description: string | null): Promise<FullWorkItemData> {
    return this.updateFieldAndNotify<'description', string | null>(\n      workItemId, 'description', description, 'SET_DESCRIPTION',
      `Set description of \"{itemName}\" (ID: {itemId})`
    );
  }

  public async setPriority(workItemId: string, priority: WorkItemPriority): Promise<FullWorkItemData> {
    WorkItemPriorityEnum.parse(priority); 
    return this.updateFieldAndNotify<'priority', WorkItemPriority>(\n      workItemId, 'priority', priority, 'SET_PRIORITY',
      `Set priority of \"{itemName}\" (ID: {itemId}) from \"{oldValue}\" to \"{newValue}\"`
    );
  }

  public async setDueDate(workItemId: string, dueDate: string | null): Promise<FullWorkItemData> {
    if (dueDate && isNaN(new Date(dueDate).getTime())) {
      throw new ValidationError('Invalid due date format. Please use ISO 8601 format.');
    }
    return this.updateFieldAndNotify<'due_date', string | null>(\n      workItemId, 'due_date', dueDate, 'SET_DUE_DATE',
      `Set due date of \"{itemName}\" (ID: {itemId}) to \"{newValue}\"`
    );
  }
}
EOF_SRC_SERVICES_WORKITEMFIELDUPDATESERVICE_TS

# src/services/WorkItemPositionUpdateService.ts (Modified)
cat << 'EOF_SRC_SERVICES_WORKITEMPOSITIONUPDATESERVICE_TS' > src/services/WorkItemPositionUpdateService.ts
// Modified src/services/WorkItemPositionUpdateService.ts
import { PoolClient } from 'pg';
import { validate as uuidValidate } from 'uuid';
import {
  WorkItemRepository,
  ActionHistoryRepository,
  WorkItemData,
  FullWorkItemData,
  CreateActionHistoryInput,
  CreateUndoStepInput,
} from '../repositories/index.js';
import { WorkItemUtilsService } from './WorkItemUtilsService.js';
// import sseNotificationServiceInstance from './SseNotificationService';
import { NotFoundError, ValidationError, DatabaseError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export class WorkItemPositionUpdateService {
  private workItemRepository: WorkItemRepository;
  private actionHistoryRepository: ActionHistoryRepository;
  private sseService: typeof SseNotificationServiceInstance;

  constructor(
    workItemRepository: WorkItemRepository,
    actionHistoryRepository: ActionHistoryRepository,
    sseService: typeof SseNotificationServiceInstance
  ) {
    this.workItemRepository = workItemRepository;
    this.actionHistoryRepository = actionHistoryRepository;
    this.sseService = sseService;
  }

  private async updatePositionAndNotify(
    workItemId: string,
    newOrderKey: string,
    actionType: CreateActionHistoryInput['action_type'],
    descriptionTemplate: string
  ): Promise<FullWorkItemData> {
    if (!uuidValidate(workItemId)) {
      throw new ValidationError(`Invalid work_item_id format: ${workItemId}`);
    }

    let finalUpdatedFullItem: FullWorkItemData | null = null;

    await this.actionHistoryRepository.withTransaction(async (txClient) => {
      const itemToMove = await this.workItemRepository.findById(workItemId, {isActive: true}, txClient);
      if (!itemToMove) {
        throw new NotFoundError(`Work item with ID ${workItemId} not found or is inactive.`);
      }

      const oldOrderKey = itemToMove.order_key;
      if (oldOrderKey === newOrderKey) {
        logger.info(`[WorkItemPositionUpdateService] Item ${workItemId} already has order_key ${newOrderKey}. No update needed.`);
        // finalUpdatedFullItem = await this.workItemRepository.findFullWorkItemDataById(workItemId, txClient, {isActive: true});
        // if(!finalUpdatedFullItem) throw new NotFoundError('Item disappeared after no-op position check.');
        return; // Skip history and SSE if no change
      }
      const originalUpdatedAt = itemToMove.updated_at; // Capture before update

      const updatePayload = { order_key: newOrderKey, updated_at: new Date().toISOString() };
      await this.workItemRepository.update(txClient, workItemId, updatePayload);

      const undoSteps: CreateUndoStepInput[] = [{\n        step_order: 1,
        step_type: 'UPDATE',
        table_name: 'work_items',
        record_id: workItemId,
        old_data: { order_key: oldOrderKey, updated_at: originalUpdatedAt },
        new_data: { order_key: newOrderKey, updated_at: updatePayload.updated_at }, 
      }];

      const description = descriptionTemplate
        .replace('{itemName}', itemToMove.name)
        .replace('{itemId}', workItemId);

      const actionInput: CreateActionHistoryInput = {
        action_type: actionType,
        work_item_id: workItemId,
        description: description.substring(0, 250),
      };
      await this.actionHistoryRepository.createActionWithSteps(actionInput, undoSteps, txClient);
    });

    finalUpdatedFullItem = await this.workItemRepository.findFullWorkItemDataById(workItemId, undefined, {isActive: true});
    if (!finalUpdatedFullItem) {
      const checkItem = await this.workItemRepository.findById(workItemId, {isActive: undefined});
      if (!checkItem) throw new NotFoundError(`Work item with ID ${workItemId} not found after position update.`);
      throw new DatabaseError(`Work item with ID ${workItemId} found but could not be retrieved as FullWorkItemData or is inactive.`);
    }
    
    // Notify that the item itself was updated (its order_key changed)
    this.sseService.notifyWorkItemUpdated(finalUpdatedFullItem, finalUpdatedFullItem.parent_work_item_id);
    
    // Also notify that the parent's tree structure (sibling order) has changed
    if (finalUpdatedFullItem.parent_work_item_id) {
        this.sseService.broadcast({ type: 'projectTreeUpdated', payload: { projectId: finalUpdatedFullItem.parent_work_item_id, reason: 'item_moved', movedItemId: workItemId } });
    } else { // If it's a root project, the project list order might have changed
        this.sseService.broadcast({ type: 'projectListUpdated', payload: { reason: 'item_moved', movedItemId: workItemId } });
    }

    return finalUpdatedFullItem;
  }

  public async moveItemToStart(workItemId: string): Promise<FullWorkItemData> {
    const itemToMove = await this.workItemRepository.findById(workItemId, {isActive: true});
    if (!itemToMove) throw new NotFoundError(`Work item ${workItemId} not found or is inactive.`);

    const keyAfter = await this.workItemRepository.findSiblingEdgeOrderKey(itemToMove.parent_work_item_id, 'first');
    const newOrderKey = WorkItemUtilsService.calculateOrderKey(null, keyAfter);
    if (newOrderKey === null) throw new DatabaseError('Could not calculate order key for move to start.');

    return this.updatePositionAndNotify(workItemId, newOrderKey, 'MOVE_TO_START', 'Moved \"{itemName}\" (ID: {itemId}) to start.');
  }

  public async moveItemToEnd(workItemId: string): Promise<FullWorkItemData> {
    const itemToMove = await this.workItemRepository.findById(workItemId, {isActive: true});
    if (!itemToMove) throw new NotFoundError(`Work item ${workItemId} not found or is inactive.`);

    const keyBefore = await this.workItemRepository.findSiblingEdgeOrderKey(itemToMove.parent_work_item_id, 'last');
    const newOrderKey = WorkItemUtilsService.calculateOrderKey(keyBefore, null);
    if (newOrderKey === null) throw new DatabaseError('Could not calculate order key for move to end.');

    return this.updatePositionAndNotify(workItemId, newOrderKey, 'MOVE_TO_END', 'Moved \"{itemName}\" (ID: {itemId}) to end.');
  }

  public async moveItemAfter(workItemIdToMove: string, targetSiblingId: string): Promise<FullWorkItemData> {
    const itemToMove = await this.workItemRepository.findById(workItemIdToMove, {isActive: true});
    if (!itemToMove) throw new NotFoundError(`Work item to move (ID: ${workItemIdToMove}) not found or is inactive.`);
    const targetSibling = await this.workItemRepository.findById(targetSiblingId, {isActive: true});
    if (!targetSibling) throw new NotFoundError(`Target sibling item (ID: ${targetSiblingId}) not found or is inactive.`);
    if (itemToMove.parent_work_item_id !== targetSibling.parent_work_item_id) {
      throw new ValidationError('Items are not siblings.');
    }
    if (itemToMove.work_item_id === targetSiblingId) { // Cannot move item after itself
        return this.workItemRepository.findFullWorkItemDataById(workItemIdToMove, undefined, {isActive: true}) as Promise<FullWorkItemData>; // No-op
    }

    const keyBefore = targetSibling.order_key;
    const { after: keyAfter } = await this.workItemRepository.findNeighbourOrderKeys(itemToMove.parent_work_item_id, targetSiblingId, 'after');
    const newOrderKey = WorkItemUtilsService.calculateOrderKey(keyBefore, keyAfter);
    if (newOrderKey === null) throw new DatabaseError('Could not calculate order key for move after.');

    return this.updatePositionAndNotify(workItemIdToMove, newOrderKey, 'MOVE_AFTER', `Moved \"{itemName}\" (ID: {itemId}) after \"${targetSibling.name}\".`);
  }

  public async moveItemBefore(workItemIdToMove: string, targetSiblingId: string): Promise<FullWorkItemData> {
    const itemToMove = await this.workItemRepository.findById(workItemIdToMove, {isActive: true});
    if (!itemToMove) throw new NotFoundError(`Work item to move (ID: ${workItemIdToMove}) not found or is inactive.`);
    const targetSibling = await this.workItemRepository.findById(targetSiblingId, {isActive: true});
    if (!targetSibling) throw new NotFoundError(`Target sibling item (ID: ${targetSiblingId}) not found or is inactive.`);
    if (itemToMove.parent_work_item_id !== targetSibling.parent_work_item_id) {
      throw new ValidationError('Items are not siblings.');
    }
    if (itemToMove.work_item_id === targetSiblingId) { // Cannot move item before itself
        return this.workItemRepository.findFullWorkItemDataById(workItemIdToMove, undefined, {isActive: true}) as Promise<FullWorkItemData>; // No-op
    }

    const { before: keyBefore } = await this.workItemRepository.findNeighbourOrderKeys(itemToMove.parent_work_item_id, targetSiblingId, 'before');
    const keyAfter = targetSibling.order_key;
    const newOrderKey = WorkItemUtilsService.calculateOrderKey(keyBefore, keyAfter);
    if (newOrderKey === null) throw new DatabaseError('Could not calculate order key for move before.');

    return this.updatePositionAndNotify(workItemIdToMove, newOrderKey, 'MOVE_BEFORE', `Moved \"{itemName}\" (ID: {itemId}) before \"${targetSibling.name}\".`);
  }
}
EOF_SRC_SERVICES_WORKITEMPOSITIONUPDATESERVICE_TS

# src/services/WorkItemPromoteService.ts (Modified)
cat << 'EOF_SRC_SERVICES_WORKITEMPROMOTESERVICE_TS' > src/services/WorkItemPromoteService.ts
// Modified src/services/WorkItemPromoteService.ts
import { PoolClient } from 'pg';
import { validate as uuidValidate } from 'uuid';
import {
  WorkItemRepository,
  ActionHistoryRepository,
  WorkItemData,
  FullWorkItemData,
  CreateActionHistoryInput,
  CreateUndoStepInput,
} from '../repositories/index.js';
import { WorkItemUtilsService } from './WorkItemUtilsService.js';
// import sseNotificationServiceInstance from './SseNotificationService';
import { NotFoundError, ValidationError, DatabaseError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export class WorkItemPromoteService {
  private workItemRepository: WorkItemRepository;
  private actionHistoryRepository: ActionHistoryRepository;
  private sseService: typeof SseNotificationServiceInstance;

  constructor(
    workItemRepository: WorkItemRepository,
    actionHistoryRepository: ActionHistoryRepository,
    sseService: typeof SseNotificationServiceInstance
  ) {
    this.workItemRepository = workItemRepository;
    this.actionHistoryRepository = actionHistoryRepository;
    this.sseService = sseService;
  }

  public async promoteToProject(workItemId: string): Promise<FullWorkItemData> {
    logger.info(`[WorkItemPromoteService] Promoting work item ID: ${workItemId} to project.`);
    if (!uuidValidate(workItemId)) {
      throw new ValidationError(`Invalid work_item_id format: ${workItemId}`);
    }

    let finalPromotedFullItem: FullWorkItemData | null = null;
    let oldParentIdForSse: string | null = null;


    await this.actionHistoryRepository.withTransaction(async (txClient) => {
      const itemToPromote = await this.workItemRepository.findById(workItemId, { isActive: true }, txClient);
      if (!itemToPromote) {
        throw new NotFoundError(`Work item with ID ${workItemId} not found or is inactive.`);
      }
      if (itemToPromote.parent_work_item_id === null) {
        throw new ValidationError(`Work item ${workItemId} is already a root project.`);
      }

      oldParentIdForSse = itemToPromote.parent_work_item_id; // Capture for SSE
      const oldOrderKey = itemToPromote.order_key;
      const originalUpdatedAt = itemToPromote.updated_at;

      const newRootKeyBefore = await this.workItemRepository.findSiblingEdgeOrderKey(null, 'last', txClient);
      const newRootOrderKey = WorkItemUtilsService.calculateOrderKey(newRootKeyBefore, null);
      if (newRootOrderKey === null) {
        throw new DatabaseError('Could not calculate order key for new root project.');
      }

      const updatePayload: Partial<WorkItemData> = {
        parent_work_item_id: null,
        order_key: newRootOrderKey,
        updated_at: new Date().toISOString(),
      };
      await this.workItemRepository.update(txClient, workItemId, updatePayload);

      const undoSteps: CreateUndoStepInput[] = [{\n        step_order: 1,
        step_type: 'UPDATE',
        table_name: 'work_items',
        record_id: workItemId,
        old_data: { parent_work_item_id: oldParentIdForSse, order_key: oldOrderKey, updated_at: originalUpdatedAt },
        new_data: { parent_work_item_id: null, order_key: newRootOrderKey, updated_at: updatePayload.updated_at },
      }];

      const description = `Promoted task \"${itemToPromote.name}\" (ID: ${workItemId}) to a root project.`;
      const actionInput: CreateActionHistoryInput = {
        action_type: 'PROMOTE_TO_PROJECT',
        work_item_id: workItemId,
        description: description.substring(0, 250),
      };
      await this.actionHistoryRepository.createActionWithSteps(actionInput, undoSteps, txClient);
    });

    finalPromotedFullItem = await this.workItemRepository.findFullWorkItemDataById(workItemId, undefined, {isActive: true});
    if (!finalPromotedFullItem) {
      throw new NotFoundError(`Work item with ID ${workItemId} not found after promotion.`);
    }

    // Notify that the item itself was updated (parent and order_key changed)
    this.sseService.notifyWorkItemUpdated(finalPromotedFullItem, null); // Parent is now null
    
    // Notify that the old parent's tree has changed (item removed)
    if (oldParentIdForSse) {
        this.sseService.broadcast({ type: 'projectTreeUpdated', payload: { projectId: oldParentIdForSse, reason: 'item_promoted_away', itemId: workItemId } });
    }
    // Notify that the project list has a new project (the promoted item)
    this.sseService.broadcast({ type: 'projectListUpdated', payload: { reason: 'project_promoted', promotedItemId: workItemId } });

    return finalPromotedFullItem;
  }
}
EOF_SRC_SERVICES_WORKITEMPROMOTESERVICE_TS

# src/services/WorkItemDependencyUpdateService.ts (Modified)
cat << 'EOF_SRC_SERVICES_WORKITEMDEPENDENCYUPDATESERVICE_TS' > src/services/WorkItemDependencyUpdateService.ts
// Modified src/services/WorkItemDependencyUpdateService.ts
import { PoolClient } from 'pg';
import { validate as uuidValidate } from 'uuid';
import {
  WorkItemRepository,
  ActionHistoryRepository,
  WorkItemData,
  WorkItemDependencyData,
  FullWorkItemData,
  CreateActionHistoryInput,
  CreateUndoStepInput,
} from '../repositories/index.js';
import { DependencyInput } from '../tools/add_dependencies_params.js';
// import sseNotificationServiceInstance from './SseNotificationService';
import { NotFoundError, ValidationError, DatabaseError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export class WorkItemDependencyUpdateService {
  private workItemRepository: WorkItemRepository;
  private actionHistoryRepository: ActionHistoryRepository;
  private sseService: typeof SseNotificationServiceInstance;

  constructor(
    workItemRepository: WorkItemRepository,
    actionHistoryRepository: ActionHistoryRepository,
    sseService: typeof SseNotificationServiceInstance
  ) {
    this.workItemRepository = workItemRepository;
    this.actionHistoryRepository = actionHistoryRepository;
    this.sseService = sseService;
  }

  public async addDependencies(workItemId: string, dependenciesToAdd: DependencyInput[]): Promise<FullWorkItemData> {
    logger.info(`[WorkItemDependencyUpdateService] Adding dependencies to ${workItemId}:`, dependenciesToAdd);
    if (!uuidValidate(workItemId)) {
      throw new ValidationError(`Invalid work_item_id format: ${workItemId}`);
    }
    for (const dep of dependenciesToAdd) {
      if (!uuidValidate(dep.depends_on_work_item_id)) {
        throw new ValidationError(`Invalid depends_on_work_item_id format: ${dep.depends_on_work_item_id}`);
      }
    }

    let finalUpdatedFullItem: FullWorkItemData | null = null;

    await this.actionHistoryRepository.withTransaction(async (txClient) => {
      const workItem = await this.workItemRepository.findById(workItemId, {isActive: true}, txClient);
      if (!workItem) {
        throw new NotFoundError(`Work item with ID ${workItemId} not found or is inactive.`);
      }
      const originalUpdatedAt = workItem.updated_at;

      const undoSteps: CreateUndoStepInput[] = [];
      const addedDepDetails: WorkItemDependencyData[] = [];

      for (const depInput of dependenciesToAdd) {
        const depTargetItem = await this.workItemRepository.findById(depInput.depends_on_work_item_id, {isActive: true}, txClient);
        if (!depTargetItem) {
          throw new NotFoundError(`Dependency target item with ID ${depInput.depends_on_work_item_id} not found or is inactive.`);
        }
        if (workItemId === depInput.depends_on_work_item_id) {
            throw new ValidationError('A work item cannot depend on itself.');
        }
        // Check if dependency already exists and is active
        const existingDep = await this.workItemRepository.findSpecificDependency(workItemId, depInput.depends_on_work_item_id, {isActive: true}, txClient);
        if (existingDep) {
            logger.info(`Dependency from ${workItemId} to ${depInput.depends_on_work_item_id} already exists and is active. Skipping.`);
            continue;
        }


        const newDepData: WorkItemDependencyData = {
          work_item_id: workItemId,
          depends_on_work_item_id: depInput.depends_on_work_item_id,
          dependency_type: depInput.dependency_type || 'finish-to-start',
          is_active: true,
        };
        await this.workItemRepository.addDependency(txClient, newDepData);
        addedDepDetails.push(newDepData);

        undoSteps.push({
          step_order: undoSteps.length + 1,
          step_type: 'UPDATE', 
          table_name: 'work_item_dependencies',
          record_id: `${workItemId}:${depInput.depends_on_work_item_id}`,
          old_data: { is_active: false }, 
          new_data: { ...newDepData },   
        });
      }
      
      if (addedDepDetails.length === 0) {
          logger.info('[WorkItemDependencyUpdateService] No new dependencies were actually added (all might have existed).');
          // finalUpdatedFullItem = await this.workItemRepository.findFullWorkItemDataById(workItemId, txClient, {isActive: true});
          // if(!finalUpdatedFullItem) throw new NotFoundError('Item disappeared');
          return; 
      }

      const itemUpdatePayload = { updated_at: new Date().toISOString() }; 
      await this.workItemRepository.update(txClient, workItemId, itemUpdatePayload);
      // Add step for the main item's updated_at change
      undoSteps.push({
          step_order: undoSteps.length + 1, // Ensure this is the last step for item field update
          step_type: 'UPDATE',
          table_name: 'work_items',
          record_id: workItemId,
          old_data: { updated_at: originalUpdatedAt },
          new_data: { updated_at: itemUpdatePayload.updated_at },
      });

      const depNames = addedDepDetails.map(d => d.depends_on_work_item_id).join(', ');
      const description = `Added ${addedDepDetails.length} dependenc(ies) to \"${workItem.name}\": ${depNames}`;
      const actionInput: CreateActionHistoryInput = {
        action_type: 'ADD_DEPENDENCIES',\n        work_item_id: workItemId,
        description: description.substring(0, 250),
      };
      await this.actionHistoryRepository.createActionWithSteps(actionInput, undoSteps, txClient);
    });

    finalUpdatedFullItem = await this.workItemRepository.findFullWorkItemDataById(workItemId, undefined, {isActive: true});
    if (!finalUpdatedFullItem) {
      throw new NotFoundError(`Work item with ID ${workItemId} not found after adding dependencies.`);
    }
    this.sseService.notifyWorkItemUpdated(finalUpdatedFullItem, finalUpdatedFullItem.parent_work_item_id);
    // More specific: this.sseService.notifyDependencyChanged(workItemId, finalUpdatedFullItem.parent_work_item_id);
    return finalUpdatedFullItem;
  }

  public async deleteDependencies(workItemId: string, dependsOnIdsToRemove: string[]): Promise<FullWorkItemData> {
    logger.info(`[WorkItemDependencyUpdateService] Deleting dependencies from ${workItemId}:`, dependsOnIdsToRemove);
    if (!uuidValidate(workItemId)) {
      throw new ValidationError(`Invalid work_item_id format: ${workItemId}`);
    }
    for (const depId of dependsOnIdsToRemove) {
      if (!uuidValidate(depId)) {
        throw new ValidationError(`Invalid depends_on_work_item_id format in removal list: ${depId}`);
      }
    }

    let finalUpdatedFullItem: FullWorkItemData | null = null;

    await this.actionHistoryRepository.withTransaction(async (txClient) => {
      const workItem = await this.workItemRepository.findById(workItemId, {isActive:true}, txClient);
      if (!workItem) {
        throw new NotFoundError(`Work item with ID ${workItemId} not found or is inactive.`);
      }
      const originalUpdatedAt = workItem.updated_at;

      const undoSteps: CreateUndoStepInput[] = [];
      let actuallyRemovedCount = 0;

      for (const dependsOnId of dependsOnIdsToRemove) {
        const existingDep = await this.workItemRepository.findSpecificDependency(workItemId, dependsOnId, {isActive: true}, txClient);
        if (existingDep) {
            await this.workItemRepository.removeDependency(txClient, workItemId, dependsOnId); // This should mark as inactive or delete
            actuallyRemovedCount++;
            undoSteps.push({
                step_order: undoSteps.length + 1,
                step_type: 'UPDATE', 
                table_name: 'work_item_dependencies',
                record_id: `${workItemId}:${dependsOnId}`,
                old_data: { ...existingDep }, 
                new_data: { is_active: false },   
            });
        }
      }
      
      if (actuallyRemovedCount === 0) {
        logger.info('[WorkItemDependencyUpdateService] No dependencies were actually removed.');
        // finalUpdatedFullItem = await this.workItemRepository.findFullWorkItemDataById(workItemId, txClient, {isActive: true});
        // if(!finalUpdatedFullItem) throw new NotFoundError('Item disappeared');
        return;
      }

      const itemUpdatePayload = { updated_at: new Date().toISOString() }; 
      await this.workItemRepository.update(txClient, workItemId, itemUpdatePayload);
      undoSteps.push({
        step_order: undoSteps.length + 1,
        step_type: 'UPDATE',
        table_name: 'work_items',
        record_id: workItemId,
        old_data: { updated_at: originalUpdatedAt },
        new_data: { updated_at: itemUpdatePayload.updated_at },
      });

      const depIds = dependsOnIdsToRemove.join(', ');
      const description = `Removed ${actuallyRemovedCount} dependenc(ies) from \"${workItem.name}\": ${depIds}`;
      const actionInput: CreateActionHistoryInput = {
        action_type: 'DELETE_DEPENDENCIES',
        work_item_id: workItemId,
        description: description.substring(0, 250),
      };
      await this.actionHistoryRepository.createActionWithSteps(actionInput, undoSteps, txClient);
    });

    finalUpdatedFullItem = await this.workItemRepository.findFullWorkItemDataById(workItemId, undefined, {isActive: true});
    if (!finalUpdatedFullItem) {
      throw new NotFoundError(`Work item with ID ${workItemId} not found after deleting dependencies.`);
    }
    this.sseService.notifyWorkItemUpdated(finalUpdatedFullItem, finalUpdatedFullItem.parent_work_item_id);
    // More specific: this.sseService.notifyDependencyChanged(workItemId, finalUpdatedFullItem.parent_work_item_id);
    return finalUpdatedFullItem;
  }
}
EOF_SRC_SERVICES_WORKITEMDEPENDENCYUPDATESERVICE_TS

# src/repositories/WorkItemRepositoryCRUD.ts (Modified)
cat << 'EOF_SRC_REPOSITORIES_WORKITEMREPOSITORYCRUD_TS' > src/repositories/WorkItemRepositoryCRUD.ts
// Modified: src/repositories/WorkItemRepositoryCRUD.ts
// Added findDependenciesForItems method
import { PoolClient, Pool } from 'pg';
import { WorkItemData, WorkItemDependencyData, FullWorkItemData } from './WorkItemRepositoryBase.js';
import { NotFoundError, DatabaseError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export abstract class WorkItemRepositoryCRUD {
    protected pool: Pool;

    constructor(pool: Pool) {
        this.pool = pool;
    }

    protected async _create(
        client: PoolClient,
        itemData: Omit<WorkItemData, 'created_at' | 'updated_at' | 'is_active' | 'work_item_id'> & { work_item_id: string; is_active: boolean; created_at: string; updated_at: string },
        dependencies?: Omit<WorkItemDependencyData, 'is_active' | 'work_item_id'>[] // work_item_id will be from newItem
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
            itemData.tags || [],
            itemData.is_active,
            itemData.created_at,
            itemData.updated_at,
        ];
        const result = await client.query(query, values);
        const newItem = result.rows[0] as WorkItemData;

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

    protected async _findById(id: string, filter?: { isActive?: boolean }, client?: PoolClient): Promise<WorkItemData | undefined> {
        const queryClient = client || this.pool;
        let sql = 'SELECT * FROM work_items WHERE work_item_id = $1';
        const params: unknown[] = [id];
        if (filter && filter.isActive !== undefined) {
            sql += ' AND is_active = $2';
            params.push(filter.isActive);
        }
        const result = await queryClient.query(sql, params);
        return result.rows[0] as WorkItemData | undefined;
    }

    protected async _findByIds(ids: string[], filter?: { isActive?: boolean }, client?: PoolClient): Promise<WorkItemData[]> {
        if (ids.length === 0) return [];
        const queryClient = client || this.pool;
        // Ensure correct casting for UUID array if your DB requires it
        let sql = 'SELECT * FROM work_items WHERE work_item_id = ANY($1::uuid[])';
        const params: unknown[] = [ids];
        if (filter && filter.isActive !== undefined) {
            sql += ' AND is_active = $2';
            params.push(filter.isActive);
        }
        const result = await queryClient.query(sql, params);
        return result.rows as WorkItemData[];
    }

    protected async _findFullWorkItemDataById(id: string, client?: PoolClient, filter?: { isActive?: boolean }): Promise<FullWorkItemData | null> {
        const queryClient = client || this.pool;
        let itemSql = 'SELECT * FROM work_items WHERE work_item_id = $1';
        const params: unknown[] = [id];
        if (filter && filter.isActive !== undefined) {
            itemSql += ' AND is_active = $2';
            params.push(filter.isActive);
        }

        const itemResult = await queryClient.query(itemSql, params);
        if (itemResult.rows.length === 0) return null;
        const item = itemResult.rows[0] as WorkItemData;

        const depsSql = 'SELECT * FROM work_item_dependencies WHERE work_item_id = $1 AND is_active = true';
        const depsResult = await queryClient.query(depsSql, [id]);
        const dependencies = depsResult.rows as WorkItemDependencyData[];
        
        const childrenCountSql = 'SELECT COUNT(*) AS count FROM work_items WHERE parent_work_item_id = $1 AND is_active = true';
        const childrenCountResult = await queryClient.query(childrenCountSql, [id]);
        const children_count = parseInt(childrenCountResult.rows[0].count, 10);

        const dependentsCountSql = 'SELECT COUNT(*) AS count FROM work_item_dependencies WHERE depends_on_work_item_id = $1 AND is_active = true';
        const dependentsCountResult = await queryClient.query(dependentsCountSql, [id]);
        const dependents_count = parseInt(dependentsCountResult.rows[0].count, 10);

        return {
            ...item,
            dependencies: dependencies.length > 0 ? dependencies : null, 
            children_count,
            dependents_count
        };
    }

    protected async _findAll(filter: { parent_work_item_id?: string | null; is_active?: boolean; roots_only?: boolean, status?: string[], priority?: string[] }, client?: PoolClient): Promise<WorkItemData[]> {
        const queryClient = client || this.pool;
        let sql = 'SELECT * FROM work_items WHERE 1=1';
        const params: unknown[] = [];
        let paramIndex = 1;

        if (filter.roots_only) {
            sql += ` AND parent_work_item_id IS NULL`;
        } else if (filter.parent_work_item_id !== undefined) { // Check for undefined explicitly
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

        sql += ' ORDER BY order_key ASC NULLS LAST'; // Ensure consistent ordering
        const result = await queryClient.query(sql, params);
        return result.rows as WorkItemData[];
    }

    protected async _update(client: PoolClient, id: string, updates: Partial<Omit<WorkItemData, 'work_item_id' | 'created_at'>>): Promise<WorkItemData> {
        const setClauses = Object.keys(updates)
            .map((key, i) => `\"${key}\" = $${i + 1}`)\n            .join(', ');
        const values = Object.values(updates);

        if (setClauses.length === 0) {
            const currentItem = await this._findById(id, {isActive: undefined}, client); // Check any state
            if (!currentItem) throw new NotFoundError(`Work item with ID ${id} not found for no-op update.`);
            return currentItem;
        }

        const query = `UPDATE work_items SET ${setClauses} WHERE work_item_id = $${values.length + 1} RETURNING *;`;
        const result = await client.query(query, [...values, id]);
        if (result.rowCount === 0) {
            // This might happen if the item was deleted or its ID changed between read and update (race condition)
            // Or if the WHERE clause didn't match (e.g. trying to update an inactive item without explicitly allowing it)
            throw new NotFoundError(`Work item with ID ${id} not found during update, or no rows affected.`);
        }
        return result.rows[0] as WorkItemData;
    }

    protected async _findDependenciesForItems(itemIds: string[], filter?: { isActive?: boolean }, client?: PoolClient): Promise<WorkItemDependencyData[]> {
        if (itemIds.length === 0) return [];
        const queryClient = client || this.pool;
        let sql = 'SELECT * FROM work_item_dependencies WHERE work_item_id = ANY($1::uuid[])';
        const params: unknown[] = [itemIds];
        let paramIndex = 2;
        if (filter && filter.isActive !== undefined) {
            sql += ` AND is_active = $${paramIndex++}`;
            params.push(filter.isActive);
        }
        const result = await queryClient.query(sql, params);
        return result.rows as WorkItemDependencyData[];
    }
}
EOF_SRC_REPOSITORIES_WORKITEMREPOSITORYCRUD_TS

# src/repositories/WorkItemRepository.ts (Modified)
cat << 'EOF_SRC_REPOSITORIES_WORKITEMREPOSITORY_TS' > src/repositories/WorkItemRepository.ts
// Modified src/repositories/WorkItemRepository.ts
import { Pool, PoolClient } from 'pg';
import { WorkItemRepositoryBase, WorkItemData, WorkItemDependencyData, FullWorkItemData } from './WorkItemRepositoryBase.js';
// Import concrete implementations if WorkItemRepositoryBase is truly abstract for these
import { WorkItemRepositoryCRUD as ConcreteCRUD } from './WorkItemRepositoryCRUD.js'; 
import { WorkItemRepositoryHierarchy as ConcreteHierarchy } from './WorkItemRepositoryHierarchy.js';
import { WorkItemRepositorySearchOrder as ConcreteSearchOrder } from './WorkItemRepositorySearchOrder.js';
import { WorkItemRepositoryDependencies as ConcreteDependencies } from './WorkItemRepositoryDependencies.js';
// WorkItemRepositoryUndoRedo might not be directly composed if its methods are on ActionHistoryRepo

// Helper class to expose protected methods from ConcreteCRUD
class CrudHelper extends ConcreteCRUD {
    constructor(pool: Pool) { super(pool); }
    public create = this._create;
    public findById = this._findById;
    public findByIds = this._findByIds;
    public findFullWorkItemDataById = this._findFullWorkItemDataById;
    public findAll = this._findAll;
    public update = this._update;
    public findDependenciesForItems = this._findDependenciesForItems;
}
class HierarchyHelper extends ConcreteHierarchy {
    constructor(pool: Pool) { super(pool); }
    public findAllDescendants = this._findAllDescendants;
    public getParent = this._getParent;
    public getRootAncestor = this._getRootAncestor;
}
class SearchOrderHelper extends ConcreteSearchOrder {
    constructor(pool: Pool) { super(pool); }
    public findCandidateTasksForSuggestion = this._findCandidateTasksForSuggestion;
    public findSiblingEdgeOrderKey = this._findSiblingEdgeOrderKey;
    public findNeighbourOrderKeys = this._findNeighbourOrderKeys;
}
class DependenciesHelper extends ConcreteDependencies {
    constructor(pool: Pool) { super(pool); }
    public addDependency = this._addDependency;
    public removeDependency = this._removeDependency;
    public findDependencies = this._findDependencies;
    public findDependents = this._findDependents;
    public findSpecificDependency = this._findSpecificDependency;
}


export class WorkItemRepository extends WorkItemRepositoryBase {
    private crud: CrudHelper;
    private hierarchy: HierarchyHelper;
    private searchOrder: SearchOrderHelper;
    private dependencies: DependenciesHelper;

    constructor(pool: Pool) {
        super(pool);
        this.crud = new CrudHelper(pool);
        this.hierarchy = new HierarchyHelper(pool);
        this.searchOrder = new SearchOrderHelper(pool);
        this.dependencies = new DependenciesHelper(pool);
    }

    // CRUD Operations
    public async create(client: PoolClient, itemData: Omit<WorkItemData, 'created_at' | 'updated_at' | 'is_active'| 'work_item_id'> & { work_item_id: string; is_active: boolean; created_at: string; updated_at: string }, dependencies?: Omit<WorkItemDependencyData, 'is_active' | 'work_item_id'>[]): Promise<WorkItemData> {
        return this.crud.create(client, itemData, dependencies);
    }
    public async findById(id: string, filter?: { isActive?: boolean }, client?: PoolClient): Promise<WorkItemData | undefined> {
        return this.crud.findById(id, filter, client);
    }
    public async findByIds(ids: string[], filter?: { isActive?: boolean }, client?: PoolClient): Promise<WorkItemData[]> {
        return this.crud.findByIds(ids, filter, client);
    }
    public async findFullWorkItemDataById(id: string, client?: PoolClient, filter?: { isActive?: boolean }): Promise<FullWorkItemData | null> {
        return this.crud.findFullWorkItemDataById(id, client, filter);
    }
    public async findAll(filter: { parent_work_item_id?: string | null; is_active?: boolean; roots_only?: boolean, status?: string[], priority?: string[] }, client?: PoolClient): Promise<WorkItemData[]> {
        return this.crud.findAll(filter, client);
    }
    public async update(client: PoolClient, id: string, updates: Partial<Omit<WorkItemData, 'work_item_id' | 'created_at'>>): Promise<WorkItemData> {
        return this.crud.update(client, id, updates);
    }
     public async findDependenciesForItems(itemIds: string[], filter?: { isActive?: boolean }, client?: PoolClient): Promise<WorkItemDependencyData[]> {
        return this.crud.findDependenciesForItems(itemIds, filter, client);
    }

    // Hierarchy Operations
    public async findAllDescendants(parentId: string, client?: PoolClient): Promise<WorkItemData[]> {
        return this.hierarchy.findAllDescendants(parentId, client);
    }
    public async getParent(childId: string, client?: PoolClient): Promise<WorkItemData | null> {
        return this.hierarchy.getParent(childId, client);
    }
    public async getRootAncestor(itemId: string, client?: PoolClient): Promise<WorkItemData | null> {
        return this.hierarchy.getRootAncestor(itemId, client);
    }

    // Search and Order Operations
    public async findCandidateTasksForSuggestion(filters: { scopeItemId?: string | null; includeTags?: string[]; excludeTags?: string[] }, client?: PoolClient): Promise<WorkItemData[]> {
        return this.searchOrder.findCandidateTasksForSuggestion(filters, client);
    }
    public async findSiblingEdgeOrderKey(parentId: string | null, position: 'first' | 'last', client?: PoolClient): Promise<string | null> {
        return this.searchOrder.findSiblingEdgeOrderKey(parentId, position, client);
    }
    public async findNeighbourOrderKeys(parentId: string | null, siblingId: string, relativePosition: 'before' | 'after', client?: PoolClient): Promise<{ before: string | null; after: string | null }> {
        return this.searchOrder.findNeighbourOrderKeys(parentId, siblingId, relativePosition, client);
    }

    // Dependency Operations
    public async addDependency(client: PoolClient, dependencyData: WorkItemDependencyData): Promise<void> {
        return this.dependencies.addDependency(client, dependencyData);
    }
    public async removeDependency(client: PoolClient, workItemId: string, dependsOnWorkItemId: string): Promise<boolean> {
        return this.dependencies.removeDependency(client, workItemId, dependsOnWorkItemId);
    }
    public async findDependencies(workItemId: string, filter?: { isActive?: boolean }, client?: PoolClient): Promise<WorkItemDependencyData[]> {
        return this.dependencies.findDependencies(workItemId, filter, client);
    }
    public async findDependents(workItemId: string, filter?: { isActive?: boolean }, client?: PoolClient): Promise<WorkItemDependencyData[]> {
        return this.dependencies.findDependents(workItemId, filter, client);
    }
    public async findSpecificDependency(workItemId: string, dependsOnWorkItemId: string, filter?: { isActive?: boolean }, client?: PoolClient): Promise<WorkItemDependencyData | undefined> {
        return this.dependencies.findSpecificDependency(workItemId, dependsOnWorkItemId, filter, client);
    }
}
EOF_SRC_REPOSITORIES_WORKITEMREPOSITORY_TS

echo "Backend files processed."

# --- Frontend UI Application (ui/) ---
echo "Creating frontend UI application in ui/..."
mkdir -p ui/src/lib/types
mkdir -p ui/src/lib/stores
mkdir -p ui/src/lib/client
mkdir -p ui/src/lib/components/layout
mkdir -p ui/src/lib/components/projectList
mkdir -p ui/src/lib/components/projectTree
mkdir -p ui/src/lib/components/common
mkdir -p ui/src/lib/utils
mkdir -p ui/src/routes
mkdir -p ui/static
mkdir -p ui/tests # Placeholder for tests

# ui/package.json
cat << 'EOF_UI_PACKAGE_JSON' > ui/package.json
{
  "name": "task-manager-ui",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
    "check:watch": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json --watch",
    "lint": "prettier --check . && eslint .",
    "format": "prettier --write ."
  },
  "devDependencies": {
    "@sveltejs/adapter-auto": "^3.0.0",
    "@sveltejs/adapter-static": "^3.0.1",
    "@sveltejs/kit": "^2.0.0",
    "@sveltejs/vite-plugin-svelte": "^3.0.0",
    "@types/eslint": "^8.56.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0",
    "eslint": "^8.56.0",
    "eslint-config-prettier": "^9.1.0",
    "eslint-plugin-svelte": "^2.35.1",
    "prettier": "^3.1.1",
    "prettier-plugin-svelte": "^3.1.2",
    "svelte": "^4.2.7",
    "svelte-check": "^3.6.0",
    "tslib": "^2.4.1",
    "typescript": "^5.0.0",
    "vite": "^5.0.3",
    "postcss": "^8.4.35",
    "autoprefixer": "^10.4.17",
    "cssnano": "^6.0.5"
  },
  "type": "module"
}
EOF_UI_PACKAGE_JSON

# ui/svelte.config.js
cat << 'EOF_UI_SVELTE_CONFIG_JS' > ui/svelte.config.js
// import adapter from '@sveltejs/adapter-auto'; // Default
import adapter from '@sveltejs/adapter-static'; // For static hosting with Nginx
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),

  kit: {
    adapter: adapter({
      // default options are shown. On some platforms
      // these options are set automatically — see below
      pages: 'build',
      assets: 'build',
      fallback: 'index.html', // Important for SPAs with client-side routing
      precompress: false, // Nginx can handle compression
      strict: true
    }),
    alias: {
      '$lib': './src/lib',
      '$components': './src/lib/components',
      '$stores': './src/lib/stores',
      '$utils': './src/lib/utils',
      '$types': './src/lib/types',
      '$client': './src/lib/client'
    },
    // If serving from a subpath on Nginx, e.g. /ui/, set paths.base
    // paths: {
    //   base: process.env.NODE_ENV === 'production' ? '/ui' : '',
    // }
  }
};

export default config;
EOF_UI_SVELTE_CONFIG_JS

# ui/vite.config.ts
cat << 'EOF_UI_VITE_CONFIG_TS' > ui/vite.config.ts
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
    server: { // Optional: For dev, proxy API requests to your backend
        proxy: {
            '/api': { // Requests to /api/* from the Svelte app
                target: 'http://localhost:3000', // Your backend server
                changeOrigin: true,
                // rewrite: (path) => path.replace(/^\/api/, '/api') // Ensure /api prefix is kept for backend
            }
        }
    }
});
EOF_UI_VITE_CONFIG_TS

# ui/tsconfig.json
cat << 'EOF_UI_TSCONFIG_JSON' > ui/tsconfig.json
{
  "extends": "./.svelte-kit/tsconfig.json",
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "strict": true,
    "moduleResolution": "bundler",
    "baseUrl": ".",
    "paths": {
      "$lib": ["src/lib"],
      "$lib/*": ["src/lib/*"],
      "$components": ["src/lib/components"],
      "$components/*": ["src/lib/components/*"],
      "$stores": ["src/lib/stores"],
      "$stores/*": ["src/lib/stores/*"],
      "$utils": ["src/lib/utils"],
      "$utils/*": ["src/lib/utils/*"],
      "$types": ["src/lib/types"],
      "$types/*": ["src/lib/types/*"],
      "$client": ["src/lib/client"],
      "$client/*": ["src/lib/client/*"]
    }
  }
}
EOF_UI_TSCONFIG_JSON

# ui/.eslintrc.cjs
cat << 'EOF_UI_ESLINTRC_CJS' > ui/.eslintrc.cjs
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:svelte/recommended',
    'prettier'
  ],
  plugins: ['@typescript-eslint'],
  ignorePatterns: ['*.cjs', '.svelte-kit/', 'build/', 'dist/'], // Added dist/
  overrides: [
    {
      files: ['*.svelte'],
      parser: 'svelte-eslint-parser',
      parserOptions: {
        parser: '@typescript-eslint/parser'
      }
    }
  ],
  settings: {
    svelte: {
      // Optionally, specify Svelte version or other settings
    }
  },
  parserOptions: {
    sourceType: 'module',
    ecmaVersion: 2022 // Updated to a more recent ECMAScript version
  },
  env: {
    browser: true,
    es2021: true, // Updated
    node: true
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn', 
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    'svelte/no-at-html-tags': 'off' 
  }
};
EOF_UI_ESLINTRC_CJS

# ui/.prettierrc.json
cat << 'EOF_UI_PRETTIERRC_JSON' > ui/.prettierrc.json
{
  "useTabs": false,
  "singleQuote": true,
  "trailingComma": "es5",
  "printWidth": 100,
  "plugins": ["prettier-plugin-svelte"],
  "overrides": [{ "files": "*.svelte", "options": { "parser": "svelte" } }],
  "svelteSortOrder": "options-scripts-markup-styles",
  "svelteStrictMode": false,
  "svelteIndentScriptAndStyle": true
}
EOF_UI_PRETTIERRC_JSON

# ui/postcss.config.cjs
cat << 'EOF_UI_POSTCSS_CONFIG_CJS' > ui/postcss.config.cjs
module.exports = {
  plugins: {
    autoprefixer: {},
    // cssnano is good for production builds to minimize CSS
    // It might be run as part of the vite build process already if using adapter-static with precompress
    // Or you can explicitly add it here.
    // For dev, it might not be necessary.
    ...(process.env.NODE_ENV === 'production' ? { cssnano: { preset: 'default' } } : {}),
  },
};
EOF_UI_POSTCSS_CONFIG_CJS

# ui/src/app.html
cat << 'EOF_UI_SRC_APP_HTML' > ui/src/app.html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<link rel="icon" href="%sveltekit.assets%/favicon.png" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		%sveltekit.head%
	</head>
	<body data-sveltekit-preload-data="hover">
		<div style="display: contents">%sveltekit.body%</div>
	</body>
</html>
EOF_UI_SRC_APP_HTML

# ui/src/app.d.ts
cat << 'EOF_UI_SRC_APP_D_TS' > ui/src/app.d.ts
// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
EOF_UI_SRC_APP_D_TS

# ui/src/app.postcss
cat << 'EOF_UI_SRC_APP_POSTCSS' > ui/src/app.postcss
/* Global styles - app.postcss */

/* Remove Tailwind directives if not using Tailwind directly for this POC.
  If you plan to use Tailwind, uncomment these and install tailwindcss:
  @tailwind base;
  @tailwind components;
  @tailwind utilities; 
*/

:root {
  /* Pastel Color Palette - Example */
  --color-background: #fdf6e3; /* Solarized Light Background */
  --color-text: #657b83;       /* Solarized Base00 */
  --color-primary: #268bd2;    /* Solarized Blue */
  --color-secondary: #859900;  /* Solarized Green */
  --color-accent: #b58900;     /* Solarized Yellow */
  --color-highlight: #cb4b16;  /* Solarized Orange */


  --color-sidebar-bg: #f4f1de; /* Light Cream - slightly different from main background */
  --color-topbar-bg: #e8e2ca;  /* Darker Cream for topbar */
  --color-border: #dcd4b8;     /* Softer border */

  --color-status-todo: #6c71c4;    /* Solarized Violet */
  --color-status-inprogress: var(--color-accent); /* Solarized Yellow */
  --color-status-done: var(--color-secondary);     /* Solarized Green */
  --color-status-blocked: #dc322f;  /* Solarized Red */

  --font-body: 'system-ui', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
  --font-mono: 'Fira Code', 'Source Code Pro', 'Menlo', 'Consolas', 'Liberation Mono', monospace;
  
  font-family: var(--font-body);
  background-color: var(--color-background);
  color: var(--color-text);
  line-height: 1.6;
}

body {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  font-family: var(--font-body);
  background-color: var(--color-background);
  color: var(--color-text);
  overflow-x: hidden; 
}

/* Basic scrollbar styling */
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
::-webkit-scrollbar-track {
  background: var(--color-sidebar-bg);
  border-radius: 10px;
}
::-webkit-scrollbar-thumb {
  background-color: var(--color-accent);
  border-radius: 10px;
  border: 2px solid var(--color-sidebar-bg); /* Creates padding around thumb */
}
::-webkit-scrollbar-thumb:hover {
  background-color: var(--color-primary);
}

.fixed-width-font {
    font-family: var(--font-mono);
}

/* Utility for status colors - can be applied via class */
.status-indicator.status-todo { background-color: var(--color-status-todo); color: #fdf6e3; }
.status-indicator.status-inprogress { background-color: var(--color-status-inprogress); color: #002b36; }
.status-indicator.status-done { background-color: var(--color-status-done); color: #fdf6e3; }
.status-indicator.status-blocked { background-color: var(--color-status-blocked); color: #fdf6e3; }

/* Backgrounds for nodes based on status */
.node-status-bg.status-todo-bg { background-color: #f0f4fa; border-left: 3px solid var(--color-status-todo); }
.node-status-bg.status-in-progress-bg { background-color: #fff8e1; border-left: 3px solid var(--color-status-inprogress); }
.node-status-bg.status-done-bg { background-color: #e8f5e9; border-left: 3px solid var(--color-status-done); }
.node-status-bg.status-blocked-bg { background-color: #ffebee; border-left: 3px solid var(--color-status-blocked); }
.node-status-bg.status-unknown-bg { background-color: #fafafa; border-left: 3px solid #ccc; }

a {
  color: var(--color-primary);
  text-decoration: none;
}
a:hover {
  text-decoration: underline;
  color: var(--color-highlight);
}

button {
  font-family: var(--font-body);
}
EOF_UI_SRC_APP_POSTCSS

# ui/src/lib/types/index.ts
cat << 'EOF_UI_LIB_TYPES_INDEX_TS' > ui/src/lib/types/index.ts
// ui/src/lib/types/index.ts

// From backend WorkItemServiceTypes.ts WorkItemTreeNode (or similar)
// Ensure this matches the structure provided by your backend's /api/projects/:projectId/tree
export interface UiWorkItemDependency {
    work_item_id: string; 
    depends_on_work_item_id: string; 
    dependency_type: string;
    is_active: boolean;
}
  
export interface UiWorkItemTreeNode {
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
    children: UiWorkItemTreeNode[];
    // Populated by frontend or backend for display, based on `dependencies`
    dependencies_info?: { depends_on_id: string; depends_on_name?: string; type: string }[]; 
    dependencies?: UiWorkItemDependency[] | null; // Raw dependencies from backend
}
  
// For the project list in the sidebar
export interface ProjectListItem {
    work_item_id: string;
    name: string;
    // Add other fields if needed by the UI, e.g., status, simple counts
    // status?: string;
    // children_count?: number;
}

// For SSE events
export type SseEventPayload = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface SseEventMessage { // Renamed to avoid conflict if SseEvent is used elsewhere
    type: 'workItemCreated' | 'workItemUpdated' | 'workItemDeleted' | 'projectListUpdated' | 'projectTreeUpdated' | 'connected' | 'error';
    payload: SseEventPayload;
}
EOF_UI_LIB_TYPES_INDEX_TS

# ui/src/lib/stores/projectStore.ts
cat << 'EOF_UI_LIB_STORES_PROJECTSTORE_TS' > ui/src/lib/stores/projectStore.ts
// ui/src/lib/stores/projectStore.ts
import { writable, get } from 'svelte/store';
import type { ProjectListItem, UiWorkItemTreeNode, SseEventMessage } from '$types';
import { fetchProjects, fetchProjectTree } from '$client/api';
import { sseStore } from '$client/sse';

interface ProjectState {
  projects: ProjectListItem[];
  selectedProjectId: string | null;
  currentProjectTree: UiWorkItemTreeNode | null;
  isLoadingProjects: boolean;
  isLoadingTree: boolean;
  error: string | null;
}

function createProjectStore() {
  const { subscribe, set, update } = writable<ProjectState>({
    projects: [],
    selectedProjectId: null,
    currentProjectTree: null,
    isLoadingProjects: false,
    isLoadingTree: false,
    error: null,
  });

  async function loadProjects(selectIdAfterLoad?: string | null) {
    update((state) => ({ ...state, isLoadingProjects: true, error: null }));
    try {
      const projectsData = await fetchProjects(); // Assumes fetchProjects returns ProjectListItem compatible objects
      update((state) => ({ ...state, projects: projectsData, isLoadingProjects: false }));
      if (selectIdAfterLoad && projectsData.some(p => p.work_item_id === selectIdAfterLoad)) {
        await selectProject(selectIdAfterLoad);
      } else if (selectIdAfterLoad) { // ID was given but not found in new list
        update(s => ({...s, selectedProjectId: null, currentProjectTree: null}));
      }
    } catch (err) {
      console.error('Error loading projects:', err);
      update((state) => ({ ...state, error: (err as Error).message, isLoadingProjects: false }));
    }
  }

  async function selectProject(projectId: string | null) {
    const currentSelectedId = get(subscribe).selectedProjectId;
    if (!projectId) {
      update((state) => ({ ...state, selectedProjectId: null, currentProjectTree: null, error: null }));
      return;
    }
    // Avoid reloading if already selected, unless forced (e.g., by SSE)
    // For SSE, we might pass a forceReload flag or handle it in the SSE subscriber
    if (currentSelectedId === projectId && get(subscribe).currentProjectTree && !get(subscribe).isLoadingTree) {
        // console.log('Project already selected and loaded:', projectId);
        return;
    }

    update((state) => ({ ...state, selectedProjectId: projectId, isLoadingTree: true, error: null, currentProjectTree: null }));
    try {
      const tree = await fetchProjectTree(projectId);
      update((state) => ({
        ...state,
        currentProjectTree: tree, // tree can be null if project not found or filtered by backend
        isLoadingTree: false,
      }));
    } catch (err) {
      console.error(`Error loading project tree for ${projectId}:`, err);
      update((state) => ({ ...state, error: (err as Error).message, isLoadingTree: false, currentProjectTree: null }));
      // Optionally clear selectedProjectId if load fails critically
      // update((state) => ({ ...state, selectedProjectId: null })); 
    }
  }

  // Subscribe to SSE events
  sseStore.subscribe((event: SseEventMessage | null) => {
    if (!event) return;

    const currentState = get(subscribe);

    if (event.type === 'projectListUpdated') {
      console.log('SSE: projectListUpdated, reloading projects...', event.payload);
      loadProjects(currentState.selectedProjectId); // Reload and try to keep selection
    }
    
    if (event.type === 'projectTreeUpdated') {
        const { projectId, reason, /* other potential payload like itemId */ } = event.payload;
        if (currentState.selectedProjectId && projectId === currentState.selectedProjectId) {
            console.log(`SSE: projectTreeUpdated for current project ${projectId}, reason: ${reason}. Reloading tree...`, event.payload);
            selectProject(currentState.selectedProjectId); // Force reload of the current tree
        } else if (reason === 'project_deleted_itself' && event.payload.deletedItemId === currentState.selectedProjectId) {
            console.log('SSE: current project was deleted, clearing view and reloading project list');
            update(s => ({...s, selectedProjectId: null, currentProjectTree: null}));
            loadProjects(); 
        }
    }
  });

  return {
    subscribe,
    loadProjects,
    selectProject,
  };
}

export const projectStore = createProjectStore();
EOF_UI_LIB_STORES_PROJECTSTORE_TS

# ui/src/lib/stores/uiStateStore.ts
cat << 'EOF_UI_LIB_STORES_UISTATESTORE_TS' > ui/src/lib/stores/uiStateStore.ts
// ui/src/lib/stores/uiStateStore.ts
import { writable } from 'svelte/store';

interface UiState {
  isSidebarCollapsed: boolean;
}

function createUiStateStore() {
  const { subscribe, update, set } = writable<UiState>({
    isSidebarCollapsed: false, // Default to not collapsed
  });

  return {
    subscribe,
    toggleSidebar: () => update((state) => ({ ...state, isSidebarCollapsed: !state.isSidebarCollapsed })),
    setSidebarCollapsed: (collapsed: boolean) => set({ isSidebarCollapsed: collapsed }),
  };
}

export const uiStateStore = createUiStateStore();
EOF_UI_LIB_STORES_UISTATESTORE_TS

# ui/src/lib/client/api.ts
cat << 'EOF_UI_LIB_CLIENT_API_TS' > ui/src/lib/client/api.ts
// ui/src/lib/client/api.ts
import type { UiWorkItemTreeNode, ProjectListItem } from '$types';

// In a real app, this would come from an environment variable or config
// For dev, Vite proxy handles this if UI runs on different port.
// For prod, Nginx will proxy /api to the backend.
const API_BASE_URL = '/api'; // Use relative path for proxying

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorData;
    try {
        errorData = await response.json();
    } catch (e) {
        errorData = { error: { message: response.statusText } };
    }
    // Try to extract message from backend's McpError structure or generic error
    const message = errorData?.error?.message || errorData?.message || `HTTP error! status: ${response.status}`;
    console.error('API Error Response:', errorData);
    throw new Error(message);
  }
  // Handle cases where response might be empty (e.g., 204 No Content)
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return response.json() as Promise<T>;
  }
  return undefined as T; // Or handle non-JSON responses appropriately
}

// Backend returns WorkItemData[] for projects, which should be compatible with ProjectListItem
export async function fetchProjects(): Promise<ProjectListItem[]> {
  const response = await fetch(`${API_BASE_URL}/projects`);
  return handleResponse<ProjectListItem[]>(response);
}

export async function fetchProjectTree(projectId: string): Promise<UiWorkItemTreeNode | null> {
  const response = await fetch(`${API_BASE_URL}/projects/${projectId}/tree`);
  // A 404 from backend for tree might return a non-JSON error page if not handled by McpError handler.
  // Or it might return JSON with an error. handleResponse should try to parse JSON.
  // If the project exists but has no displayable tree (e.g. it's "done" and filtered), backend might return null.
  if (response.status === 404) { 
      // Check if it's a structured error or just plain 404
      try {
          const errorData = await response.json();
          throw new Error(errorData.error?.message || `Project tree for ${projectId} not found.`);
      } catch (e) {
          // If not JSON, throw generic
          // console.warn(`Project tree for ${projectId} not found (404), returning null for UI.`);
          return null; // Or throw new Error(`Project tree for ${projectId} not found.`);
      }
  }
  return handleResponse<UiWorkItemTreeNode | null>(response);
}
EOF_UI_LIB_CLIENT_API_TS

# ui/src/lib/client/sse.ts
cat << 'EOF_UI_LIB_CLIENT_SSE_TS' > ui/src/lib/client/sse.ts
// ui/src/lib/client/sse.ts
import { writable } from 'svelte/store';
import type { SseEventMessage } from '$types'; // Use renamed type

// Use relative path for proxying
const SSE_URL = '/api/events'; 

function createSseStore() {
  const { subscribe, set } = writable<SseEventMessage | null>(null);
  let eventSource: EventSource | null = null;

  function connect() {
    if (typeof window === 'undefined') return; // Don't run on server

    if (eventSource && (eventSource.readyState === EventSource.OPEN || eventSource.readyState === EventSource.CONNECTING)) {
      console.info('SSE: Already connected or connecting.');
      return;
    }

    console.info('SSE: Connecting to', SSE_URL);
    eventSource = new EventSource(SSE_URL);

    eventSource.onopen = () => {
      console.info('SSE: Connection opened.');
      // Backend now sends a 'connected' event
    };

    eventSource.onerror = (error) => {
      console.error('SSE: Error:', error);
      // Don't set an error event here that might be misinterpreted by UI as data error
      // The UI should handle connection status separately if needed.
      // For POC, just log. Consider retry logic for production.
      // eventSource?.close(); // Optionally close on error to prevent flood of retries
    };

    // Specific event handlers based on `event: <type>` in SSE message
    const eventTypes: SseEventMessage['type'][] = [
      'connected',
      'projectListUpdated',
      'projectTreeUpdated',
      'workItemCreated', // Add if backend sends these granularly
      'workItemUpdated',
      'workItemDeleted',
    ];

    eventTypes.forEach(eventType => {
      if (eventSource) { // Ensure eventSource is not null
        eventSource.addEventListener(eventType, (event: MessageEvent) => {
          try {
            const payload = JSON.parse(event.data);
            console.log(`SSE: Event "${eventType}" received:`, payload);
            set({ type: eventType, payload });
          } catch (e) {
            console.error(`SSE: Failed to parse data for event ${eventType}:`, event.data, e);
          }
        });
      }
    });
  }

  function disconnect() {
    if (eventSource) {
      eventSource.close();
      console.info('SSE: Connection closed by client.');
      eventSource = null;
    }
  }

  return {
    subscribe,
    connect,
    disconnect,
  };
}

export const sseStore = createSseStore();
EOF_UI_LIB_CLIENT_SSE_TS

# ui/src/lib/components/layout/AppLayout.svelte
cat << 'EOF_UI_LIB_COMPONENTS_LAYOUT_APPLAYOUT_SVELTE' > ui/src/lib/components/layout/AppLayout.svelte
<script lang="ts">
  import TopBar from './TopBar.svelte';
  import Sidebar from './Sidebar.svelte';
  import MainPanel from './MainPanel.svelte';
  import { uiStateStore } from '$stores/uiStateStore';
  import { onDestroy, onMount } from 'svelte';
  import { sseStore } from '$client/sse';
  import { browser } from '$app/environment'; // To ensure SSE connection only happens client-side

  let isSidebarCollapsed: boolean;
  const unsubscribeUiState = uiStateStore.subscribe(value => {
    isSidebarCollapsed = value.isSidebarCollapsed;
  });

  onMount(() => {
    if (browser) { // Only connect to SSE on the client
      sseStore.connect(); 
    }
  });

  onDestroy(() => {
    unsubscribeUiState();
    if (browser) { // Only disconnect on the client
      sseStore.disconnect(); 
    }
  });

</script>

<div class="app-layout">
  <TopBar />
  <div class="content-area" class:sidebar-collapsed={isSidebarCollapsed}>
    <Sidebar />
    <MainPanel />
  </div>
</div>

<style>
  .app-layout {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
  }

  .content-area {
    display: flex;
    flex-grow: 1;
    overflow: hidden; 
    /* transition: grid-template-columns 0.3s ease-in-out; No grid here, direct flex */
  }
  /* .sidebar-collapsed class on content-area might not be needed if Sidebar handles its own width */
</style>
EOF_UI_LIB_COMPONENTS_LAYOUT_APPLAYOUT_SVELTE

# ui/src/lib/components/layout/TopBar.svelte
cat << 'EOF_UI_LIB_COMPONENTS_LAYOUT_TOPBAR_SVELTE' > ui/src/lib/components/layout/TopBar.svelte
<script lang="ts">
  // Placeholder for future functionality (e.g., user profile, search)
</script>

<header class="top-bar">
  <div class="logo fixed-width-font">Task Manager UI - POC</div>
  </header>

<style>
  .top-bar {
    background-color: var(--color-topbar-bg, #e8e2ca); /* Updated pastel */
    color: var(--color-text, #3d405b);
    padding: 0.75rem 1.5rem; /* Increased padding */
    display: flex;
    align-items: center;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08); /* Softer shadow */
    height: 55px; 
    flex-shrink: 0; 
    z-index: 100; /* Ensure it's above other content */
  }
  .logo {
    font-weight: 600; /* Slightly bolder */
    font-size: 1.25rem;
  }
</style>
EOF_UI_LIB_COMPONENTS_LAYOUT_TOPBAR_SVELTE

# ui/src/lib/components/layout/Sidebar.svelte
cat << 'EOF_UI_LIB_COMPONENTS_LAYOUT_SIDEBAR_SVELTE' > ui/src/lib/components/layout/Sidebar.svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { projectStore } from '$stores/projectStore';
  import { uiStateStore } from '$stores/uiStateStore';
  import ProjectListItem from '$components/projectList/ProjectListItem.svelte';
  import LoadingSpinner from '$components/common/LoadingSpinner.svelte';

  // Reactive statements for Svelte store values
  $: projects = $projectStore.projects;
  $: isLoading = $projectStore.isLoadingProjects;
  $: error = $projectStore.error;
  $: selectedProjectId = $projectStore.selectedProjectId;
  $: isCollapsed = $uiStateStore.isSidebarCollapsed;

  onMount(() => {
    // Load projects only if not already loaded or loading
    if (!$projectStore.projects.length && !$projectStore.isLoadingProjects) {
      projectStore.loadProjects();
    }
  });

  function handleProjectSelect(projectId: string) {
    projectStore.selectProject(projectId);
  }

  function toggleSidebar() {
    uiStateStore.toggleSidebar();
  }
</script>

<aside class="sidebar" class:collapsed={isCollapsed}>
  <button class="toggle-button fixed-width-font" on:click={toggleSidebar} title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}>
    {isCollapsed ? '☰' : '❮'}
  </button>
  <div class="sidebar-content" class:hidden={isCollapsed}>
    <h2 class="fixed-width-font">Projects</h2>
    {#if isLoading}
      <LoadingSpinner message="Loading projects..." />
    {:else if error}
      <p class="error-message fixed-width-font">Error: {error}</p>
    {:else if projects.length === 0}
      <p class="fixed-width-font">No projects found.</p>
    {:else}
      <ul>
        {#each projects as project (project.work_item_id)}
          <ProjectListItem 
            {project} 
            isSelected={selectedProjectId === project.work_item_id}
            on:select={() => handleProjectSelect(project.work_item_id)}
          />
        {/each}
      </ul>
    {/if}
  </div>
</aside>

<style>
  .sidebar {
    background-color: var(--color-sidebar-bg, #f4f1de);
    padding: 1rem;
    width: 280px;
    transition: width 0.3s ease-in-out, padding 0.3s ease-in-out;
    height: 100%; 
    overflow-y: auto; 
    box-shadow: 1px 0 4px rgba(0,0,0,0.07);
    position: relative; 
    flex-shrink: 0; 
    border-right: 1px solid var(--color-border);
  }

  .sidebar.collapsed {
    width: 60px; 
    padding: 1rem 0.5rem;
  }

  .sidebar.collapsed .sidebar-content.hidden { /* More specific selector */
    display: none;
  }
  .sidebar.collapsed .toggle-button {
    /* Keep toggle button visible and centered */
    right: auto;
    left: 50%;
    transform: translateX(-50%);
    top: 10px;
  }
   .sidebar:not(.collapsed) .toggle-button {
    top: 12px;
    right: 12px;
  }


  .toggle-button {
    position: absolute;
    background: var(--color-accent);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    border-radius: 5px; /* Rounded rectangle */
    width: 32px;
    height: 32px;
    cursor: pointer;
    font-size: 1.1rem; /* Adjusted size */
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
    box-shadow: 0 1px 2px rgba(0,0,0,0.15);
    transition: background-color 0.2s;
  }
  .toggle-button:hover {
    background: var(--color-primary);
    color: white;
  }

  .sidebar-content h2 {
    margin-top: 0; 
    padding-top: 35px; /* Ensure space if toggle button is at top right */
    margin-bottom: 1rem;
    font-size: 1.15rem;
    color: var(--color-text);
    font-weight: 600;
  }
   .sidebar.collapsed .sidebar-content h2 {
       display: none;
   }


  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .error-message {
    color: var(--color-highlight); /* Use highlight for errors */
    padding: 0.5rem;
    background-color: #ffebee; /* Light red background for error */
    border-radius: 4px;
  }
</style>
EOF_UI_LIB_COMPONENTS_LAYOUT_SIDEBAR_SVELTE

# ui/src/lib/components/layout/MainPanel.svelte
cat << 'EOF_UI_LIB_COMPONENTS_LAYOUT_MAINPANEL_SVELTE' > ui/src/lib/components/layout/MainPanel.svelte
<script lang="ts">
  import { projectStore } from '$stores/projectStore';
  import ProjectTreeView from '$components/projectTree/ProjectTreeView.svelte';
  import LoadingSpinner from '$components/common/LoadingSpinner.svelte';

  $: currentTree = $projectStore.currentProjectTree;
  $: isLoading = $projectStore.isLoadingTree;
  $: error = $projectStore.error;
  $: selectedProjectId = $projectStore.selectedProjectId;
</script>

<main class="main-panel">
  {#if isLoading && selectedProjectId} <LoadingSpinner message="Loading project details..." />
  {:else if error && selectedProjectId} 
    <p class="error-message fixed-width-font">Error loading project: {error}</p>
  {:else if currentTree}
    <ProjectTreeView project={currentTree} />
  {:else if selectedProjectId} 
    <p class="placeholder-text fixed-width-font">Project details are not available or the project is empty.</p>
  {:else}
    <p class="placeholder-text fixed-width-font">Select a project from the sidebar to view its details here.</p>
  {/if}
</main>

<style>
  .main-panel {
    flex-grow: 1;
    padding: 1.5rem 2rem; /* More padding */
    background-color: var(--color-background, #fdf6e3);
    height: 100%; 
    overflow-y: auto; 
  }
  .error-message {
    color: var(--color-highlight);
    padding: 1rem;
    background-color: #ffebee;
    border: 1px solid var(--color-highlight);
    border-radius: 4px;
  }
  .placeholder-text {
    color: #888; /* Softer placeholder text */
    font-size: 1.2rem; /* Slightly larger */
    text-align: center;
    margin-top: 4rem;
    font-style: italic;
  }
</style>
EOF_UI_LIB_COMPONENTS_LAYOUT_MAINPANEL_SVELTE

# ui/src/lib/components/projectList/ProjectListItem.svelte
cat << 'EOF_UI_LIB_COMPONENTS_PROJECTLIST_PROJECTLISTITEM_SVELTE' > ui/src/lib/components/projectList/ProjectListItem.svelte
<script lang="ts">
  import type { ProjectListItem } from '$types';

  export let project: ProjectListItem;
  export let isSelected: boolean = false;
</script>

<li 
  class="project-list-item fixed-width-font" 
  class:selected={isSelected}
  on:click
  on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.currentTarget.dispatchEvent(new CustomEvent('select')); }}
  role="button"
  tabindex="0"
  title={project.name}
  aria-current={isSelected ? 'page' : undefined}
>
  <span>{project.name}</span>
</li>

<style>
  .project-list-item {
    padding: 0.7rem 1rem; /* Increased padding */
    margin-bottom: 0.4rem; /* Increased margin */
    border-radius: 5px; /* Slightly more rounded */
    cursor: pointer;
    transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
    border: 1px solid transparent; 
    font-size: 0.9rem; /* Slightly smaller for denser list if needed */
    line-height: 1.4;
    display: block; /* Ensure it takes full width for click */
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .project-list-item:hover,
  .project-list-item:focus { /* Added focus style */
    background-color: var(--color-accent, #b58900);
    color: #002b36; /* Darker text on hover for contrast */
    border-color: var(--color-primary);
    outline: none; /* Remove default focus outline if custom is good */
  }

  .project-list-item.selected {
    background-color: var(--color-primary, #268bd2);
    color: #fdf6e3; /* Light text on primary for contrast */
    font-weight: 600; /* Bolder selected item */
    border-color: var(--color-primary);
  }
</style>
EOF_UI_LIB_COMPONENTS_PROJECTLIST_PROJECTLISTITEM_SVELTE

# ui/src/lib/components/projectTree/ProjectTreeView.svelte
cat << 'EOF_UI_LIB_COMPONENTS_PROJECTTREE_PROJECTTREEVIEW_SVELTE' > ui/src/lib/components/projectTree/ProjectTreeView.svelte
<script lang="ts">
  import type { UiWorkItemTreeNode } from '$types';
  import WorkItemNode from './WorkItemNode.svelte';

  export let project: UiWorkItemTreeNode | null; // Allow null if project might not be found
</script>

<div class="project-tree-view">
  {#if project}
    <WorkItemNode node={project} level={0} />
  {:else}
    <p class="fixed-width-font no-project-data">No project data to display, or project not found.</p>
  {/if}
</div>

<style>
  .project-tree-view {
    font-family: var(--font-mono); 
  }
  .no-project-data {
    color: #777;
    font-style: italic;
    padding: 1rem;
  }
</style>
EOF_UI_LIB_COMPONENTS_PROJECTTREE_PROJECTTREEVIEW_SVELTE

# ui/src/lib/components/projectTree/WorkItemNode.svelte
cat << 'EOF_UI_LIB_COMPONENTS_PROJECTTREE_WORKITEMNODE_SVELTE' > ui/src/lib/components/projectTree/WorkItemNode.svelte
<script lang="ts">
  import type { UiWorkItemTreeNode } from '$types';
  import Expander from '$components/common/Expander.svelte';
  import { getStatusClass as getNodeStatusBgClass } from '$utils/colorUtils'; 

  export let node: UiWorkItemTreeNode;
  export let level: number = 0;

  const MAX_DESC_LENGTH = 120; 

  function formatDate(dateString: string | null): string {
    if (!dateString) return 'N/A';
    try {
      return new Date(dateString).toLocaleDateString(undefined, { 
        year: 'numeric', month: 'short', day: 'numeric', 
      });
    } catch (e) {
      return dateString; 
    }
  }
  
  // Helper to get the text class for status indicators
  function getStatusIndicatorClass(status: string): string {
    if (!status) return '';
    return `status-${status.toLowerCase().replace(/\\s+/g, '-')}`;
  }

</script>

<div class="work-item-node" style="--level: {level}; margin-left: calc(var(--level) * 25px);">
  <div class="node-content node-status-bg {getNodeStatusBgClass(node.status)}">
    <div class="node-header">
      <span class="node-name fixed-width-font">{node.name}</span>
      <span class="node-id fixed-width-font"> (ID: {node.work_item_id.substring(0,8)})</span>
    </div>
    <div class="node-details fixed-width-font">
        <p><strong>Status:</strong> <span class="status-indicator {getStatusIndicatorClass(node.status)}">{node.status || 'N/A'}</span></p>
        <p><strong>Priority:</strong> {node.priority || 'N/A'}</p>
        {#if node.description}
            <p class="description-field"><strong>Desc:</strong> <Expander text={node.description} maxLength={MAX_DESC_LENGTH} /></p>
        {/if}
        <p><strong>Due:</strong> {formatDate(node.due_date)}</p>
        {#if node.tags && node.tags.length > 0}
            <p><strong>Tags:</strong> <span class="tags">{node.tags.join(', ')}</span></p>
        {/if}
        <p class="timestamps">
            <span>Created: {formatDate(node.created_at)}</span>
            <span>Updated: {formatDate(node.updated_at)}</span>
        </p>
        
        {#if node.dependencies_info && node.dependencies_info.length > 0}
            <div class="dependencies">
                <strong>Depends on:</strong>
                <ul>
                    {#each node.dependencies_info as depInfo (depInfo.depends_on_id)}
                        <li>
                           {depInfo.depends_on_name || 'Task'} (ID: {depInfo.depends_on_id.substring(0,8)})
                           {#if depInfo.type} <span class="dep-type">[{depInfo.type}]</span>{/if}
                        </li>
                    {/each}
                </ul>
            </div>
        {/if}
    </div>
  </div>

  {#if node.children && node.children.length > 0}
    <div class="node-children">
      {#each node.children as childNode (childNode.work_item_id)}
        <svelte:self node={childNode} level={level + 1} /> {/each}
    </div>
  {/if}
</div>

<style>
  .work-item-node {
    padding: 0.6rem 0.8rem; /* Adjusted padding */
    margin-bottom: 0.6rem;
    border-radius: 6px; /* More rounded */
    background-color: #fff; 
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    /* border-left will be handled by node-status-bg */
  }

  .node-content {
    padding: 0.8rem 1rem; /* Inner padding */
    border-radius: 4px; /* Inner radius for the background color */
  }

  .node-header {
    display: flex;
    /* justify-content: space-between; */
    align-items: baseline; /* Align baselines of name and ID */
    margin-bottom: 0.6rem;
    flex-wrap: wrap; /* Allow wrapping if name is too long */
  }
  .node-name {
    font-weight: 600;
    font-size: 1.05em; /* Slightly adjusted */
    color: var(--color-text);
    margin-right: 0.5em;
  }
  .node-id {
    font-size: 0.75em; /* Smaller ID */
    color: #899ca1; /* Softer ID color */
    font-family: var(--font-mono);
  }
  .node-details p {
    margin: 0.3rem 0;
    font-size: 0.85em;
    color: var(--color-text);
    line-height: 1.5;
  }
  .node-details p strong {
    color: var(--color-primary);
    font-weight: 500;
  }
  .description-field {
      white-space: pre-wrap; /* Respect newlines in description */
  }
  .tags {
    background-color: var(--color-sidebar-bg);
    padding: 0.1em 0.4em;
    border-radius: 3px;
    font-size: 0.9em;
  }
  .timestamps {
    font-size: 0.7em; /* Smaller timestamps */
    color: #9db2b9;
    display: flex;
    justify-content: space-between;
    margin-top: 0.5em;
    flex-wrap: wrap;
  }
  .timestamps span + span {
    margin-left: 1em;
  }

  .dependencies {
    margin-top: 0.6em;
    font-size: 0.8em;
  }
  .dependencies ul {
    list-style-type: none; /* No bullets for deps */
    padding-left: 0.5em;
    margin: 0.25em 0;
  }
  .dependencies li {
    color: #5a7279;
    padding: 0.1em 0;
  }
  .dep-type {
      font-style: italic;
      color: #78909c;
      font-size: 0.9em;
  }

  .node-children {
    /* padding-left: 25px; /* Handled by margin-left on child .work-item-node */
    /* border-left: 2px solid var(--color-accent); */ /* Visual cue for hierarchy if margin isn't enough */
    margin-top: 0.6rem;
  }
  
  .status-indicator {
    padding: 0.2em 0.5em;
    border-radius: 10px; /* Pill shape */
    font-size: 0.8em; /* Smaller status */
    font-weight: 500;
    text-transform: capitalize;
  }
</style>
EOF_UI_LIB_COMPONENTS_PROJECTTREE_WORKITEMNODE_SVELTE

# ui/src/lib/components/common/Expander.svelte
cat << 'EOF_UI_LIB_COMPONENTS_COMMON_EXPANDER_SVELTE' > ui/src/lib/components/common/Expander.svelte
<script lang="ts">
  export let text: string | null | undefined = '';
  export let maxLength: number = 100;

  let isExpanded = false;
  let needsExpansion: boolean;
  let currentText: string;

  $: {
    const safeText = text || '';
    needsExpansion = safeText.length > maxLength;
    currentText = isExpanded || !needsExpansion ? safeText : safeText.substring(0, maxLength) + '...';
  }
  

  function toggleExpansion(event: MouseEvent) {
    event.stopPropagation(); 
    isExpanded = !isExpanded;
  }
</script>

<div class="text-expander">
  <span class="expandable-text">{@html currentText.replace(/\\n/g, '<br>')}</span>
  {#if needsExpansion}
    <button on:click={toggleExpansion} class="expander-button fixed-width-font" aria-expanded={isExpanded}>
      {isExpanded ? 'Show Less' : 'Show More'}
    </button>
  {/if}
</div>

<style>
  .text-expander {
    display: inline; 
    line-height: 1.5;
  }
  .expandable-text {
      /* Styles for the text itself if needed */
      white-space: pre-wrap; /* Respect newlines from description */
  }
  .expander-button {
    background: none;
    border: none;
    color: var(--color-primary);
    cursor: pointer;
    padding: 0 0 0 0.3em; /* Space before button */
    margin-left: 0.2em; /* Small margin */
    font-size: 0.8em; /* Smaller button text */
    text-decoration: underline;
    display: inline; /* Keep it inline with text */
    vertical-align: baseline;
  }
  .expander-button:hover {
    color: var(--color-highlight);
  }
</style>
EOF_UI_LIB_COMPONENTS_COMMON_EXPANDER_SVELTE

# ui/src/lib/components/common/LoadingSpinner.svelte
cat << 'EOF_UI_LIB_COMPONENTS_COMMON_LOADINGSPINNER_SVELTE' > ui/src/lib/components/common/LoadingSpinner.svelte
<script lang="ts">
    export let message: string = 'Loading...';
    export let size: string = '30px'; // Allow configurable size
</script>

<div class="loading-spinner-container fixed-width-font" role="status" aria-live="polite">
    <div class="spinner" style="width: {size}; height: {size};"></div>
    <p>{message}</p>
</div>

<style>
    .loading-spinner-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 2rem;
        color: var(--color-text);
        text-align: center;
    }
    .spinner {
        border: 4px solid var(--color-background, #f3f3f3); 
        border-top: 4px solid var(--color-primary, #268bd2); /* Use primary color */
        border-radius: 50%;
        /* width and height are set by prop */
        animation: spin 0.8s linear infinite; /* Slightly faster spin */
        margin-bottom: 1rem;
    }

    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
</style>
EOF_UI_LIB_COMPONENTS_COMMON_LOADINGSPINNER_SVELTE

# ui/src/lib/utils/colorUtils.ts
cat << 'EOF_UI_LIB_UTILS_COLORUTILS_TS' > ui/src/lib/utils/colorUtils.ts
// ui/src/lib/utils/colorUtils.ts

/**
 * Returns a CSS class name for background based on the work item status.
 * These classes should be defined in a global CSS file (e.g., app.postcss)
 * e.g., .status-todo-bg, .status-in-progress-bg
 */
export function getStatusClass(status: string | null | undefined): string {
  if (!status) return 'status-unknown-bg'; 
  const normalizedStatus = status.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  switch (normalizedStatus) {
    case 'todo':
      return 'status-todo-bg';
    case 'in-progress':
    case 'inprogress':
      return 'status-in-progress-bg';
    case 'done':
      return 'status-done-bg';
    case 'blocked':
      return 'status-blocked-bg';
    default:
      // For any other status, generate a generic class.
      // This allows some flexibility but relies on CSS defining these.
      // For POC, we might only have specific styles for the main ones.
      return `status-${normalizedStatus}-bg`; 
  }
}

// Utility for status indicator text classes (if different from background)
// e.g. .status-text-todo, .status-text-done
export function getStatusIndicatorClass(status: string | null | undefined): string {
  if (!status) return 'status-text-unknown';
  const normalizedStatus = status.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
   switch (normalizedStatus) {
    case 'todo': return 'status-todo';
    case 'in-progress': case 'inprogress': return 'status-inprogress'; // Match CSS class
    case 'done': return 'status-done';
    case 'blocked': return 'status-blocked';
    default: return `status-${normalizedStatus}`;
  }
}


export function getPriorityClass(priority: string | null | undefined): string {
    if (!priority) return '';
    return `priority-${priority.toLowerCase().replace(/\s+/g, '-')}`;
}
EOF_UI_LIB_UTILS_COLORUTILS_TS

# ui/src/routes/+layout.svelte
cat << 'EOF_UI_SRC_ROUTES_LAYOUT_SVELTE' > ui/src/routes/+layout.svelte
<script lang="ts">
  import AppLayout from '$components/layout/AppLayout.svelte';
  import '../app.postcss'; // Import global styles
</script>

<AppLayout>
  <slot />
</AppLayout>
EOF_UI_SRC_ROUTES_LAYOUT_SVELTE

# ui/src/routes/+page.svelte
cat << 'EOF_UI_SRC_ROUTES_PAGE_SVELTE' > ui/src/routes/+page.svelte
<script lang="ts">
  // The main content is rendered by AppLayout and its children (Sidebar, MainPanel).
  // No specific page logic needed here for this POC structure.
  import { onMount } from 'svelte';
  import { projectStore } from '$stores/projectStore';
  import { browser } from '$app/environment';

  onMount(() => {
    if (browser) {
      // Initial load of projects is now handled by Sidebar's onMount
      // if (!$projectStore.projects.length && !$projectStore.isLoadingProjects) {
      //   projectStore.loadProjects();
      // }
    }
  });

</script>

<svelte:head>
  <title>Task Manager UI - POC</title>
  <meta name="description" content="Svelte POC for Task Management UI with Real-Time Updates" />
</svelte:head>

<!-- 
  The AppLayout component in +layout.svelte wraps this page's content.
  The actual views (Sidebar for project list, MainPanel for project tree)
  are part of that layout.
-->
<div class="page-content-wrapper">
  </div>

<style>
  .page-content-wrapper {
    /* Minimal styling here as AppLayout controls the main structure */
    width: 100%;
    height: 100%;
  }
</style>
EOF_UI_SRC_ROUTES_PAGE_SVELTE

# ui/static/favicon.png (Base64 encoded)
FAVICON_B64="iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAABFSURBVDhPYxgFoxAYICIwASDF+v///wMyQlhAIH4A8Q+gfgLxL0A8AGIQEBiCkxUABots7hhmAAjC5LAyADMoY5gAIAAgyAAAy3B34qESs6UAAAAASUVORK5CYII="
echo "$FAVICON_B64" | base64 --decode > ui/static/favicon.png
echo "Created ui/static/favicon.png from base64 data."


# ui/README.md
cat << 'EOF_UI_README_MD' > ui/README.md
# Task Manager - Svelte UI POC

## Description

This directory contains the SvelteKit frontend application for the Task Manager. 
This initial version is a Proof of Concept (POC) focused on providing a read-only view of projects and tasks, with real-time updates from the backend via Server-Sent Events (SSE).

## Key Features (POC v1)

* View a list of projects in a collapsible sidebar.
* View the detailed task tree (always expanded) for a selected project in the main panel.
* Real-time updates to the project list and project tree when changes occur in the backend.
* Lightweight, "coder-vibe" interface with pastel color coding and fixed-width fonts.
* Textual display of task dependencies.
* Placeholder top bar.

## Technologies Used

* SvelteKit
* Svelte
* TypeScript
* Vite
* ESLint + Prettier
* PostCSS (for global styles)
* Svelte's Scoped CSS

## Project Structure (`ui/`)

* `src/`: Main application code.
    * `app.html`: Main HTML shell.
    * `app.d.ts`: Ambient TypeScript declarations.
    * `app.postcss`: Global CSS styles (theme, fonts, etc.).
    * `lib/`: Svelte components, stores, client utilities.
        * `client/`: Modules for API communication (`api.ts`) and SSE handling (`sse.ts`).
        * `components/`: Reusable Svelte components.
            * `layout/`: Components for the main page structure (TopBar, Sidebar, MainPanel, AppLayout).
            * `projectList/`: Components related to displaying the list of projects.
            * `projectTree/`: Components for the project's task tree view.
            * `common/`: Shared utility components (LoadingSpinner, Expander).
        * `stores/`: Svelte stores for state management (`projectStore.ts`, `uiStateStore.ts`).
        * `types/`: TypeScript type definitions for the UI (`index.ts`).
        * `utils/`: UI-specific utility functions (`colorUtils.ts`).
    * `routes/`: SvelteKit file-system based router (`+layout.svelte`, `+page.svelte`).
* `static/`: Static assets (e.g., `favicon.png`).
* `tests/`: Placeholder for frontend tests.
* `package.json`: Frontend project dependencies and scripts.
* `svelte.config.js`: SvelteKit configuration (using `adapter-static`).
* `vite.config.ts`: Vite configuration (includes proxy setup for dev).
* `tsconfig.json`: TypeScript configuration for the UI.
* `build.sh`: Build script for the UI.
* `.eslintrc.cjs`: ESLint configuration.
* `.prettierrc.json`: Prettier configuration.
* `postcss.config.cjs`: PostCSS configuration.

## Development Setup

1.  **Prerequisites:**
    * Node.js (e.g., v18.x or v20.x)
    * pnpm (preferred), npm, or yarn
    * Ensure the backend server (from the `../src` directory) is running and accessible (typically `http://localhost:3000`).

2.  **Installation (from within the `ui/` directory):**
    ```bash
    cd ui
    pnpm install  # or npm install / yarn install
    ```

3.  **Running in Development Mode (from within the `ui/` directory):**
    ```bash
    pnpm dev
    ```
    This will typically start the SvelteKit development server on `http://localhost:5173`. API and SSE requests to `/api/*` will be proxied to `http://localhost:3000/api/*` by Vite.

## Linting

To check for code style and potential errors (from within the `ui/` directory):
```bash
pnpm lint