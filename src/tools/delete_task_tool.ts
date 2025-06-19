// src/tools/delete_task_tool.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'; // Ensure RequestHandlerExtra is NOT imported
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
// Update import path and constant name
import { TOOL_NAME, TOOL_DESCRIPTION, TOOL_PARAMS, DeleteTaskArgs } from './delete_task_params.js';
import { logger } from '../utils/logger.js';
import { NotFoundError } from '../utils/errors.js';
import { DatabaseManager } from '../db/DatabaseManager.js';
import { WorkItemRepository, ActionHistoryRepository } from '../repositories/index.js';
import { WorkItemService } from '../services/WorkItemService.js';
// import sseNotificationService from '../services/SseNotificationService.js';

// Update function name
export const deleteTaskTool = (server: McpServer): void => {
  const processRequest = async (args: DeleteTaskArgs): Promise<{ content: { type: 'text'; text: string }[] }> => {
    logger.info(`[${TOOL_NAME}] Received request to delete ${args.work_item_ids.length} work items.`); // TOOL_NAME is updated

    try {
      const dbManager = await DatabaseManager.getInstance();
      const pool = dbManager.getPool();
      const workItemRepository = new WorkItemRepository(pool);
      const actionHistoryRepository = new ActionHistoryRepository(pool);
      const workItemService = new WorkItemService(workItemRepository, actionHistoryRepository); //); //, sseNotificationService);

      const deletedCount = await workItemService.deleteWorkItem(args.work_item_ids);

      logger.info(`[${TOOL_NAME}] Successfully soft-deleted ${deletedCount} work items.`); // TOOL_NAME is updated
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ success: true, deleted_count: deletedCount }),
          },
        ],
      };
    } catch (error: unknown) {
      logger.error(`[${TOOL_NAME}] Error processing request:`, error); // TOOL_NAME is updated
      if (error instanceof NotFoundError) {
        throw new McpError(ErrorCode.InvalidParams, error.message);
      } else {
        const message = error instanceof Error ? error.message : 'An unknown error occurred';
        throw new McpError(ErrorCode.InternalError, message);
      }
    }
  };
  // Register the tool handler
  server.tool(TOOL_NAME, TOOL_DESCRIPTION, TOOL_PARAMS.shape, processRequest); // TOOL_NAME is updated
};
