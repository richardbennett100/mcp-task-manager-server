// upload/src/tools/list_work_items_tool.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode, CallToolResult } from '@modelcontextprotocol/sdk/types.js'; // Corrected import
import { TOOL_NAME, TOOL_DESCRIPTION, ListWorkItemsParamsSchema, ListWorkItemsArgs } from './list_work_items_params.js';
import { logger } from '../utils/logger.js';
import { DatabaseManager } from '../db/DatabaseManager.js';
import { WorkItemRepository, ActionHistoryRepository, WorkItemData } from '../repositories/index.js';
import { WorkItemService } from '../services/WorkItemService.js';
import { ListWorkItemsFilter } from '../services/WorkItemServiceTypes.js';

export const listWorkItemsTool = (server: McpServer): void => {
  // The handler function for the tool
  // Corrected signature based on TypeScript error:
  // First parameter 'args' directly receives the parsed ListWorkItemsArgs.
  // Second parameter 'extra' is the context object (typed as 'any' since RequestHandlerExtra is not exported).
  const processRequest = async (args: ListWorkItemsArgs, extra: any): Promise<CallToolResult> => {
    logger.info(`[${TOOL_NAME}] Received request with validated args:`, args);
    if (extra && Object.keys(extra).length > 0) {
      logger.debug(`[${TOOL_NAME}] Received extra context:`, extra);
    }

    try {
      const dbManager = await DatabaseManager.getInstance();
      const pool = dbManager.getPool();
      const workItemRepository = new WorkItemRepository(pool);
      const actionHistoryRepository = new ActionHistoryRepository(pool);
      const workItemService = new WorkItemService(workItemRepository, actionHistoryRepository);

      const filter: ListWorkItemsFilter = {
        parent_work_item_id: args.parent_work_item_id,
        rootsOnly: args.roots_only,
        status: args.status,
        isActive: args.is_active,
      };

      const workItems: WorkItemData[] = await workItemService.listWorkItems(filter);

      logger.info(`[${TOOL_NAME}] Successfully retrieved ${workItems.length} work items.`);

      // Construct the CallToolResult compliant response.
      // The error "Type '"json"' is not assignable to type '"text" | "image" | "audio" | "resource"'"
      // means 'json' is not a valid literal for content[x].type.
      // We must use one of the allowed types, typically 'text' for stringified JSON.
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(workItems),
          },
        ],
        // isError: false, // This field is optional for success cases in CallToolResult
      };
    } catch (error: unknown) {
      logger.error(`[${TOOL_NAME}] Error processing request:`, error);
      if (error instanceof McpError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'An unknown error occurred while listing work items.';
      throw new McpError(ErrorCode.InternalError, message);
    }
  };

  server.tool(TOOL_NAME, TOOL_DESCRIPTION, ListWorkItemsParamsSchema.shape, processRequest);
};
