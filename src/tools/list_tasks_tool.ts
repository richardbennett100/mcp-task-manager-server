// src/tools/list_tasks_tool.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
// Update import path and constant name
import { TOOL_NAME, TOOL_DESCRIPTION, TOOL_PARAMS, ListTasksArgs } from './list_tasks_params.js';
import { logger } from '../utils/logger.js';
import { NotFoundError } from '../utils/errors.js';
// Import necessary components for instantiation inside the handler
import { DatabaseManager } from '../db/DatabaseManager.js';
import {
  WorkItemRepository,
  ActionHistoryRepository, // Import BOTH repositories
} from '../repositories/index.js'; // Use index export
import { WorkItemService } from '../services/WorkItemService.js';
import { ListWorkItemsFilter } from '../services/WorkItemServiceTypes.js';

/**
 * Registers the listTasks (now listWorkItems conceptually) tool with the MCP server.
 * @param server - The McpServer instance.
 */
// Update function name
export const listTasksTool = (server: McpServer): void => {
  const processRequest = async (args: ListTasksArgs) => {
    logger.info(`[${TOOL_NAME}] Received request with args:`, args); // TOOL_NAME updated
    try {
      // Instantiate dependencies inside the handler
      const dbManager = await DatabaseManager.getInstance();
      const pool = dbManager.getPool();
      const workItemRepository = new WorkItemRepository(pool);
      // FIX: Instantiate ActionHistoryRepository
      const actionHistoryRepository = new ActionHistoryRepository(pool);
      // FIX: Pass both repositories to WorkItemService constructor
      const workItemService = new WorkItemService(workItemRepository, actionHistoryRepository);

      // Construct the filter for the service
      const filter: ListWorkItemsFilter = {
        status: args.status,
        // Prioritize rootsOnly flag if true
        rootsOnly: args.rootsOnly ?? false,
        // Pass parentId only if rootsOnly is not true
        parent_work_item_id: (args.rootsOnly ?? false) ? undefined : args.parent_work_item_id,
        // Explicitly set isActive filter to true (default behavior) unless specified otherwise
        // Currently, the tool parameters don't expose an isActive filter, so we default to true.
        isActive: true,
      };

      // Call the new service method
      const workItems = await workItemService.listWorkItems(filter);

      logger.info(`[${TOOL_NAME}] Found ${workItems.length} work items.`); // TOOL_NAME updated
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(workItems) }],
      };
    } catch (error: unknown) {
      logger.error(`[${TOOL_NAME}] Error processing request:`, error); // TOOL_NAME updated
      if (error instanceof NotFoundError) {
        throw new McpError(ErrorCode.InvalidParams, error.message);
      } else {
        const message = error instanceof Error ? error.message : 'An unknown error occurred while listing work items.';
        throw new McpError(ErrorCode.InternalError, message);
      }
    }
  };

  // Register the tool with the updated Zod schema object's shape
  server.tool(TOOL_NAME, TOOL_DESCRIPTION, TOOL_PARAMS.shape, processRequest); // TOOL_NAME updated
};
