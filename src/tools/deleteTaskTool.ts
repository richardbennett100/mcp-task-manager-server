// src/tools/deleteTaskTool.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  TOOL_NAME,
  TOOL_DESCRIPTION,
  TOOL_PARAMS,
  DeleteTaskArgs, // Use updated args type
} from './deleteTaskParams.js'; // Use updated params file
import { logger } from '../utils/logger.js';
import { NotFoundError } from '../utils/errors.js'; // Keep for potential future use
// Import necessary components for instantiation inside the handler
import { DatabaseManager } from '../db/DatabaseManager.js';
import { WorkItemRepository } // Import NEW repository
  from '../repositories/WorkItemRepository.js';
import { WorkItemService } // Import NEW service
  from '../services/WorkItemService.js';

/**
 * Registers the deleteTask (now deleteWorkItem conceptually) tool with the MCP server.
 * @param server - The McpServer instance.
 */
export const deleteTaskTool = (server: McpServer): void => {
  const processRequest = async (
    args: DeleteTaskArgs
  ): Promise<{ content: { type: 'text'; text: string }[] }> => {
    logger.info(
      `[${TOOL_NAME}] Received request to delete ${args.work_item_ids.length} work items.`
    );
    try {
      // Instantiate dependencies inside the handler
      const dbManager = await DatabaseManager.getInstance();
      const pool = dbManager.getPool();
      const workItemRepository = new WorkItemRepository(pool);
      const workItemService = new WorkItemService(workItemRepository);

      // Call the new service method for soft delete
      const deletedCount = await workItemService.deleteWorkItem(
        args.work_item_ids
      );

      logger.info(
        `[${TOOL_NAME}] Successfully soft-deleted ${deletedCount} work items.`
      );
      // Return count of items marked as deleted
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ success: true, deleted_count: deletedCount }),
          },
        ],
      };
    } catch (error: unknown) {
      logger.error(`[${TOOL_NAME}] Error processing request:`, error);
      // NotFoundError could potentially be thrown by service if validation is added
      if (error instanceof NotFoundError) {
        throw new McpError(ErrorCode.InvalidParams, error.message);
      } else {
        const message =
          error instanceof Error
            ? error.message
            : 'An unknown error occurred while deleting work items.';
        throw new McpError(ErrorCode.InternalError, message);
      }
    }
  };

  // Register the tool with the updated Zod schema object's shape
  server.tool(TOOL_NAME, TOOL_DESCRIPTION, TOOL_PARAMS.shape, processRequest);

  // Log registration from index.ts
};