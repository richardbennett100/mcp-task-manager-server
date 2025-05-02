// src/services/WorkItemReadingService.ts
import {
  WorkItemRepository, // Import main repo class
  WorkItemData, // Import type via index
} from '../repositories/index.js'; // USE BARREL FILE
import { logger } from '../utils/logger.js';
import { ListWorkItemsFilter, FullWorkItemData } from './WorkItemServiceTypes.js'; // Assuming path is correct

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
    // Default to finding active items if filter.isActive is not explicitly false
    const findFilter = { isActive: filter?.isActive === false ? false : true };
    const item = await this.workItemRepository.findById(id, findFilter);

    if (!item) {
      logger.warn(
        `[WorkItemReadingService] Work item ${id} not found or filtered out (isActive: ${findFilter.isActive}).`
      );
      return null;
    }

    // Fetch related items, typically only active ones are relevant by default
    const [dependencies, dependents, children] = await Promise.all([
      this.workItemRepository.findDependencies(id, { isActive: true }), // Find active dependencies
      this.workItemRepository.findDependents(id, { isActive: true }), // Find active dependents
      this.workItemRepository.findChildren(id, { isActive: true }), // Find active children
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
      // Default isActive filter to true unless explicitly set to false
      const isActiveFilter = filter.isActive === false ? false : true;
      const parentId = filter.parent_work_item_id === undefined ? undefined : (filter.parent_work_item_id ?? null);
      const statusFilter = filter.status; // Pass status directly

      // Construct the filter object for repository methods
      const repoFilter: { isActive: boolean; status?: WorkItemData['status'] } = {
        isActive: isActiveFilter,
      };
      if (statusFilter) {
        repoFilter.status = statusFilter;
      }

      let items: WorkItemData[];

      // Call the appropriate repository method with the combined filter
      if (filter.rootsOnly === true || parentId === null) {
        items = await this.workItemRepository.findRoots(repoFilter);
        logger.info(
          `[WorkItemReadingService] Listed ${items.length} root items (active: ${isActiveFilter}, status: ${
            statusFilter ?? 'any'
          }).`
        );
      } else if (parentId !== undefined && typeof parentId === 'string') {
        items = await this.workItemRepository.findChildren(parentId, repoFilter);
        logger.info(
          `[WorkItemReadingService] Listed ${
            items.length
          } children for parent ${parentId} (active: ${isActiveFilter}, status: ${statusFilter ?? 'any'}).`
        );
      } else {
        // If no specific scope (root/child) is requested, find all matching the filter
        logger.info(
          `[WorkItemReadingService] Listing all items (active: ${isActiveFilter}, status: ${statusFilter ?? 'any'}).`
        );
        items = await this.workItemRepository.findAll(repoFilter);
      }

      return items;
    } catch (error: unknown) {
      logger.error(`[WorkItemReadingService] Error listing work items:`, error);
      throw error;
    }
  }
}
