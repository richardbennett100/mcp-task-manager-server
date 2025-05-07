// src/tools/add_dependencies_tool.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  TOOL_NAME,
  TOOL_DESCRIPTION,
  AddDependenciesParamsSchema,
  AddDependenciesArgs,
} from './add_dependencies_params.js';
import { logger } from '../utils/logger.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { DatabaseManager } from '../db/DatabaseManager.js';
import { WorkItemRepository, ActionHistoryRepository } from '../repositories/index.js';
import { WorkItemService } from '../services/WorkItemService.js';
import { FullWorkItemData } from '../services/WorkItemServiceTypes.js'; // Expecting updated item back

export const addDependenciesTool = (server: McpServer): void => {
  const processRequest = async (args: AddDependenciesArgs): Promise<{ content: { type: 'text'; text: string }[] }> => {
    logger.info(`[${TOOL_NAME}] Received request for work_item_id ${args.work_item_id}.`);

    try {
      const dbManager = await DatabaseManager.getInstance();
      const pool = dbManager.getPool();
      const workItemRepository = new WorkItemRepository(pool);
      const actionHistoryRepository = new ActionHistoryRepository(pool);
      const workItemService = new WorkItemService(workItemRepository, actionHistoryRepository);

      // Call the new service method
      const updatedItem: FullWorkItemData = await workItemService.addDependencies(
        args.work_item_id,
        args.dependencies_to_add
      );

      logger.info(`[${TOOL_NAME}] Successfully added/updated dependencies for work item ${args.work_item_id}.`);
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
  // Register the tool handler
  server.tool(TOOL_NAME, TOOL_DESCRIPTION, AddDependenciesParamsSchema.shape, processRequest);
};
