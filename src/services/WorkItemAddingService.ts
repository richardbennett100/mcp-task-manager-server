// Modified upload/src/services/WorkItemAddingService.ts
// Changes:
// 1. Added import for 'validate as uuidValidate' from 'uuid'.
// 2. Added UUID format validation for initialParentId at the beginning of addWorkItemTree.
// upload/src/services/WorkItemAddingService.ts
import { PoolClient } from 'pg';
import { v4 as uuidv4, validate as uuidValidate } from 'uuid'; // Added uuidValidate
import {
  WorkItemRepository,
  ActionHistoryRepository,
  WorkItemData,
  WorkItemDependencyData,
  CreateActionHistoryInput,
  CreateUndoStepInput,
} from '../repositories/index.js';
import { AddWorkItemInput, PositionEnum } from './WorkItemServiceTypes.js';
import { ChildTaskInputRecursive } from '../tools/add_child_tasks_params.js';
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
      `[WorkItemAddingService-createSingleWorkItemInTree] Creating item: "${itemData.name}" under parent: ${parentId}`
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
    };

    const createdItem = await this.workItemRepository.create(client, newWorkItemData, undefined);

    if (!createdItem) {
      throw new DatabaseError(`Failed to create work item "${itemData.name}" in repository.`);
    }
    logger.info(
      `[WorkItemAddingService] Created single item in tree: ${createdItem.work_item_id} ("${createdItem.name}")`
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
      const parentItem = await this.workItemRepository.findById(currentParentId, undefined, client);
      if (!parentItem) {
        throw new NotFoundError(`Parent work item with ID ${currentParentId} not found for adding children.`);
      }
      if (!parentItem.is_active) {
        throw new ValidationError(`Parent work item with ID ${currentParentId} is inactive.`);
      }
      if (parentItem.status === 'done') {
        throw new ValidationError(
          `Parent work item "${parentItem.name}" (ID: ${currentParentId}) is "done", cannot add children.`
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

    // Validate UUID format first
    if (!uuidValidate(initialParentId)) {
      throw new ValidationError(`Invalid parent_work_item_id format: ${initialParentId}`);
    }

    const parentItem = await this.workItemRepository.findById(initialParentId, undefined);
    if (!parentItem) {
      throw new NotFoundError(`Initial parent work item with ID ${initialParentId} not found.`);
    }
    if (!parentItem.is_active) {
      throw new ValidationError(
        `Initial parent work item "${parentItem.name}" (ID: ${initialParentId}) is inactive and cannot have new tasks added.`
      );
    }
    if (parentItem.status === 'done') {
      throw new ValidationError(
        `Initial parent work item "${parentItem.name}" (ID: ${initialParentId}) is marked as "done" and cannot have new tasks added.`
      );
    }

    const allCreatedItems: WorkItemData[] = [];

    await this.actionHistoryRepository.withTransaction(async (txClient) => {
      await this.addWorkItemTreeRecursiveInternal(initialParentId, childTasksTree, txClient, allCreatedItems);

      if (allCreatedItems.length > 0) {
        const topLevelCreatedNames = childTasksTree.map((t) => t.name).join(', ');
        const description = `Added task tree (${allCreatedItems.length} total items) under "${parentItem.name}": ${topLevelCreatedNames}`;

        const actionData: CreateActionHistoryInput = {
          action_type: 'ADD_TASK_TREE',
          work_item_id: initialParentId,
          description: description.substring(0, 250),
        };

        const undoStepsForBatch: CreateUndoStepInput[] = [];
        allCreatedItems.forEach((createdItem, index) => {
          undoStepsForBatch.push({
            step_order: index + 1,
            step_type: 'UPDATE',
            table_name: 'work_items',
            record_id: createdItem.work_item_id,
            old_data: { is_active: false },
            new_data: { ...createdItem, is_active: true },
          });
        });

        const createdAction = await this.actionHistoryRepository.createActionWithSteps(actionData, undoStepsForBatch);

        await this.historyService.invalidateRedoStack(txClient, createdAction.action_id);
        logger.info(
          `[WorkItemAddingService] Task tree creation transaction committed. Action ID: ${createdAction.action_id}. Total items: ${allCreatedItems.length}.`
        );
      } else {
        logger.info(`[WorkItemAddingService] No items were specified in the task tree for parent ${initialParentId}.`);
      }
    });

    return allCreatedItems;
  }

  public async addWorkItem(input: AddWorkItemInput): Promise<WorkItemData> {
    logger.info('[WorkItemAddingService] addWorkItem (public) called with input:', input);
    let createdItemGlobal: WorkItemData | undefined;

    await this.actionHistoryRepository.withTransaction(async (txClient) => {
      if (input.parent_work_item_id && !uuidValidate(input.parent_work_item_id)) {
        throw new ValidationError(`Invalid parent_work_item_id format: ${input.parent_work_item_id}`);
      }

      const parentId = input.parent_work_item_id || null;
      if (parentId) {
        const parentItemData = await this.workItemRepository.findById(parentId, undefined, txClient);
        if (!parentItemData) throw new NotFoundError(`Parent work item with ID ${parentId} not found.`);
        if (!parentItemData.is_active)
          throw new ValidationError(`Parent work item with ID ${parentId} not found or is inactive.`);
        if (parentItemData.status === 'done')
          throw new ValidationError(`Parent work item "${parentItemData.name}" (ID: ${parentId}) is "done".`);
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

      let dependenciesForRepoCreate: WorkItemDependencyData[] | undefined = undefined;
      if (input.dependencies && input.dependencies.length > 0) {
        dependenciesForRepoCreate = input.dependencies.map((d) => ({
          work_item_id: newWorkItemData.work_item_id,
          depends_on_work_item_id: d.depends_on_work_item_id,
          dependency_type: d.dependency_type || 'finish-to-start',
          is_active: true,
        }));
      }
      const createdItem = await this.workItemRepository.create(txClient, newWorkItemData, dependenciesForRepoCreate);
      if (!createdItem) throw new DatabaseError('Failed to create item in repository.');
      createdItemGlobal = createdItem;

      const undoStepsForSingleAdd: CreateUndoStepInput[] = [
        {
          step_order: 1,
          step_type: 'UPDATE',
          table_name: 'work_items',
          record_id: createdItem.work_item_id,
          old_data: { is_active: false },
          new_data: { ...createdItem },
        },
      ];

      if (dependenciesForRepoCreate) {
        dependenciesForRepoCreate.forEach((dep, index) => {
          undoStepsForSingleAdd.push({
            step_order: 2 + index,
            step_type: 'UPDATE',
            table_name: 'work_item_dependencies',
            record_id: `${createdItem.work_item_id}:${dep.depends_on_work_item_id}`,
            old_data: { is_active: false },
            new_data: { ...dep },
          });
        });
      }

      const actionInput: CreateActionHistoryInput = {
        action_type: 'ADD_WORK_ITEM',
        work_item_id: createdItem.work_item_id,
        description: `Added work item "${createdItem.name}"`,
      };

      const createdAction = await this.actionHistoryRepository.createActionWithSteps(
        actionInput,
        undoStepsForSingleAdd
      );
      await this.historyService.invalidateRedoStack(txClient, createdAction.action_id);

      logger.info(
        `[WorkItemAddingService] Added single work item ${createdItem.work_item_id} and recorded history. Action ID: ${createdAction.action_id}`
      );
    });

    if (!createdItemGlobal) {
      throw new DatabaseError('Failed to create work item, global item reference not set.');
    }
    return createdItemGlobal;
  }
}
