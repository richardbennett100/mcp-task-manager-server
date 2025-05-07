// src/tools/update_task_tool.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
// Update import path and constant name
import { TOOL_NAME, TOOL_DESCRIPTION, UPDATE_TASK_BASE_SCHEMA, UpdateTaskArgs } from './update_task_params.js';
import { logger } from '../utils/logger.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { DatabaseManager } from '../db/DatabaseManager.js';
import { WorkItemRepository, ActionHistoryRepository } from '../repositories/index.js';
import { WorkItemService } from '../services/WorkItemService.js';
// Import the UPDATED service input type
import { UpdateWorkItemInput, FullWorkItemData } from '../services/WorkItemServiceTypes.js';

// Update function name
export const updateTaskTool = (server: McpServer): void => {
  const processRequest = async (args: UpdateTaskArgs): Promise<{ content: { type: 'text'; text: string }[] }> => {
    // Log relevant args
    const logArgs: Partial<UpdateTaskArgs> = { ...args };
    if (args.dependencies) {
      logArgs.dependencies = `[${args.dependencies.length} items]` as any;
    }
    logger.info(`[${TOOL_NAME}] Received request with args:`, logArgs); // Logs move params if present, TOOL_NAME updated

    try {
      const dbManager = await DatabaseManager.getInstance();
      const pool = dbManager.getPool();
      const workItemRepository = new WorkItemRepository(pool);
      const actionHistoryRepository = new ActionHistoryRepository(pool);
      const workItemService = new WorkItemService(workItemRepository, actionHistoryRepository);

      // Map tool arguments (UpdateTaskArgs) to service input (UpdateWorkItemInput)
      // This now includes the optional positioning parameters directly
      const serviceUpdateInput: UpdateWorkItemInput = {
        parent_work_item_id: args.parent_work_item_id,
        name: args.name,
        description: args.description,
        priority: args.priority,
        status: args.status,
        due_date: args.due_date,
        // Pass positioning parameters through
        moveTo: args.moveTo,
        moveAfter_work_item_id: args.moveAfter_work_item_id,
        moveBefore_work_item_id: args.moveBefore_work_item_id,
      };

      // Clean undefined properties from the CORE updates (positioning params are handled distinctly)
      Object.keys(serviceUpdateInput).forEach((key) => {
        // Skip cleaning positioning params, service needs to see if they are undefined or not
        if (key === 'moveTo' || key === 'moveAfter_work_item_id' || key === 'moveBefore_work_item_id') return;

        if (serviceUpdateInput[key as keyof UpdateWorkItemInput] === undefined) {
          delete serviceUpdateInput[key as keyof UpdateWorkItemInput];
        }
      });

      // Map dependencies input separately
      const serviceDependenciesInput = args.dependencies?.map((dep) => ({
        depends_on_work_item_id: dep.depends_on_work_item_id,
        dependency_type: dep.dependency_type,
      }));

      // Call the service method
      const fullUpdatedItem: FullWorkItemData = await workItemService.updateWorkItem(
        args.work_item_id,
        serviceUpdateInput, // Contains core updates + positioning params
        serviceDependenciesInput
      );

      logger.info(`[${TOOL_NAME}] Successfully updated work item ${args.work_item_id}`); // TOOL_NAME updated
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(fullUpdatedItem) }],
      };
    } catch (error: unknown) {
      logger.error(`[${TOOL_NAME}] Error processing request:`, error); // TOOL_NAME updated
      if (error instanceof ValidationError || error instanceof NotFoundError) {
        throw new McpError(ErrorCode.InvalidParams, error.message);
      } else {
        const message = error instanceof Error ? error.message : 'An unknown error occurred';
        throw new McpError(ErrorCode.InternalError, message);
      }
    }
  };

  // Register using the BASE schema shape (unchanged)
  server.tool(TOOL_NAME, TOOL_DESCRIPTION, UPDATE_TASK_BASE_SCHEMA.shape, processRequest); // TOOL_NAME updated
};
