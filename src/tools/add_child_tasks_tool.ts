// Modified upload/src/tools/add_child_tasks_tool.ts
// Changes:
// 1. Line 24: Corrected WorkItemService instantiation to use 2 arguments.
// 2. Line 33: Ensured it calls workItemService.addWorkItemTree (which now exists).
// src/tools/add_child_tasks_tool.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAME, TOOL_DESCRIPTION, AddChildTasksParamsSchema, AddChildTasksArgs } from './add_child_tasks_params.js';
import { logger } from '../utils/logger.js';
import { DatabaseManager } from '../db/DatabaseManager.js';
import { WorkItemRepository, ActionHistoryRepository } from '../repositories/index.js';
import { WorkItemService } from '../services/WorkItemService.js';
// import sseNotificationService from '../services/SseNotificationService.js';
// WorkItemHistoryService is not directly instantiated here anymore.

export const addChildTasksTool = (server: McpServer): void => {
  const processRequest = async (args: AddChildTasksArgs): Promise<{ content: { type: 'text'; text: string }[] }> => {
    logger.info(`[${TOOL_NAME}] Received request:`, args);

    try {
      const dbManager = await DatabaseManager.getInstance();
      const pool = dbManager.getPool();
      const workItemRepository = new WorkItemRepository(pool);
      const actionHistoryRepository = new ActionHistoryRepository(pool);
      // Corrected: WorkItemService constructor takes 2 arguments
      const workItemService = new WorkItemService(workItemRepository, actionHistoryRepository); //); //, sseNotificationService);

      const parentItem = await workItemService.getWorkItemById(args.parent_work_item_id);
      if (!parentItem) {
        throw new McpError(ErrorCode.InvalidParams, `Parent work item with ID ${args.parent_work_item_id} not found.`);
      }
      logger.info(`[${TOOL_NAME}] Parent item ${args.parent_work_item_id} validated.`);

      logger.info(`[${TOOL_NAME}] Calling workItemService.addWorkItemTree for parent: ${args.parent_work_item_id}`);
      // This call should now work as addWorkItemTree is added to WorkItemService
      const createdTasksResults = await workItemService.addWorkItemTree(
        args.parent_work_item_id,
        args.child_tasks_tree
      );

      const responseText = `Successfully added ${createdTasksResults.length} tasks (including all descendants) to parent ${args.parent_work_item_id}.`;
      logger.info(`[${TOOL_NAME}] ${responseText}`);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(createdTasksResults) }],
      };
    } catch (error: unknown) {
      logger.error(`[${TOOL_NAME}] Error processing request:`, error);
      if (error instanceof McpError) throw error;
      const message = error instanceof Error ? error.message : 'An unknown error occurred while adding child tasks.';
      throw new McpError(ErrorCode.InternalError, message);
    }
  };

  server.tool(TOOL_NAME, TOOL_DESCRIPTION, AddChildTasksParamsSchema.shape, processRequest);
};
