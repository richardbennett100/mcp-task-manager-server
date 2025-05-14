// File: src/services/WorkItemReadingService.ts
import { WorkItemRepository, WorkItemData } from '../repositories/index.js';
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

  public async getWorkItemById(id: string, filter?: { isActive?: boolean }): Promise<FullWorkItemData | null> {
    logger.debug(`[WorkItemReadingService] Getting work item by ID: ${id} with filter:`, filter);
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

  public async listWorkItems(filter: ListWorkItemsFilter): Promise<WorkItemData[]> {
    logger.debug(`[WorkItemReadingService] Listing work items with filter:`, filter);
    try {
      const isActiveFilter = filter.isActive === false ? false : filter.isActive === undefined ? undefined : true;
      const parentId = filter.parent_work_item_id === undefined ? undefined : (filter.parent_work_item_id ?? null);
      const statusFilter = filter.status;

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
        items = await this.workItemRepository.findAll(repoFilter);
      }
      logger.info(`[WorkItemReadingService] Listed ${items.length} items.`);
      return items;
    } catch (error: unknown) {
      logger.error(`[WorkItemReadingService] Error listing work items:`, error);
      throw error;
    }
  }

  public async getFullTree(rootWorkItemId: string, options?: GetFullTreeOptions): Promise<WorkItemTreeNode | null> {
    const includeInactiveItems = options?.include_inactive_items ?? false;
    const includeInactiveDependencies = options?.include_inactive_dependencies ?? false;
    const maxDepth = options?.max_depth ?? 10;

    // isPartOfLinkedBranch: Parameter to track if we are currently traversing a "linked" branch.
    // forceLinkedDisplay: Parameter to force children of an explicitly linked item to also show as linked.
    const getSubTree = async (
      itemId: string,
      currentDepth: number,
      forceLinkedDisplay: boolean
    ): Promise<WorkItemTreeNode | null> => {
      const itemFilter = { isActive: includeInactiveItems ? undefined : true };
      const item = await this.workItemRepository.findById(itemId, itemFilter);

      if (!item) {
        logger.warn(
          `[WorkItemReadingService] Item ${itemId} (forceLinkedDisplay: ${forceLinkedDisplay}) not found for tree (filter: ${JSON.stringify(itemFilter)}).`
        );
        return null;
      }

      const depFilterForCurrentItem = { isActive: includeInactiveDependencies ? undefined : true };
      const [itemDependencies, itemDependents] = await Promise.all([
        this.workItemRepository.findDependencies(itemId, depFilterForCurrentItem),
        this.workItemRepository.findDependents(itemId, depFilterForCurrentItem),
      ]);

      const itemName = forceLinkedDisplay ? `${item.name} (L)` : item.name;

      if (currentDepth > maxDepth) {
        logger.debug(
          `[WorkItemReadingService] Max depth ${maxDepth} reached for item ${itemId}. Returning item without expanding children.`
        );
        return {
          ...item,
          name: itemName,
          dependencies: itemDependencies,
          dependents: itemDependents,
          children: [],
        };
      }

      const childrenNodes: WorkItemTreeNode[] = [];

      // 1. Fetch and process direct children (not linked ones yet)
      // These children are displayed as "linked" if their parent (the current item) is being force-displayed as linked.
      const childrenFilter: ListWorkItemsFilter = { isActive: includeInactiveItems ? undefined : true };
      const directChildrenData = await this.workItemRepository.findChildren(itemId, childrenFilter);
      for (const childData of directChildrenData) {
        // If the current item is forced to display as linked, its direct children also are.
        const childNode = await getSubTree(childData.work_item_id, currentDepth + 1, forceLinkedDisplay);
        if (childNode) {
          childrenNodes.push(childNode);
        }
      }

      // 2. Fetch and process 'linked' dependencies (promoted items from this item)
      // These items become "linked branches" themselves.
      // This block should only execute if we are NOT already forcing linked display from a higher level.
      // This means we are at a node (e.g., MainProject) and looking for its direct promotions.
      if (!forceLinkedDisplay) {
        const linkedDependencyFilter = {
          isActive: includeInactiveDependencies ? undefined : true,
          dependency_type: 'linked' as const,
        };
        const linkedDependencies = await this.workItemRepository.findDependencies(itemId, linkedDependencyFilter);

        for (const linkedDep of linkedDependencies) {
          if (childrenNodes.some((cn) => cn.work_item_id === linkedDep.depends_on_work_item_id)) {
            logger.debug(
              `[WorkItemReadingService] Item ${linkedDep.depends_on_work_item_id} (linked to ${itemId}) is already in children list. Skipping duplicate add.`
            );
            continue;
          }
          // Fetch the linked item (which is a root project) and its subtree.
          // Mark this new branch as "linked" by passing `forceLinkedDisplay: true`.
          // Its children will also be marked.
          const linkedItemNode = await getSubTree(linkedDep.depends_on_work_item_id, currentDepth + 1, true);
          if (linkedItemNode) {
            childrenNodes.push(linkedItemNode);
          }
        }
      }

      childrenNodes.sort((a, b) => {
        if (a.order_key && b.order_key) {
          return String(a.order_key).localeCompare(String(b.order_key));
        }
        if (a.order_key) return -1;
        if (b.order_key) return 1;
        return a.name.localeCompare(b.name);
      });

      return {
        ...item,
        name: itemName,
        dependencies: itemDependencies,
        dependents: itemDependents,
        children: childrenNodes,
      };
    };

    logger.info(`[WorkItemReadingService] Fetching full tree for root ID: ${rootWorkItemId} with options:`, options);
    // Initial call, not part of a linked branch, so forceLinkedDisplay is false.
    const tree = await getSubTree(rootWorkItemId, 1, false);
    if (!tree) {
      throw new NotFoundError(
        `Root work item with ID ${rootWorkItemId} not found or does not meet active/inactive criteria.`
      );
    }
    return tree;
  }
}
