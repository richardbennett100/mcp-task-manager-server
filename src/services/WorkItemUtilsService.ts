// src/services/WorkItemUtilsService.ts
import { logger } from '../utils/logger.js';
// Removed unused uuidValidate and WorkItemRepository imports
// Removed incorrect self-import: import { WorkItemUtilsService } from '../../WorkItemUtilsService.js';

/**
 * Utility service with helper methods for work item operations
 */
export class WorkItemUtilsService {
  // Removed workItemRepository property and constructor argument as it's no longer needed

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
