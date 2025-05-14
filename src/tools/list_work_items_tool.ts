// src/tools/list_work_items_tool.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAME, TOOL_DESCRIPTION, ListWorkItemsParamsSchema, ListWorkItemsArgs } from './list_work_items_params.js';
import { logger } from '../utils/logger.js';
import { DatabaseManager } from '../db/DatabaseManager.js';
import { WorkItemRepository, ActionHistoryRepository } from '../repositories/index.js';
import { WorkItemService } from '../services/WorkItemService.js';
import { ListWorkItemsFilter } from '../services/WorkItemServiceTypes.js';

export const listWorkItemsTool = (server: McpServer): void => {
  const processRequest = async (args: ListWorkItemsArgs): Promise<{ content: { type: 'text'; text: string }[] }> => {
    logger.info(`[${TOOL_NAME}] Received request:`, args);

    try {
      const dbManager = await DatabaseManager.getInstance();
      const pool = dbManager.getPool();
      const workItemRepository = new WorkItemRepository(pool);
      const actionHistoryRepository = new ActionHistoryRepository(pool);
      const workItemService = new WorkItemService(workItemRepository, actionHistoryRepository);

      // Prepare the filter for the service call
      // The service method ListWorkItemsFilter has isActive as optional.
      // If args.is_active is undefined, it will be passed as undefined to the service,
      // and the service's internal logic for defaulting isActive will apply.
      const filter: ListWorkItemsFilter = {
        parent_work_item_id: args.parent_work_item_id, // Will be string | null | undefined
        rootsOnly: args.roots_only, // Will be boolean | undefined
        status: args.status, // Will be 'todo' | ... | undefined
        isActive: args.is_active, // Will be boolean | undefined
      };

      // Remove undefined properties from filter so service defaults apply correctly
      // if a key is not present, vs. present with value undefined.
      // However, ListWorkItemsFilter explicitly allows undefined for optional fields.
      // The service logic handles undefined correctly.

      const workItems = await workItemService.listWorkItems(filter);

      logger.info(`[${TOOL_NAME}] Successfully retrieved ${workItems.length} work items.`);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(workItems),
          },
        ],
      };
    } catch (error: unknown) {
      logger.error(`[${TOOL_NAME}] Error processing request:`, error);
      if (error instanceof McpError) throw error;

      const message = error instanceof Error ? error.message : 'An unknown error occurred while listing work items.';
      throw new McpError(ErrorCode.InternalError, message);
    }
  };

  server.tool(TOOL_NAME, TOOL_DESCRIPTION, ListWorkItemsParamsSchema.shape, processRequest);
};
