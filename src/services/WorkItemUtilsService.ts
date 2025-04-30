// src/services/WorkItemUtilsService.ts
import { PoolClient } from 'pg';
import { WorkItemRepository } from '../repositories/WorkItemRepository.js';
import { logger } from '../utils/logger.js';

/**
 * Utility service with helper methods for work item operations
 */
export class WorkItemUtilsService {
  /**
   * Calculates a shortname for a work item based on its name and parent context
   */
  public async calculateShortname(
    name: string,
    parentId: string | null,
    currentItemId: string | undefined,
    client: PoolClient,
    workItemRepository: WorkItemRepository
  ): Promise<string | null> {
    logger.warn('[WorkItemUtilsService] calculateShortname needs implementation!');
    // TODO: Implement shortname calculation logic here
    // This might involve checking siblings' shortnames for uniqueness within the parent context
    // and generating a short, unique identifier based on the name.
    // For now, returning null as a placeholder.
    return null;
  }

  /**
   * Calculates an order key for positioning a work item among its siblings
   */
  public async calculateOrderKey(
    parentId: string | null,
    beforeItemId: string | null,
    client: PoolClient,
    workItemRepository: WorkItemRepository
  ): Promise<string | null> {
    logger.warn('[WorkItemUtilsService] calculateOrderKey needs implementation!');
    // TODO: Implement order key calculation logic here
    // This typically involves fetching adjacent sibling order keys and generating a new one
    // that fits lexicographically between them.
    // The WorkItemRepository has a getAdjacentOrderKeys method that is a placeholder.
    // You'll need to implement that repository method and use it here.
    // For now, returning null as a placeholder.
    return null;
  }
}
