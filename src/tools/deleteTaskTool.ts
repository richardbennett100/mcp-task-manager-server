// src/tools/deleteTaskTool.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'; // Ensure RequestHandlerExtra is NOT imported
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  TOOL_NAME,
  TOOL_DESCRIPTION,
  TOOL_PARAMS,
  DeleteTaskArgs,
} from './deleteTaskParams.js';
import { logger } from '../utils/logger.js';
import { NotFoundError } from '../utils/errors.js';
import { DatabaseManager } from '../db/DatabaseManager.js';
import { WorkItemRepository, ActionHistoryRepository } from '../repositories/index.js';
import { WorkItemService } from '../services/WorkItemService.js';

export const deleteTaskTool = (server: McpServer): void => {
  // Keep 'extra: any' as the type is not exported
  const processRequest = async (
    args: DeleteTaskArgs,
    extra: any
  ): Promise<{ content: { type: 'text'; text: string }[] }> => {
    const userId = extra?.userId ?? undefined;
    logger.info(`[${TOOL_NAME}] Received request to delete ${args.work_item_ids.length} work items.`);
    logger.debug(`[${TOOL_NAME}] Request extra:`, extra);

    try {
      const dbManager = await DatabaseManager.getInstance();
      const pool = dbManager.getPool();
      const workItemRepository = new WorkItemRepository(pool);
      const actionHistoryRepository = new ActionHistoryRepository(pool);
      const workItemService = new WorkItemService(workItemRepository, actionHistoryRepository);

      const deletedCount = await workItemService.deleteWorkItem(
        args.work_item_ids,
        userId
      );

      logger.info(`[${TOOL_NAME}] Successfully soft-deleted ${deletedCount} work items.`);
      return {
        content: [ { type: 'text' as const, text: JSON.stringify({ success: true, deleted_count: deletedCount }), }, ],
      };
    } catch (error: unknown) {
      logger.error(`[${TOOL_NAME}] Error processing request:`, error);
      if (error instanceof NotFoundError) {
        throw new McpError(ErrorCode.InvalidParams, error.message);
      } else {
        const message = error instanceof Error ? error.message : 'An unknown error occurred';
        throw new McpError(ErrorCode.InternalError, message);
      }
    }
  };
  // Register the tool handler
  server.tool(TOOL_NAME, TOOL_DESCRIPTION, TOOL_PARAMS.shape, processRequest);
};
