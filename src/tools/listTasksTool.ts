// src/tools/listTasksTool.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  TOOL_NAME,
  TOOL_DESCRIPTION,
  TOOL_PARAMS,
  ListTasksArgs, // Use updated args type
} from './listTasksParams.js'; // Use updated params file
import { logger } from '../utils/logger.js';
import { NotFoundError } from '../utils/errors.js'; // Keep for potential future use
// Import necessary components for instantiation inside the handler
import { DatabaseManager } from '../db/DatabaseManager.js';
import { WorkItemRepository } // Import NEW repository
  from '../repositories/WorkItemRepository.js';
import { WorkItemService, ListWorkItemsFilter } // Import NEW service and filter type
  from '../services/WorkItemService.js';

/**
 * Registers the listTasks (now listWorkItems conceptually) tool with the MCP server.
 * @param server - The McpServer instance.
 */
export const listTasksTool = (server: McpServer): void => {
  const processRequest = async (args: ListTasksArgs) => {
    logger.info(`[${TOOL_NAME}] Received request with args:`, args);
    try {
      // Instantiate dependencies inside the handler
      const dbManager = await DatabaseManager.getInstance();
      const pool = dbManager.getPool();
      const workItemRepository = new WorkItemRepository(pool);
      const workItemService = new WorkItemService(workItemRepository);

      // Construct the filter for the service
      const filter: ListWorkItemsFilter = {
        status: args.status,
        // Prioritize rootsOnly flag if true
        rootsOnly: args.rootsOnly ?? false,
        // Pass parentId only if rootsOnly is not true
        parent_work_item_id: (args.rootsOnly ?? false) ? undefined : args.parent_work_item_id,
      };

      // Call the new service method
      const workItems = await workItemService.listWorkItems(filter);

      logger.info(`[${TOOL_NAME}] Found ${workItems.length} work items.`);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(workItems) }],
      };
    } catch (error: unknown) {
      logger.error(`[${TOOL_NAME}] Error processing request:`, error);
      // Handle errors appropriately - NotFoundError might occur if parent ID validation is added
      if (error instanceof NotFoundError) {
        throw new McpError(ErrorCode.InvalidParams, error.message);
      } else {
        const message =
          error instanceof Error
            ? error.message
            : 'An unknown error occurred while listing work items.';
        throw new McpError(ErrorCode.InternalError, message);
      }
    }
  };

  // Register the tool with the updated Zod schema object's shape
  server.tool(TOOL_NAME, TOOL_DESCRIPTION, TOOL_PARAMS.shape, processRequest);

  // Log registration from index.ts
};