// src/tools/redo_last_action_tool.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
// Remove unused Args import
import { TOOL_NAME, TOOL_DESCRIPTION, RedoLastActionParamsSchema } from './redo_last_action_params.js';
import { logger } from '../utils/logger.js';
import { DatabaseManager } from '../db/DatabaseManager.js';
import { WorkItemRepository, ActionHistoryRepository, ActionHistoryData } from '../repositories/index.js';
import { WorkItemService } from '../services/WorkItemService.js';
// import sseNotificationService from '../services/SseNotificationService.js';

export const redoLastActionTool = (server: McpServer): void => {
  // Remove unused _args parameter
  const processRequest = async (): Promise<{ content: { type: 'text'; text: string }[] }> => {
    logger.info(`[${TOOL_NAME}] Received request.`);

    try {
      const dbManager = await DatabaseManager.getInstance();
      const pool = dbManager.getPool();
      const workItemRepository = new WorkItemRepository(pool);
      const actionHistoryRepository = new ActionHistoryRepository(pool);
      const workItemService = new WorkItemService(workItemRepository, actionHistoryRepository); //, sseNotificationService);

      const redoneAction: ActionHistoryData | null = await workItemService.redoLastUndo();

      if (redoneAction) {
        logger.info(`[${TOOL_NAME}] Successfully redid action ${redoneAction.action_id}.`);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(redoneAction) }],
        };
      } else {
        logger.info(`[${TOOL_NAME}] No action found to redo.`);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ success: false, message: 'No action to redo.' }) }],
        };
      }
    } catch (error: unknown) {
      logger.error(`[${TOOL_NAME}] Error processing request:`, error);
      // Assuming generic errors are internal for now
      const message = error instanceof Error ? error.message : 'An unknown error occurred during redo.';
      throw new McpError(ErrorCode.InternalError, message);
    }
  };
  // Register the tool handler
  server.tool(TOOL_NAME, TOOL_DESCRIPTION, RedoLastActionParamsSchema.shape, processRequest);
};
