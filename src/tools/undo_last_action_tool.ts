// src/tools/undo_last_action_tool.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
// Remove unused Args import
import { TOOL_NAME, TOOL_DESCRIPTION, UndoLastActionParamsSchema } from './undo_last_action_params.js';
import { logger } from '../utils/logger.js';
import { DatabaseManager } from '../db/DatabaseManager.js';
import { WorkItemRepository, ActionHistoryRepository, ActionHistoryData } from '../repositories/index.js';
import { WorkItemService } from '../services/WorkItemService.js';

export const undoLastActionTool = (server: McpServer): void => {
  // Remove unused _args parameter
  const processRequest = async (): Promise<{ content: { type: 'text'; text: string }[] }> => {
    logger.info(`[${TOOL_NAME}] Received request.`);

    try {
      const dbManager = await DatabaseManager.getInstance();
      const pool = dbManager.getPool();
      const workItemRepository = new WorkItemRepository(pool);
      const actionHistoryRepository = new ActionHistoryRepository(pool);
      const workItemService = new WorkItemService(workItemRepository, actionHistoryRepository);

      const undoneAction: ActionHistoryData | null = await workItemService.undoLastAction();

      if (undoneAction) {
        logger.info(`[${TOOL_NAME}] Successfully undid action ${undoneAction.action_id}.`);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(undoneAction) }],
        };
      } else {
        logger.info(`[${TOOL_NAME}] No action found to undo.`);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ success: false, message: 'No action to undo.' }) }],
        };
      }
    } catch (error: unknown) {
      logger.error(`[${TOOL_NAME}] Error processing request:`, error);
      // Assuming generic errors are internal for now
      const message = error instanceof Error ? error.message : 'An unknown error occurred during undo.';
      throw new McpError(ErrorCode.InternalError, message);
    }
  };
  // Register the tool handler
  server.tool(TOOL_NAME, TOOL_DESCRIPTION, UndoLastActionParamsSchema.shape, processRequest);
};
