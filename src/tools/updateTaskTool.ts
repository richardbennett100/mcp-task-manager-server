// src/tools/updateTaskTool.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAME, TOOL_DESCRIPTION, UPDATE_TASK_BASE_SCHEMA, UpdateTaskArgs } from './updateTaskParams.js';
import { logger } from '../utils/logger.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { DatabaseManager } from '../db/DatabaseManager.js'; // Import DatabaseManager directly
import { WorkItemRepository, ActionHistoryRepository } from '../repositories/index.js';
import { WorkItemService } from '../services/WorkItemService.js';
import { UpdateWorkItemInput } from '../services/WorkItemServiceTypes.js';

export const updateTaskTool = (server: McpServer): void => {
  // Removed 'extra' parameter
  const processRequest = async (args: UpdateTaskArgs): Promise<{ content: { type: 'text'; text: string }[] }> => {
    // Simplified logging - no 'extra'
    const logArgs: Partial<UpdateTaskArgs> = { ...args };
    if (args.dependencies) {
      logArgs.dependencies = `[${args.dependencies.length} items]` as any; // Type assertion for logging only
    }
    logger.info(`[${TOOL_NAME}] Received request with args:`, logArgs);

    try {
      const dbManager = await DatabaseManager.getInstance();
      const pool = dbManager.getPool();
      const workItemRepository = new WorkItemRepository(pool);
      const actionHistoryRepository = new ActionHistoryRepository(pool);
      const workItemService = new WorkItemService(workItemRepository, actionHistoryRepository);

      const serviceUpdateInput: UpdateWorkItemInput = {
        parent_work_item_id: args.parent_work_item_id,
        name: args.name,
        description: args.description,
        priority: args.priority,
        status: args.status,
        due_date: args.due_date,
        order_key: args.order_key,
        shortname: args.shortname,
        // userId removed previously
      };
      Object.keys(serviceUpdateInput).forEach(
        (key) =>
          serviceUpdateInput[key as keyof UpdateWorkItemInput] === undefined &&
          delete serviceUpdateInput[key as keyof UpdateWorkItemInput]
      );

      const serviceDependenciesInput = args.dependencies?.map((dep) => ({
        depends_on_work_item_id: dep.depends_on_work_item_id,
        dependency_type: dep.dependency_type,
      }));

      const fullUpdatedItem = await workItemService.updateWorkItem(
        args.work_item_id,
        serviceUpdateInput,
        serviceDependenciesInput
      );

      logger.info(`[${TOOL_NAME}] Successfully updated work item ${args.work_item_id}`);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(fullUpdatedItem) }],
      };
    } catch (error: unknown) {
      logger.error(`[${TOOL_NAME}] Error processing request:`, error);
      if (error instanceof ValidationError || error instanceof NotFoundError) {
        throw new McpError(ErrorCode.InvalidParams, error.message);
      } else {
        const message = error instanceof Error ? error.message : 'An unknown error occurred';
        throw new McpError(ErrorCode.InternalError, message);
      }
    }
  };
  // Register the tool handler
  server.tool(TOOL_NAME, TOOL_DESCRIPTION, UPDATE_TASK_BASE_SCHEMA.shape, processRequest);
};
