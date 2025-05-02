// src/services/WorkItemUtilsService.ts
import { PoolClient } from 'pg';
import { WorkItemRepository } from '../repositories/WorkItemRepository.js';
import { logger } from '../utils/logger.js';
import { validate as uuidValidate } from 'uuid';

/**
 * Utility service with helper methods for work item operations
 */
export class WorkItemUtilsService {
  private workItemRepository: WorkItemRepository; // Keep repo instance for methods

  constructor(workItemRepository: WorkItemRepository) {
    this.workItemRepository = workItemRepository; // Store the passed repository
  }

  /**
   * Calculates a shortname for a work item based on its name and parent context.
   * Basic uniqueness check added.
   */
  public async calculateShortname(
    name: string,
    parentId: string | null,
    currentItemId: string | undefined, // Can be undefined during creation
    client: PoolClient
    // workItemRepository: WorkItemRepository // Removed, use this.workItemRepository
  ): Promise<string | null> {
    logger.debug(
      `[WorkItemUtilsService] Calculating shortname for name: "${name}", parentId: ${parentId}, currentItemId: ${currentItemId}`
    );
    // Basic placeholder: Convert name to lowercase, replace spaces, add basic uniqueness check
    let baseShortname = name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .substring(0, 50); // Limit length
    if (!baseShortname) {
      baseShortname = 'item'; // Default if name results in empty shortname
    }

    // --- Basic Uniqueness Check (Needs Improvement) ---
    let uniqueShortname = baseShortname;
    let counter = 1;
    let isUnique = false;
    const MAX_ATTEMPTS = 100; // Prevent infinite loops

    while (!isUnique && counter < MAX_ATTEMPTS) {
      let siblings: Awaited<ReturnType<typeof this.workItemRepository.findSiblings>> = [];
      // FIX: Determine context for uniqueness check (root vs child)
      if (parentId === null) {
        // Check against other root items
        const roots = await this.workItemRepository.findRoots({ isActive: false }, client); // Check active and inactive roots
        // Exclude self if updating a root item
        siblings = currentItemId ? roots.filter((r) => r.work_item_id !== currentItemId) : roots;
      } else if (uuidValidate(parentId)) {
        // Check against siblings under the same parent
        if (currentItemId && uuidValidate(currentItemId)) {
          // Fetch siblings excluding the current item (for updates)
          siblings = await this.workItemRepository.findSiblings(currentItemId, parentId, { isActive: false }, client); // Check active and inactive
        } else {
          // Fetch all children of the parent (for creation)
          siblings = await this.workItemRepository.findChildren(
            parentId,
            {
              isActive: false,
            },
            client
          );
        }
      } else {
        logger.warn(
          `[WorkItemUtilsService] calculateShortname called with invalid parentId: ${parentId} when not null.`
        );
        // Decide handling: return null, throw error, or attempt root check? Let's fallback to root check for now.
        const roots = await this.workItemRepository.findRoots({ isActive: false }, client);
        siblings = currentItemId ? roots.filter((r) => r.work_item_id !== currentItemId) : roots;
      }

      const existingShortnames = siblings.map((s) => s.shortname).filter(Boolean); // Get existing shortnames

      if (!existingShortnames.includes(uniqueShortname)) {
        isUnique = true;
      } else {
        uniqueShortname = `${baseShortname}-${counter}`;
        counter++;
      }
    }

    if (!isUnique) {
      logger.warn(
        `[WorkItemUtilsService] Could not generate a unique shortname for "${name}" after ${counter} attempts. Falling back to null.`
      );
      return null; // Fallback or throw error if uniqueness is critical
    }

    logger.info(`[WorkItemUtilsService] Generated shortname: ${uniqueShortname}`);
    return uniqueShortname;
  }

  /**
   * Calculates an order key for positioning a work item among its siblings.
   * Placeholder implementation - Needs real logic (e.g., LexoRank or similar).
   */
  public async calculateOrderKey(
    parentId: string | null,
    beforeItemId: string | null // ID of item to place *after*
  ): Promise<string | null> {
    logger.debug(`[WorkItemUtilsService] Calculating order key for parentId: ${parentId}, after item: ${beforeItemId}`);
    // TODO: Implement robust order key generation (e.g., using LexoRank concept)
    const newOrderKey = Date.now().toString();
    logger.warn('[WorkItemUtilsService] Using placeholder order key generation: ' + newOrderKey);
    return newOrderKey; // Needs actual implementation
  }
}
