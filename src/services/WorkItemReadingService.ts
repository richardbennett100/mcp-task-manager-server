// src/services/WorkItemReadingService.ts
import {
  WorkItemRepository,
  WorkItemData,
  // WorkItemDependencyData, // Removed unused import
} from '../repositories/index.js';
import { logger } from '../utils/logger.js';
import { ListWorkItemsFilter, FullWorkItemData, WorkItemTreeNode, GetFullTreeOptions } from './WorkItemServiceTypes.js';
import { NotFoundError } from '../utils/errors.js';

/**
 * Service responsible for reading work items
 */
export class WorkItemReadingService {
  private workItemRepository: WorkItemRepository;

  constructor(workItemRepository: WorkItemRepository) {
    this.workItemRepository = workItemRepository;
  }

  /**
   * Gets a work item with its dependencies, dependents, and children.
   */
  public async getWorkItemById(id: string, filter?: { isActive?: boolean }): Promise<FullWorkItemData | null> {
    logger.debug(`[WorkItemReadingService] Getting work item by ID: ${id} with filter:`, filter);
    // Default to finding active items if filter.isActive is not explicitly false or undefined
    const findFilter = {
      isActive: filter?.isActive === false ? false : filter?.isActive === undefined ? undefined : true,
    };
    const item = await this.workItemRepository.findById(id, findFilter);

    if (!item) {
      logger.warn(
        `[WorkItemReadingService] Work item ${id} not found or filtered out (isActive: ${findFilter.isActive ?? 'any'}).`
      );
      return null;
    }

    // Fetch related items, typically only active ones are relevant by default
    const depFilter = { isActive: true };

    const [dependencies, dependents, children] = await Promise.all([
      this.workItemRepository.findDependencies(id, depFilter),
      this.workItemRepository.findDependents(id, depFilter),
      this.workItemRepository.findChildren(id, { isActive: item.is_active }),
    ]);

    const fullData: FullWorkItemData = {
      ...item,
      dependencies,
      dependents,
      children,
    };
    return fullData;
  }

  /**
   * Lists work items based on filters.
   */
  public async listWorkItems(filter: ListWorkItemsFilter): Promise<WorkItemData[]> {
    logger.debug(`[WorkItemReadingService] Listing work items with filter:`, filter);
    try {
      // Default isActive filter to undefined (fetch all) unless explicitly set
      const isActiveFilter = filter.isActive === false ? false : filter.isActive === undefined ? undefined : true;
      const parentId = filter.parent_work_item_id === undefined ? undefined : (filter.parent_work_item_id ?? null);
      const statusFilter = filter.status;

      // Construct the filter object for repository methods
      const repoFilter: { isActive?: boolean; status?: WorkItemData['status'] } = {};
      if (isActiveFilter !== undefined) {
        repoFilter.isActive = isActiveFilter;
      }
      if (statusFilter) {
        repoFilter.status = statusFilter;
      }

      let items: WorkItemData[];

      if (filter.rootsOnly === true || parentId === null) {
        items = await this.workItemRepository.findRoots(repoFilter);
      } else if (parentId !== undefined && typeof parentId === 'string') {
        items = await this.workItemRepository.findChildren(parentId, repoFilter);
      } else {
        // If no specific scope (root/child) is requested, find all matching the filter
        items = await this.workItemRepository.findAll(repoFilter);
      }
      logger.info(`[WorkItemReadingService] Listed ${items.length} items.`);
      return items;
    } catch (error: unknown) {
      logger.error(`[WorkItemReadingService] Error listing work items:`, error);
      throw error;
    }
  }

  /**
   * Retrieves a work item and its full descendant tree recursively.
   */
  public async getFullTree(rootWorkItemId: string, options?: GetFullTreeOptions): Promise<WorkItemTreeNode | null> {
    const includeInactiveItems = options?.include_inactive_items ?? false;
    const includeInactiveDependencies = options?.include_inactive_dependencies ?? false;
    const maxDepth = options?.max_depth ?? 10; // Default max depth

    const getSubTree = async (itemId: string, currentDepth: number): Promise<WorkItemTreeNode | null> => {
      if (currentDepth > maxDepth) {
        logger.debug(
          `[WorkItemReadingService] Max depth ${maxDepth} reached for item ${itemId}. Returning item without children.`
        );
        const currentItemData = await this.workItemRepository.findById(itemId, {
          isActive: includeInactiveItems ? undefined : true,
        });
        if (!currentItemData) return null;
        const [dependencies, dependents] = await Promise.all([
          this.workItemRepository.findDependencies(itemId, {
            isActive: includeInactiveDependencies ? undefined : true,
          }),
          this.workItemRepository.findDependents(itemId, { isActive: includeInactiveDependencies ? undefined : true }),
        ]);
        return { ...currentItemData, dependencies, dependents, children: [] };
      }

      const itemFilter = { isActive: includeInactiveItems ? undefined : true };
      const item = await this.workItemRepository.findById(itemId, itemFilter);

      if (!item) {
        logger.warn(
          `[WorkItemReadingService] Item ${itemId} not found for tree (filter: ${JSON.stringify(itemFilter)}).`
        );
        return null;
      }

      const childrenFilter: ListWorkItemsFilter = {};
      if (!includeInactiveItems) {
        childrenFilter.isActive = true;
      }
      const directChildrenData = await this.workItemRepository.findChildren(itemId, childrenFilter);

      const childrenNodes: WorkItemTreeNode[] = [];
      for (const childData of directChildrenData) {
        const childNode = await getSubTree(childData.work_item_id, currentDepth + 1);
        if (childNode) {
          childrenNodes.push(childNode);
        }
      }

      const depFilter = { isActive: includeInactiveDependencies ? undefined : true };
      const [dependencies, dependents] = await Promise.all([
        this.workItemRepository.findDependencies(itemId, depFilter),
        this.workItemRepository.findDependents(itemId, depFilter),
      ]);

      return {
        ...item,
        dependencies,
        dependents,
        children: childrenNodes.length > 0 ? childrenNodes : undefined,
      };
    };

    logger.info(`[WorkItemReadingService] Fetching full tree for root ID: ${rootWorkItemId} with options:`, options);
    const tree = await getSubTree(rootWorkItemId, 1);
    if (!tree) {
      // This NotFoundError should be thrown if the root item itself is not found based on criteria
      throw new NotFoundError(
        `Root work item with ID ${rootWorkItemId} not found or does not meet active/inactive criteria.`
      );
    }
    return tree;
  }
}
