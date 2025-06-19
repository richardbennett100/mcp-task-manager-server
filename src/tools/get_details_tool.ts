// src/tools/get_details_tool.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAME, TOOL_DESCRIPTION, GetDetailsParamsSchema, GetDetailsArgs } from './get_details_params.js';
import { logger } from '../utils/logger.js';
import { DatabaseManager } from '../db/DatabaseManager.js';
import { WorkItemRepository, ActionHistoryRepository } from '../repositories/index.js';
import { WorkItemService } from '../services/WorkItemService.js';
// import sseNotificationService from '../services/SseNotificationService.js';

export const getDetailsTool = (server: McpServer): void => {
  const processRequest = async (args: GetDetailsArgs): Promise<{ content: { type: 'text'; text: string }[] }> => {
    logger.info(`[${TOOL_NAME}] Received request:`, args);

    try {
      const dbManager = await DatabaseManager.getInstance();
      const pool = dbManager.getPool();
      const workItemRepository = new WorkItemRepository(pool);
      const actionHistoryRepository = new ActionHistoryRepository(pool);
      const workItemService = new WorkItemService(workItemRepository, actionHistoryRepository); //); //, sseNotificationService);

      const workItemDetails = await workItemService.getWorkItemById(args.work_item_id);

      if (!workItemDetails) {
        // MODIFIED: Changed to ErrorCode.InvalidParams for a missing resource by ID
        throw new McpError(ErrorCode.InvalidParams, `Work item with ID ${args.work_item_id} not found.`);
      }

      logger.info(`[${TOOL_NAME}] Successfully retrieved details for work item ${args.work_item_id}.`);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(workItemDetails),
          },
        ],
      };
    } catch (error: unknown) {
      logger.error(`[${TOOL_NAME}] Error processing request:`, error);
      if (error instanceof McpError) throw error;

      const message =
        error instanceof Error ? error.message : 'An unknown error occurred while retrieving work item details.';
      // Check for specific service errors if needed
      // MODIFIED: Changed to ErrorCode.InvalidParams when mapping service's NotFoundError
      if (error && (error as any).name === 'NotFoundError') {
        // Service layer NotFoundError
        throw new McpError(ErrorCode.InvalidParams, message); // Map to McpError.InvalidParams
      }
      throw new McpError(ErrorCode.InternalError, message);
    }
  };

  server.tool(TOOL_NAME, TOOL_DESCRIPTION, GetDetailsParamsSchema.shape, processRequest);
};
