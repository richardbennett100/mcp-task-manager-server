// File: src/services/WorkItemUtilsService.ts
import { logger } from '../utils/logger.js';
// CRITICAL: Ensure NO OTHER IMPORT exists on line 2, especially any self-referential import
// like "import { WorkItemUtilsService } from '../../WorkItemUtilsService.js';"

/**
 * Utility service with helper methods for work item operations
 */
export class WorkItemUtilsService {
  // No constructor needed as methods are static

  public static calculateOrderKey(
    keyBefore: string | null | undefined,
    keyAfter: string | null | undefined
  ): string | null {
    logger.debug(`[WorkItemUtilsService] Calculating numeric order key. Before: "${keyBefore}", After: "${keyAfter}"`);

    const numBefore = keyBefore ? Number(keyBefore) : null;
    const numAfter = keyAfter ? Number(keyAfter) : null;

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
      newKeyNum = (numBefore + numAfter) / 2;
      logger.debug(`[WorkItemUtilsService] Calculated key between ${numBefore} and ${numAfter}: ${newKeyNum}`);
    } else if (numBefore !== null && numAfter === null) {
      newKeyNum = numBefore + 1;
      logger.debug(`[WorkItemUtilsService] Calculated key after ${numBefore}: ${newKeyNum}`);
    } else if (numBefore === null && numAfter !== null) {
      newKeyNum = numAfter - 1;
      logger.debug(`[WorkItemUtilsService] Calculated key before ${numAfter}: ${newKeyNum}`);
    } else {
      newKeyNum = 1000;
      logger.debug(`[WorkItemUtilsService] Calculated key for first item in empty list: ${newKeyNum}`);
    }

    if (isNaN(newKeyNum) || !isFinite(newKeyNum)) {
      logger.error(`[WorkItemUtilsService] Calculation resulted in invalid number: ${newKeyNum}`);
      return null;
    }

    const newKeyStr = String(newKeyNum);
    logger.info(`[WorkItemUtilsService] Generated numeric order key: ${newKeyStr}`);
    return newKeyStr;
  }
}
