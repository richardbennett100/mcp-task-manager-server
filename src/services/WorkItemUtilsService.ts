// src/services/WorkItemUtilsService.ts
import { logger } from '../utils/logger.js';
import { validate as uuidValidate } from 'uuid';
import { WorkItemRepository } from '../repositories/WorkItemRepository.js';

/**
 * Utility service with helper methods for work item operations
 */
export class WorkItemUtilsService {
  private workItemRepository: WorkItemRepository;

  constructor(workItemRepository: WorkItemRepository) {
    this.workItemRepository = workItemRepository;
  }

  public async calculateShortname(
    name: string,
    parentId: string | null,
    currentItemId: string | undefined
  ): Promise<string | null> {
    // --- Existing calculateShortname logic ---
    // (Code omitted for brevity - remains unchanged)
    // ...
    logger.debug(
      `[WorkItemUtilsService] Calculating shortname for name: "${name}", parentId: ${parentId}, currentItemId: ${currentItemId}`
    );
    let baseShortname = name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .substring(0, 50); // Limit length
    if (!baseShortname) {
      baseShortname = 'item'; // Default if name results in empty shortname
    }

    let uniqueShortname = baseShortname;
    let counter = 1;
    let isUnique = false;
    const MAX_ATTEMPTS = 100; // Prevent infinite loops

    while (!isUnique && counter < MAX_ATTEMPTS) {
      let siblings: Awaited<ReturnType<typeof this.workItemRepository.findSiblings>> = [];
      if (parentId === null) {
        const roots = await this.workItemRepository.findRoots({ isActive: false });
        siblings = currentItemId ? roots.filter((r) => r.work_item_id !== currentItemId) : roots;
      } else if (uuidValidate(parentId)) {
        if (currentItemId && uuidValidate(currentItemId)) {
          siblings = await this.workItemRepository.findSiblings(currentItemId, parentId, { isActive: false });
        } else {
          siblings = await this.workItemRepository.findChildren(parentId, {
            isActive: false,
          });
        }
      } else {
        logger.warn(
          `[WorkItemUtilsService] calculateShortname called with invalid parentId: ${parentId} when not null.`
        );
        const roots = await this.workItemRepository.findRoots({ isActive: false });
        siblings = currentItemId ? roots.filter((r) => r.work_item_id !== currentItemId) : roots;
      }

      const existingShortnames = siblings.map((s) => s.shortname).filter(Boolean);

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
      return null;
    }

    logger.info(`[WorkItemUtilsService] Generated shortname: ${uniqueShortname}`);
    return uniqueShortname;
    // --- End existing calculateShortname logic ---
  }

  public calculateOrderKey(keyBefore: string | null | undefined, keyAfter: string | null | undefined): string | null {
    logger.debug(`[WorkItemUtilsService] Calculating numeric order key. Before: "${keyBefore}", After: "${keyAfter}"`);

    const numBefore = keyBefore ? Number(keyBefore) : null;
    const numAfter = keyAfter ? Number(keyAfter) : null;

    // Validate conversions - return null if invalid format
    if (keyBefore && (numBefore === null || isNaN(numBefore))) {
      logger.error(`[WorkItemUtilsService] Invalid numeric format for keyBefore: "${keyBefore}"`);
      return null;
    }
    if (keyAfter && (numAfter === null || isNaN(numAfter))) {
      logger.error(`[WorkItemUtilsService] Invalid numeric format for keyAfter: "${keyAfter}"`);
      return null;
    }

    let newKeyNum: number;

    if (numBefore !== null && numAfter !== null) {
      // --- Case 3: Insert Between ---
      // Always calculate the average, regardless of order or precision results
      newKeyNum = (numBefore + numAfter) / 2;
      logger.debug(`[WorkItemUtilsService] Calculated key between ${numBefore} and ${numAfter}: ${newKeyNum}`);
      // Removed checks for numBefore >= numAfter and average distinctness
    } else if (numBefore !== null && numAfter === null) {
      // --- Case 2: Insert at End ---
      newKeyNum = numBefore + 1;
      logger.debug(`[WorkItemUtilsService] Calculated key after ${numBefore}: ${newKeyNum}`);
    } else if (numBefore === null && numAfter !== null) {
      // --- Case 1: Insert at Start ---
      newKeyNum = numAfter - 1;
      logger.debug(`[WorkItemUtilsService] Calculated key before ${numAfter}: ${newKeyNum}`);
    } else {
      // --- Empty List Case ---
      newKeyNum = 1000; // Default starting point
      logger.debug(`[WorkItemUtilsService] Calculated key for first item in empty list: ${newKeyNum}`);
    }

    // Final validation: Still check if the *result* is finite (e.g., handles MAX_VALUE overflow)
    if (isNaN(newKeyNum) || !isFinite(newKeyNum)) {
      logger.error(`[WorkItemUtilsService] Calculation resulted in invalid number: ${newKeyNum}`);
      return null;
    }

    const newKeyStr = String(newKeyNum);
    logger.info(`[WorkItemUtilsService] Generated numeric order key: ${newKeyStr}`);
    return newKeyStr;
  }
}
