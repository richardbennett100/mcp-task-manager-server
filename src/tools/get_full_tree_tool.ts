// src/tools/get_full_tree_tool.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'; // Using the JSON-RPC ErrorCode enum
import { TOOL_NAME, TOOL_DESCRIPTION, GetFullTreeParamsSchema, GetFullTreeArgs } from './get_full_tree_params.js';
import { logger } from '../utils/logger.js';
import { NotFoundError } from '../utils/errors.js'; // Our custom error
import { DatabaseManager } from '../db/DatabaseManager.js';
import { WorkItemRepository, ActionHistoryRepository } from '../repositories/index.js';
import { WorkItemService } from '../services/WorkItemService.js';
import { WorkItemTreeNode } from '../services/WorkItemServiceTypes.js';

export const getFullTreeTool = (server: McpServer): void => {
  const processRequest = async (args: GetFullTreeArgs): Promise<{ content: { type: 'text'; text: string }[] }> => {
    logger.info(`[${TOOL_NAME}] Received request for work_item_id ${args.work_item_id} with options:`, args.options);

    try {
      const dbManager = await DatabaseManager.getInstance();
      const pool = dbManager.getPool();
      const workItemRepository = new WorkItemRepository(pool);
      const actionHistoryRepository = new ActionHistoryRepository(pool);
      const workItemService = new WorkItemService(workItemRepository, actionHistoryRepository);

      const treeNode: WorkItemTreeNode | null = await workItemService.getFullTree(args.work_item_id, args.options);

      if (!treeNode) {
        // This custom NotFoundError will be caught and re-thrown as an McpError below
        throw new NotFoundError(
          `Work item with ID ${args.work_item_id} not found or does not match criteria for tree root.`
        );
      }

      logger.info(`[${TOOL_NAME}] Successfully retrieved tree for work item ${args.work_item_id}.`);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(treeNode) }],
      };
    } catch (error: unknown) {
      logger.error(`[${TOOL_NAME}] Error processing request for work item ${args.work_item_id}:`, error);
      if (error instanceof NotFoundError) {
        // Use ErrorCode.InvalidParams for "resource not found" scenarios with these error codes
        throw new McpError(ErrorCode.InvalidParams, error.message);
      } else {
        const message = error instanceof Error ? error.message : 'An unknown error occurred';
        throw new McpError(ErrorCode.InternalError, message);
      }
    }
  };
  server.tool(TOOL_NAME, TOOL_DESCRIPTION, GetFullTreeParamsSchema.shape, processRequest);
};
