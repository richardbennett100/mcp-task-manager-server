// src/tools/delete_child_tasks_tool.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
// Import only what's needed: Args type and the Shape for registration
import {
  TOOL_NAME,
  TOOL_DESCRIPTION,
  DeleteChildTasksArgs, // Used for args type
  DeleteChildTasksParamsSchemaShape, // Used for server.tool registration
} from './delete_child_tasks_params.js';
import { logger } from '../utils/logger.js';
import { DatabaseManager } from '../db/DatabaseManager.js';
import { WorkItemRepository, ActionHistoryRepository } from '../repositories/index.js';
import { WorkItemService } from '../services/WorkItemService.js';

export const deleteChildTasksTool = (server: McpServer): void => {
  const processRequest = async (args: DeleteChildTasksArgs): Promise<{ content: { type: 'text'; text: string }[] }> => {
    // args is already validated by the MCP SDK against the schema shape provided to server.tool()
    logger.info(`[${TOOL_NAME}] Received request:`, args);

    try {
      const dbManager = await DatabaseManager.getInstance();
      const pool = dbManager.getPool();
      const workItemRepository = new WorkItemRepository(pool);
      const actionHistoryRepository = new ActionHistoryRepository(pool);
      const workItemService = new WorkItemService(workItemRepository, actionHistoryRepository);

      let deletedCount = 0;
      let message = '';

      const parentItem = await workItemService.getWorkItemById(args.parent_work_item_id);
      if (!parentItem) {
        throw new McpError(ErrorCode.InvalidParams, `Parent work item with ID ${args.parent_work_item_id} not found.`);
      }
      logger.info(`[${TOOL_NAME}] Parent item ${args.parent_work_item_id} validated.`);

      if (args.delete_all_children) {
        logger.info(
          `[${TOOL_NAME}] Placeholder: Would query all children of ${args.parent_work_item_id} using workItemService.listWorkItems and then delete them.`
        );
        deletedCount = 3; // Example simulation
        message = `Placeholder: Successfully deleted all ${deletedCount} child tasks for parent ${args.parent_work_item_id}.`;
      } else if (args.child_task_ids && args.child_task_ids.length > 0) {
        // .refine in schema ensures one of these conditions is met
        for (const taskId of args.child_task_ids) {
          logger.info(
            `[${TOOL_NAME}] Placeholder: Would delete child task ${taskId} (verifying it is a child of ${args.parent_work_item_id}) using workItemService.deleteWorkItem.`
          );
          deletedCount++;
        }
        message = `Placeholder: Successfully deleted ${deletedCount} specified child tasks for parent ${args.parent_work_item_id}.`;
      }
      // No explicit 'else' throwing an error here is needed because the Zod schema's .refine()
      // in DeleteChildTasksParamsSchema should prevent invalid combinations from reaching this point.
      // The MCP SDK should ideally reject the request before processRequest is called if refine fails.

      logger.info(`[${TOOL_NAME}] ${message}`);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ message, deleted_count: deletedCount }) }],
      };
    } catch (error: unknown) {
      logger.error(`[${TOOL_NAME}] Error processing request:`, error);
      if (error instanceof McpError) throw error;
      const errMsg = error instanceof Error ? error.message : 'An unknown error occurred while deleting child tasks.';
      throw new McpError(ErrorCode.InternalError, errMsg);
    }
  };

  server.tool(TOOL_NAME, TOOL_DESCRIPTION, DeleteChildTasksParamsSchemaShape, processRequest);
};
