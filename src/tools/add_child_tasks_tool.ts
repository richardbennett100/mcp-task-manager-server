// src/tools/add_child_tasks_tool.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAME, TOOL_DESCRIPTION, AddChildTasksParamsSchema, AddChildTasksArgs } from './add_child_tasks_params.js';
import { logger } from '../utils/logger.js';
import { DatabaseManager } from '../db/DatabaseManager.js';
import { WorkItemRepository, ActionHistoryRepository, WorkItemData } from '../repositories/index.js';
import { WorkItemService } from '../services/WorkItemService.js';
import { AddWorkItemInput } from '../services/WorkItemServiceTypes.js';
// REMOVED: import { WorkItemHistoryService } from '../services/WorkItemHistoryService.js';

export const addChildTasksTool = (server: McpServer): void => {
  const processRequest = async (args: AddChildTasksArgs): Promise<{ content: { type: 'text'; text: string }[] }> => {
    logger.info(`[${TOOL_NAME}] Received request:`, args);

    try {
      const dbManager = await DatabaseManager.getInstance();
      const pool = dbManager.getPool();
      const workItemRepository = new WorkItemRepository(pool);
      const actionHistoryRepository = new ActionHistoryRepository(pool);
      // REMOVED: Unused instantiation of historyService
      // const historyService = new WorkItemHistoryService(workItemRepository, actionHistoryRepository);
      const workItemService = new WorkItemService(workItemRepository, actionHistoryRepository);
      // Note: WorkItemAddingService is instantiated within WorkItemService and gets historyService passed.

      const createdTasks: WorkItemData[] = [];

      const parentItem = await workItemService.getWorkItemById(args.parent_work_item_id);
      if (!parentItem) {
        throw new McpError(ErrorCode.InvalidParams, `Parent work item with ID ${args.parent_work_item_id} not found.`);
      }
      if (!parentItem.is_active) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Parent work item with ID ${args.parent_work_item_id} is inactive.`
        );
      }
      logger.info(`[${TOOL_NAME}] Parent item ${args.parent_work_item_id} validated.`);

      for (const childTask of args.child_tasks) {
        const serviceInput: AddWorkItemInput = {
          parent_work_item_id: args.parent_work_item_id,
          name: childTask.name,
          description: childTask.description,
          status: childTask.status,
          priority: childTask.priority,
          due_date: childTask.due_date,
        };

        logger.info(`[${TOOL_NAME}] Creating child task with input:`, serviceInput);
        const newWorkItem = await workItemService.addWorkItem(serviceInput);
        createdTasks.push(newWorkItem);
      }

      logger.info(
        `[${TOOL_NAME}] Successfully created ${createdTasks.length} child tasks for parent ${args.parent_work_item_id}.`
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(createdTasks),
          },
        ],
      };
    } catch (error: unknown) {
      logger.error(`[${TOOL_NAME}] Error processing request:`, error);
      if (error instanceof McpError) throw error;

      const message = error instanceof Error ? error.message : 'An unknown error occurred while adding child tasks.';
      if (error && (error as any).name === 'ValidationError') {
        throw new McpError(ErrorCode.InvalidParams, `Validation error: ${message}`);
      }
      if (error && (error as any).name === 'NotFoundError') {
        throw new McpError(ErrorCode.InvalidParams, `Resource not found error: ${message}`);
      }
      throw new McpError(ErrorCode.InternalError, message);
    }
  };

  server.tool(TOOL_NAME, TOOL_DESCRIPTION, AddChildTasksParamsSchema.shape, processRequest);
};
