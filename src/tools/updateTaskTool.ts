// src/tools/updateTaskTool.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  TOOL_NAME,
  TOOL_DESCRIPTION,
  UPDATE_TASK_BASE_SCHEMA,
  TOOL_PARAMS, // Refined schema
  UpdateTaskArgs,
} from './updateTaskParams.js';
import { logger } from '../utils/logger.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { DatabaseManager } from '../db/DatabaseManager.js';
import { WorkItemRepository, WorkItemDependencyData }
  from '../repositories/WorkItemRepository.js';
import { WorkItemService, UpdateWorkItemInput, FullWorkItemData }
  from '../services/WorkItemService.js';

/**
 * Registers the updateTask (now updateWorkItem conceptually) tool with the MCP server.
 * @param server - The McpServer instance.
 */
export const updateTaskTool = (server: McpServer): void => {
  const processRequest = async (
    args: UpdateTaskArgs
  ): Promise<{ content: { type: 'text'; text: string }[] }> => {
    // Clone args for safe logging modification
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const logArgs: Record<string, any> = { ...args };
    // FIX: Check if dependencies exists before accessing length
    if (args.dependencies) {
        logArgs.dependencies = `[${args.dependencies.length} items]`;
    }
    logger.info(`[${TOOL_NAME}] Received request with args:`, logArgs);

    try {
      // Instantiate dependencies inside the handler
      const dbManager = await DatabaseManager.getInstance();
      const pool = dbManager.getPool();
      const workItemRepository = new WorkItemRepository(pool);
      const workItemService = new WorkItemService(workItemRepository);

      // Construct the update payload for the service, including only provided fields
      const serviceUpdateInput: UpdateWorkItemInput = {};
      if (args.parent_work_item_id !== undefined) serviceUpdateInput.parent_work_item_id = args.parent_work_item_id;
      if (args.name !== undefined) serviceUpdateInput.name = args.name;
      if (args.description !== undefined) serviceUpdateInput.description = args.description;
      if (args.priority !== undefined) serviceUpdateInput.priority = args.priority;
      if (args.status !== undefined) serviceUpdateInput.status = args.status;
      if (args.due_date !== undefined) serviceUpdateInput.due_date = args.due_date;
      if (args.order_key !== undefined) serviceUpdateInput.order_key = args.order_key;
      if (args.shortname !== undefined) serviceUpdateInput.shortname = args.shortname;

      // Map dependencies structure if provided (pass undefined otherwise)
      const serviceDependenciesInput: Omit<WorkItemDependencyData, 'work_item_id'>[] | undefined =
         args.dependencies?.map((dep) => ({
             depends_on_work_item_id: dep.depends_on_work_item_id,
             dependency_type: dep.dependency_type,
         }));

      // Call the new service method
      const updatedWorkItem = await workItemService.updateWorkItem(
        args.work_item_id,
        serviceUpdateInput,
        serviceDependenciesInput // Pass dependencies separately
      );

      logger.info(
        `[${TOOL_NAME}] Successfully updated work item ${args.work_item_id}`
      );
      // Fetch the full updated item details using WorkItemService for the response
      const fullUpdatedItem = await workItemService.getWorkItemById(updatedWorkItem.work_item_id);
      if (!fullUpdatedItem) {
          throw new Error(`Failed to retrieve full details for updated item ${updatedWorkItem.work_item_id}`);
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(fullUpdatedItem) }],
      };
    } catch (error: unknown) {
      logger.error(`[${TOOL_NAME}] Error processing request:`, error);
      if (error instanceof ValidationError) {
        throw new McpError(ErrorCode.InvalidParams, error.message);
      } else if (error instanceof NotFoundError) {
        throw new McpError(ErrorCode.InvalidParams, error.message);
      } else {
        const message =
          error instanceof Error
            ? error.message
            : 'An unknown error occurred while updating the work item.';
        throw new McpError(ErrorCode.InternalError, message);
      }
    }
  };

  // Register using the base schema's shape
  server.tool(
    TOOL_NAME,
    TOOL_DESCRIPTION,
    UPDATE_TASK_BASE_SCHEMA.shape,
    processRequest
  );
};