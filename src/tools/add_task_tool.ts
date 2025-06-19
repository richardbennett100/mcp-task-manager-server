// Modified src/tools/add_task_tool.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAME, TOOL_DESCRIPTION, AddTaskBaseSchema, AddTaskArgs } from './add_task_params.js';
import { logger } from '../utils/logger.js';
import { DatabaseManager } from '../db/DatabaseManager.js';
import { WorkItemRepository, ActionHistoryRepository } from '../repositories/index.js'; // Not needed if service is passed
import { WorkItemService } from '../services/WorkItemService.js';
// import sseNotificationService from '../services/SseNotificationService.js'; // Not needed if service is passed

export const addTaskTool = (server: McpServer): void => {
  const processRequest = async (args: AddTaskArgs): Promise<{ content: { type: 'text'; text: string }[] }> => {
    logger.info(`[\${TOOL_NAME}] Received request:`, args);

    try {
      const dbManager = await DatabaseManager.getInstance();
      const pool = dbManager.getPool();
      const workItemRepository = new WorkItemRepository(pool);
      const actionHistoryRepository = new ActionHistoryRepository(pool);
      const workItemService = new WorkItemService(workItemRepository, actionHistoryRepository); //); //, sseNotificationService);
      const {
        parent_work_item_id,
        name,
        description,
        status,
        priority,
        due_date,
        //tags,
        dependencies,
        insertAt,
        insertAfter_work_item_id,
        insertBefore_work_item_id,
      } = args;

      const newWorkItem = await workItemService.addWorkItem({
        parent_work_item_id,
        name,
        description,
        status,
        priority,
        due_date,
        //tags,
        dependencies,
        insertAt,
        insertAfter_work_item_id,
        insertBefore_work_item_id,
      });

      logger.info(`[\${TOOL_NAME}] Successfully added task: \${newWorkItem.name} (ID: \${newWorkItem.work_item_id})`);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(newWorkItem) }],
      };
    } catch (error: unknown) {
      logger.error(`[\${TOOL_NAME}] Error processing request:`, error);
      if (error instanceof McpError) throw error;
      const message = error instanceof Error ? error.message : 'An unknown error occurred while adding the task.';
      throw new McpError(ErrorCode.InternalError, message);
    }
  };

  server.tool(TOOL_NAME, TOOL_DESCRIPTION, AddTaskBaseSchema.shape, processRequest);
};
