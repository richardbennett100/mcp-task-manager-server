// src/services/WorkItemService.ts
import { v4 as uuidv4 } from 'uuid';
import {
  WorkItemRepository,
  WorkItemData,
  WorkItemDependencyData,
} from '../repositories/WorkItemRepository.js'; // Use the new repository
import { logger } from '../utils/logger.js';
import { NotFoundError, ValidationError } from '../utils/errors.js'; // Removed unused ConflictError for now

// --- Input/Output Interfaces ---

export interface AddWorkItemInput {
  parent_work_item_id?: string | null;
  name: string;
  description?: string | null;
  priority?: 'high' | 'medium' | 'low';
  status?: 'todo' | 'in-progress' | 'review' | 'done';
  due_date?: string | null;
  order_key?: string | null; // Allow explicitly setting order on create
  shortname?: string | null; // Allow explicitly setting shortname on create
  dependencies?: Omit<WorkItemDependencyData, 'work_item_id'>[];
}

export interface UpdateWorkItemInput {
  parent_work_item_id?: string | null;
  name?: string;
  description?: string | null;
  priority?: 'high' | 'medium' | 'low';
  // Status here intentionally excludes 'deleted'
  status?: 'todo' | 'in-progress' | 'review' | 'done';
  due_date?: string | null;
  order_key?: string | null;
  shortname?: string | null;
}

export interface ListWorkItemsFilter {
  parent_work_item_id?: string | null;
  rootsOnly?: boolean;
  status?: WorkItemData['status'];
}

export interface FullWorkItemData extends WorkItemData {
  dependencies: WorkItemDependencyData[];
  dependents: WorkItemDependencyData[];
  children: WorkItemData[];
}

// --- Service Implementation ---

export class WorkItemService {
  private workItemRepository: WorkItemRepository;

  constructor(workItemRepository: WorkItemRepository) {
    this.workItemRepository = workItemRepository;
  }

  public async addWorkItem(input: AddWorkItemInput): Promise<WorkItemData> {
    const workItemId = uuidv4();
    const now = new Date().toISOString(); // Timestamp generated here
    const parentId = input.parent_work_item_id ?? null;

    const calculatedShortname =
      input.shortname ??
      (await this._calculateShortname(input.name, parentId));

    const calculatedOrderKey =
      input.order_key ??
      (await this._calculateOrderKey(parentId, null)); // null = insert at end

    // Create the full WorkItemData object including timestamps
    const newItemData: WorkItemData = {
      work_item_id: workItemId,
      parent_work_item_id: parentId,
      name: input.name,
      shortname: calculatedShortname,
      description: input.description ?? null,
      status: input.status ?? 'todo',
      priority: input.priority ?? 'medium',
      order_key: calculatedOrderKey,
      created_at: now, // Include timestamp
      updated_at: now, // Include timestamp
      due_date: input.due_date ?? null,
    };

    try {
        console.log(
            'DEBUG WorkItemService: Passing to repository.create:',
            JSON.stringify(newItemData, null, 2) // Log the object being passed
          );
      // Pass the complete newItemData object
      const createdItem = await this.workItemRepository.create(
        newItemData,
        input.dependencies
      );
      logger.info(
        `[WorkItemService] Added work item ${workItemId} with name "${input.name}"`
      );
      return createdItem;
    } catch (error: unknown) {
      logger.error(
        `[WorkItemService] Error adding work item "${input.name}":`,
        error
      );
      throw error;
    }
  }

  public async getWorkItemById(id: string): Promise<FullWorkItemData | null> {
    logger.debug(`[WorkItemService] Getting work item by ID: ${id}`);
    const item = await this.workItemRepository.findById(id);
    if (!item) {
      logger.warn(`[WorkItemService] Work item ${id} not found.`);
      return null; // Return null if not found
    }

    // Fetch related data in parallel
    const [dependencies, dependents, children] = await Promise.all([
      this.workItemRepository.findDependencies(id),
      this.workItemRepository.findDependents(id), // Fetch dependents as well
      this.workItemRepository.findChildren(id),
    ]);

    const fullData: FullWorkItemData = {
      ...item,
      dependencies,
      dependents,
      children,
    };
    return fullData;
  }

  public async listWorkItems(
    filter: ListWorkItemsFilter
  ): Promise<WorkItemData[]> {
    logger.debug(`[WorkItemService] Listing work items with filter:`, filter);
    try {
      let items: WorkItemData[];
      // Explicitly check undefined vs null for parent filter
      const parentId = filter.parent_work_item_id === undefined ? undefined : filter.parent_work_item_id ?? null;

      if (filter.rootsOnly === true || parentId === null) {
        items = await this.workItemRepository.findRoots();
        logger.info(`[WorkItemService] Listed ${items.length} root items.`);
      } else if (parentId !== undefined) { // parentId is a string here
        items = await this.workItemRepository.findChildren(parentId);
         logger.info(`[WorkItemService] Listed ${items.length} children for parent ${parentId}.`);
      } else {
         // Default: Currently returns empty. Consider listing ALL active items?
         logger.warn('[WorkItemService] listWorkItems called without specific parent or root filter. Returning empty array.');
         items = [];
        // Or: items = await this.workItemRepository.findAllActive(); // Requires new repo method
      }

      // Post-filter if necessary (though ideally done in DB query)
      if (filter.status) {
        items = items.filter((item) => item.status === filter.status);
      }

      return items;
    } catch (error: unknown) {
      logger.error(`[WorkItemService] Error listing work items:`, error);
      throw error;
    }
  }

  public async updateWorkItem(
    id: string,
    updates: UpdateWorkItemInput,
    dependencies?: Omit<WorkItemDependencyData, 'work_item_id'>[] // Full list replaces existing
  ): Promise<WorkItemData> {
    logger.debug(`[WorkItemService] Updating work item ${id} with data:`, {updates, hasDependencies: dependencies !== undefined});

    const existingItem = await this.workItemRepository.findById(id);
    if (!existingItem) {
      throw new NotFoundError(`Work item with ID ${id} not found or has been deleted.`);
    }

    // Add ts-expect-error comment to suppress the overlap warning
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error - This check is intentional defensive programming to prevent using update for deletion.
    if (updates.status && updates.status === 'deleted') {
      throw new ValidationError(
        "Cannot set status to 'deleted' via update. Use deleteWorkItem instead."
      );
    }

    const updatePayload: Partial<WorkItemData> = { ...updates };
    const nameChanged = updates.name !== undefined && updates.name !== existingItem.name;
    // Correctly handle comparing potential undefined/null with existing null/string parent ID
    const parentChanged = updates.parent_work_item_id !== undefined && updates.parent_work_item_id !== existingItem.parent_work_item_id;

    if ((nameChanged || parentChanged) && updates.shortname === undefined) {
      const newName = updates.name ?? existingItem.name;
      // Correctly determine the new parent ID for shortname calculation
      const newParentId = parentChanged ? (updates.parent_work_item_id ?? null) : existingItem.parent_work_item_id;
      updatePayload.shortname = await this._calculateShortname(newName, newParentId, id);
    }

    if (parentChanged && updates.order_key === undefined) {
       const newParentId = updates.parent_work_item_id ?? null; // Use ?? null
      updatePayload.order_key = await this._calculateOrderKey(newParentId, null); // Move to end by default
    }

    try {
      const updatedItem = await this.workItemRepository.update(
        id,
        updatePayload,
        dependencies // Pass dependencies separately to repo update method
      );
      logger.info(`[WorkItemService] Updated work item ${id}.`);
      return updatedItem;
    } catch (error: unknown) {
      logger.error(`[WorkItemService] Error updating work item ${id}:`, error);
       if (error instanceof Error && error.message.includes('not found')) {
           throw new NotFoundError(`Work item with ID ${id} not found or has been deleted.`);
       }
      throw error;
    }
  }

  public async deleteWorkItem(ids: string[]): Promise<number> {
    if (!ids || ids.length === 0) {
      return 0;
    }
    logger.warn(
      `[WorkItemService] Attempting to soft delete ${ids.length} work item(s): ${ids.join(', ')}`
    );
    // TODO: Add business logic? E.g., prevent deleting project with active tasks?
    try {
      const deletedCount = await this.workItemRepository.softDelete(ids);
      logger.info(
        `[WorkItemService] Soft deleted ${deletedCount} work item(s).`
      );
      return deletedCount;
    } catch (error: unknown) {
      logger.error(`[WorkItemService] Error soft deleting work items:`, error);
      throw error;
    }
  }

  // --- Placeholder Private Helper Methods ---
  private async _calculateShortname(
    name: string,
    _parentId: string | null, // Prefixed as unused
    _excludeId?: string // Prefixed as unused
  ): Promise<string | null> {
    logger.warn(
      `[WorkItemService] _calculateShortname NOT IMPLEMENTED - Returning placeholder.`
    );
    if (!name) return null;
    // TODO: Fetch siblings, check conflicts, generate unique shortname
    const initial = name.substring(0, 2).toUpperCase();
    return initial || null;
  }

  private async _calculateOrderKey(
    _parentId: string | null, // Prefixed as unused
    _previousSiblingOrderKey: string | null // Prefixed as unused
  ): Promise<string | null> {
    logger.warn(
      `[WorkItemService] _calculateOrderKey NOT IMPLEMENTED - Returning null.`
    );
    // TODO: Implement fractional indexing key generation
    return null;
  }
}