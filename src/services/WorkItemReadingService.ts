// src/services/WorkItemReadingService.ts
import {
  WorkItemRepository,
  WorkItemData,
} from '../repositories/WorkItemRepository.js';
import { logger } from '../utils/logger.js';
import { ListWorkItemsFilter, FullWorkItemData } from './WorkItemServiceTypes.js';

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
    const item = await this.workItemRepository.findById(id, filter); // No client needed for standalone read

    if (!item) {
      logger.warn(`[WorkItemReadingService] Work item ${id} not found or filtered out.`);
      return null;
    }

    // No client needed for standalone reads
    const [dependencies, dependents, children] = await Promise.all([
      this.workItemRepository.findDependencies(id, { isActive: true, dependsOnActive: true }),
      this.workItemRepository.findDependents(id, { isActive: true, dependentIsActive: true }),
      this.workItemRepository.findChildren(id, { isActive: true }),
    ]);

    const fullData: FullWorkItemData = { ...item, dependencies, dependents, children };
    return fullData;
  }

  /**
   * Lists work items based on filters.
   */
  public async listWorkItems(filter: ListWorkItemsFilter): Promise<WorkItemData[]> {
    logger.debug(`[WorkItemReadingService] Listing work items with filter:`, filter);
    try {
      const isActiveFilter = filter.isActive === undefined ? true : filter.isActive;
      const parentId = filter.parent_work_item_id === undefined ? undefined : filter.parent_work_item_id ?? null;

      let items: WorkItemData[];

      // No client needed for standalone reads
      if (filter.rootsOnly === true || parentId === null) {
        items = await this.workItemRepository.findRoots({ isActive: isActiveFilter });
        logger.info(`[WorkItemReadingService] Listed ${items.length} root items (active: ${isActiveFilter}).`);
      } else if (parentId !== undefined && typeof parentId === 'string') {
        items = await this.workItemRepository.findChildren(parentId, { isActive: isActiveFilter });
        logger.info(`[WorkItemReadingService] Listed ${items.length} children for parent ${parentId} (active: ${isActiveFilter}).`);
      } else {
        logger.info(`[WorkItemReadingService] Listing all items (active: ${isActiveFilter}).`);
        items = await this.workItemRepository.findAll({ isActive: isActiveFilter });
      }

      if (filter.status) {
        items = items.filter((item) => item.status === filter.status);
      }
      return items;
    } catch (error: unknown) {
      logger.error(`[WorkItemReadingService] Error listing work items:`, error);
      throw error;
    }
  }
}
