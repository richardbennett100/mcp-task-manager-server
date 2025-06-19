// src/tools/promote_to_project_tool.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  TOOL_NAME,
  TOOL_DESCRIPTION,
  PromoteToProjectParamsSchema,
  type PromoteToProjectArgs,
} from './promote_to_project_params.js';
import { logger } from '../utils/logger.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { DatabaseManager } from '../db/DatabaseManager.js';
import { WorkItemRepository, ActionHistoryRepository } from '../repositories/index.js';
import { WorkItemService } from '../services/WorkItemService.js';
import { type FullWorkItemData } from '../services/WorkItemServiceTypes.js';
// import sseNotificationService from '../services/SseNotificationService.js';

export const promoteToProjectTool = (server: McpServer): void => {
  const processRequest = async (args: PromoteToProjectArgs): Promise<{ content: { type: 'text'; text: string }[] }> => {
    logger.info(`[${TOOL_NAME}] Received request to promote work_item_id ${args.work_item_id} to a project.`);

    try {
      const dbManager = await DatabaseManager.getInstance();
      const pool = dbManager.getPool();
      const workItemRepository = new WorkItemRepository(pool);
      const actionHistoryRepository = new ActionHistoryRepository(pool);
      const workItemService = new WorkItemService(workItemRepository, actionHistoryRepository); //, sseNotificationService);

      // Call the new service method (to be created)
      const updatedItem: FullWorkItemData = await workItemService.promoteToProject(args.work_item_id);

      logger.info(`[${TOOL_NAME}] Successfully promoted work item ${args.work_item_id} to a project.`);
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

  server.tool(TOOL_NAME, TOOL_DESCRIPTION, PromoteToProjectParamsSchema.shape, processRequest);
};
