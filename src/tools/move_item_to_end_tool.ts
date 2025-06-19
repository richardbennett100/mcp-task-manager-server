// src/tools/move_item_to_end_tool.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  TOOL_NAME,
  TOOL_DESCRIPTION,
  MoveItemToEndParamsSchema,
  MoveItemToEndArgs,
} from './move_item_to_end_params.js';
import { logger } from '../utils/logger.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { DatabaseManager } from '../db/DatabaseManager.js';
import { WorkItemRepository, ActionHistoryRepository } from '../repositories/index.js';
import { WorkItemService } from '../services/WorkItemService.js';
import { FullWorkItemData } from '../services/WorkItemServiceTypes.js';
// import sseNotificationService from '../services/SseNotificationService.js';

export const moveItemToEndTool = (server: McpServer): void => {
  const processRequest = async (args: MoveItemToEndArgs): Promise<{ content: { type: 'text'; text: string }[] }> => {
    logger.info(`[${TOOL_NAME}] Received request for work_item_id ${args.work_item_id}.`);

    try {
      const dbManager = await DatabaseManager.getInstance();
      const pool = dbManager.getPool();
      const workItemRepository = new WorkItemRepository(pool);
      const actionHistoryRepository = new ActionHistoryRepository(pool);
      const workItemService = new WorkItemService(workItemRepository, actionHistoryRepository); //, sseNotificationService);

      const updatedItem: FullWorkItemData = await workItemService.moveItemToEnd(args.work_item_id);

      logger.info(`[${TOOL_NAME}] Successfully moved work item ${args.work_item_id} to end.`);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(updatedItem) }],
      };
    } catch (error: unknown) {
      logger.error(`[${TOOL_NAME}] Error processing request for work item ${args.work_item_id}:`, error);
      if (error instanceof ValidationError || error instanceof NotFoundError) {
        throw new McpError(ErrorCode.InvalidParams, error.message);
      } else {
        const message = error instanceof Error ? error.message : 'An unknown error occurred';
        throw new McpError(ErrorCode.InternalError, message);
      }
    }
  };
  server.tool(TOOL_NAME, TOOL_DESCRIPTION, MoveItemToEndParamsSchema.shape, processRequest);
};
