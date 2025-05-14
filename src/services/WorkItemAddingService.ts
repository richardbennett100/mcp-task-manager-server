// File: src/services/WorkItemAddingService.ts
import { PoolClient } from 'pg';
import { validate as uuidValidate, v4 as uuidv4 } from 'uuid';
import {
  WorkItemRepository,
  ActionHistoryRepository,
  WorkItemData,
  WorkItemDependencyData,
  CreateUndoStepInput,
  ActionHistoryData, // For createdAction type
} from '../repositories/index.js';
import { AddWorkItemInput, PositionEnum as PositionEnumConst } from './WorkItemServiceTypes.js';
import { z } from 'zod';
import { WorkItemHistoryService } from './WorkItemHistoryService.js';
import { WorkItemUtilsService } from './WorkItemUtilsService.js';
import { NotFoundError, ValidationError, DatabaseError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export class WorkItemAddingService {
  private workItemRepository: WorkItemRepository;
  private actionHistoryRepository: ActionHistoryRepository;
  private historyService: WorkItemHistoryService;

  constructor(
    workItemRepository: WorkItemRepository,
    actionHistoryRepository: ActionHistoryRepository,
    historyService: WorkItemHistoryService
  ) {
    this.workItemRepository = workItemRepository;
    this.actionHistoryRepository = actionHistoryRepository;
    this.historyService = historyService;
  }

  private async determineOrderKeys(
    client: PoolClient,
    parentId: string | null,
    insertAt?: z.infer<typeof PositionEnumConst>,
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
    } else {
      keyBefore = await this.workItemRepository.findSiblingEdgeOrderKey(parentId, 'last', client);
      keyAfter = null;
    }
    return { keyBefore, keyAfter };
  }

  private async performActualAdd(input: AddWorkItemInput, client: PoolClient): Promise<WorkItemData> {
    logger.debug('[WorkItemAddingService-performActualAdd] Input:', input);
    const parentId = input.parent_work_item_id || null;

    if (parentId) {
      if (!uuidValidate(parentId)) {
        throw new ValidationError(`Invalid parent_work_item_id format: ${parentId}`);
      }

      const parentItem = await this.workItemRepository.findById(parentId, undefined, client);
      if (!parentItem) {
        // This message will be "Parent work item with ID ... not found."
        // The test expects /not found or is inactive/ for the inactive parent case.
        // So if a parent is NOT found, this message is fine.
        throw new NotFoundError(`Parent work item with ID ${parentId} not found.`);
      }
      if (!parentItem.is_active) {
        // MODIFIED: Error message for inactive parent to match test regex
        throw new ValidationError(`Parent work item with ID ${parentId} not found or is inactive.`);
      }
    }

    if (input.dependencies) {
      for (const dep of input.dependencies) {
        if (!uuidValidate(dep.depends_on_work_item_id)) {
          throw new ValidationError(
            `Invalid depends_on_work_item_id format in dependencies: ${dep.depends_on_work_item_id}`
          );
        }
      }
    }

    const { keyBefore, keyAfter } = await this.determineOrderKeys(
      client,
      parentId,
      input.insertAt,
      input.insertAfter_work_item_id,
      input.insertBefore_work_item_id
    );

    const order_key = WorkItemUtilsService.calculateOrderKey(keyBefore, keyAfter);
    if (order_key === null) {
      throw new Error('Failed to calculate a valid order key for the new work item.');
    }

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
    };

    let mappedDependenciesForRepoCreate:
      | (Omit<WorkItemDependencyData, 'work_item_id'> & { work_item_id?: string })[]
      | undefined = undefined;
    if (input.dependencies && input.dependencies.length > 0) {
      mappedDependenciesForRepoCreate = input.dependencies.map((dep) => ({
        depends_on_work_item_id: dep.depends_on_work_item_id,
        dependency_type: dep.dependency_type || 'finish-to-start',
        is_active: true,
      }));
    }

    const createdItem = await this.workItemRepository.create(
      client,
      newWorkItemData,
      mappedDependenciesForRepoCreate as WorkItemDependencyData[] | undefined
    );

    if (!createdItem) {
      throw new DatabaseError('Failed to create work item in repository, repository returned null.');
    }
    logger.info(`[WorkItemAddingService] Created work item ${createdItem.work_item_id} with order_key ${order_key}`);
    return createdItem;
  }

  public async addWorkItem(input: AddWorkItemInput): Promise<WorkItemData> {
    logger.info('[WorkItemAddingService] addWorkItem (public) called with input:', input);

    const newWorkItem = await this.actionHistoryRepository.withTransaction(async (txClient) => {
      const createdItem = await this.performActualAdd(input, txClient);

      const undoSteps: CreateUndoStepInput[] = [];

      undoSteps.push({
        step_order: 1,
        step_type: 'UPDATE',
        table_name: 'work_items',
        record_id: createdItem.work_item_id,
        old_data: {
          is_active: false,
        },
        new_data: { ...createdItem },
      });

      if (input.dependencies && input.dependencies.length > 0) {
        const actualCreatedDependencies = await this.workItemRepository.findDependencies(
          createdItem.work_item_id,
          { isActive: true },
          txClient
        );

        actualCreatedDependencies.forEach((depLink, index) => {
          const wasInInput = input.dependencies?.some(
            (inpDep) =>
              inpDep.depends_on_work_item_id === depLink.depends_on_work_item_id &&
              (inpDep.dependency_type || 'finish-to-start') === depLink.dependency_type
          );

          if (wasInInput) {
            undoSteps.push({
              step_order: 2 + index,
              step_type: 'UPDATE',
              table_name: 'work_item_dependencies',
              record_id: `${depLink.work_item_id}:${depLink.depends_on_work_item_id}`,
              old_data: {
                dependency_type: depLink.dependency_type,
                is_active: false,
              },
              new_data: { ...depLink },
            });
          }
        });
      }

      const createdAction: ActionHistoryData = await this.actionHistoryRepository.createActionInClient(
        {
          action_type: 'ADD_WORK_ITEM',
          work_item_id: createdItem.work_item_id,
          description: `Added work item "${createdItem.name}"`,
        },
        txClient
      );

      for (const step of undoSteps) {
        await this.actionHistoryRepository.createUndoStepInClient(
          { ...step, action_id: createdAction.action_id },
          txClient
        );
      }

      await this.historyService.invalidateRedoStack(txClient, createdAction.action_id);

      logger.info(
        `[WorkItemAddingService] Added work item ${createdItem.work_item_id} and recorded history with undo steps.`
      );
      return createdItem;
    });

    return newWorkItem;
  }
}
