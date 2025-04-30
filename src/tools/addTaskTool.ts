// src/tools/addTaskTool.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'; // Ensure RequestHandlerExtra is NOT imported
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  TOOL_NAME,
  TOOL_DESCRIPTION,
  TOOL_PARAMS,
  AddTaskArgs,
} from './addTaskParams.js';
import { logger } from '../utils/logger.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { DatabaseManager } from '../db/DatabaseManager.js';
import { WorkItemRepository, ActionHistoryRepository } from '../repositories/index.js';
import { WorkItemService } from '../services/WorkItemService.js';
import { AddWorkItemInput } from '../services/WorkItemServiceTypes.js';

export const addTaskTool = (server: McpServer): void => {
  // Keep 'extra: any' as the type is not exported
  const processRequest = async (args: AddTaskArgs, extra: any) => {
    const userId = extra?.userId ?? undefined;
    logger.info(`[${TOOL_NAME}] Received request with args:`, args);
    logger.debug(`[${TOOL_NAME}] Request extra:`, extra);

    try {
      const dbManager = await DatabaseManager.getInstance();
      const pool = dbManager.getPool();
      const workItemRepository = new WorkItemRepository(pool);
      const actionHistoryRepository = new ActionHistoryRepository(pool);
      const workItemService = new WorkItemService(workItemRepository, actionHistoryRepository);

      const serviceInput: AddWorkItemInput = {
        parent_work_item_id: args.parent_work_item_id,
        name: args.name,
        description: args.description,
        priority: args.priority,
        status: args.status,
        due_date: args.due_date,
        order_key: args.order_key,
        shortname: args.shortname,
        dependencies: args.dependencies?.map((dep) => ({
          depends_on_work_item_id: dep.depends_on_work_item_id,
          dependency_type: dep.dependency_type,
        })),
      };

      const newWorkItem = await workItemService.addWorkItem(serviceInput);

      logger.info(`[${TOOL_NAME}] Work item added successfully: ${newWorkItem.work_item_id}`);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(newWorkItem) }],
      };
    } catch (error: unknown) {
      logger.error(`[${TOOL_NAME}] Error processing request:`, error);
      if (error instanceof NotFoundError || error instanceof ValidationError) {
        throw new McpError(ErrorCode.InvalidParams, error.message);
      } else {
        const message = error instanceof Error ? error.message : 'An unknown error occurred';
        throw new McpError(ErrorCode.InternalError, message);
      }
    }
  };
  // Register the tool handler
  server.tool(TOOL_NAME, TOOL_DESCRIPTION, TOOL_PARAMS.shape, processRequest);
};
