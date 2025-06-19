// src/tools/delete_dependencies_tool.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  TOOL_NAME,
  TOOL_DESCRIPTION,
  DeleteDependenciesParamsSchema,
  DeleteDependenciesArgs,
} from './delete_dependencies_params.js';
import { logger } from '../utils/logger.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { DatabaseManager } from '../db/DatabaseManager.js';
import { WorkItemRepository, ActionHistoryRepository } from '../repositories/index.js';
import { WorkItemService } from '../services/WorkItemService.js';
import { FullWorkItemData } from '../services/WorkItemServiceTypes.js';
// import sseNotificationService from '../services/SseNotificationService.js';

export const deleteDependenciesTool = (server: McpServer): void => {
  const processRequest = async (
    args: DeleteDependenciesArgs
  ): Promise<{ content: { type: 'text'; text: string }[] }> => {
    logger.info(`[${TOOL_NAME}] Received request for work_item_id ${args.work_item_id}.`);

    try {
      const dbManager = await DatabaseManager.getInstance();
      const pool = dbManager.getPool();
      const workItemRepository = new WorkItemRepository(pool);
      const actionHistoryRepository = new ActionHistoryRepository(pool);
      const workItemService = new WorkItemService(workItemRepository, actionHistoryRepository); //); //, sseNotificationService);

      // Call the new service method
      const updatedItem: FullWorkItemData = await workItemService.deleteDependencies(
        args.work_item_id,
        args.depends_on_ids_to_remove
      );

      // The service returns the full item data which might implicitly confirm success.
      // We could adjust the service to return a count if preferred.
      logger.info(`[${TOOL_NAME}] Successfully processed dependency removal for work item ${args.work_item_id}.`);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(updatedItem) }],
      };
    } catch (error: unknown) {
      logger.error(`[${TOOL_NAME}] Error processing request for work item ${args.work_item_id}:`, error);
      if (error instanceof ValidationError || error instanceof NotFoundError) {
        // NotFoundError could be thrown if the base work item doesn't exist
        // ValidationError could be thrown if trying to delete non-existent links
        throw new McpError(ErrorCode.InvalidParams, error.message);
      } else {
        const message = error instanceof Error ? error.message : 'An unknown error occurred';
        throw new McpError(ErrorCode.InternalError, message);
      }
    }
  };
  // Register the tool handler
  server.tool(TOOL_NAME, TOOL_DESCRIPTION, DeleteDependenciesParamsSchema.shape, processRequest);
};
