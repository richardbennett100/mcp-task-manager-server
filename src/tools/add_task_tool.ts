// src/tools/add_task_tool.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
// Import the BASE schema for registration, and the refined type for args
// Update import path and constant name
import { TOOL_NAME, TOOL_DESCRIPTION, AddTaskBaseSchema, AddTaskArgs } from './add_task_params.js';
import { logger } from '../utils/logger.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { DatabaseManager } from '../db/DatabaseManager.js';
import { WorkItemRepository, ActionHistoryRepository } from '../repositories/index.js';
import { WorkItemService } from '../services/WorkItemService.js';
// Import the service input type
import { AddWorkItemInput } from '../services/WorkItemServiceTypes.js';
import { WorkItemData } from '../repositories/index.js'; // Import return type

// Update function name
export const addTaskTool = (server: McpServer): void => {
  const processRequest = async (args: AddTaskArgs): Promise<{ content: { type: 'text'; text: string }[] }> => {
    logger.info(`[${TOOL_NAME}] Received request with args:`, args); // TOOL_NAME is updated

    try {
      const dbManager = await DatabaseManager.getInstance();
      const pool = dbManager.getPool();
      const workItemRepository = new WorkItemRepository(pool);
      const actionHistoryRepository = new ActionHistoryRepository(pool);
      const workItemService = new WorkItemService(workItemRepository, actionHistoryRepository);

      // Map tool arguments (AddTaskArgs) to service input (AddWorkItemInput)
      // Note: AddWorkItemInput should now match AddTaskArgs structure after previous fix.
      const serviceInput: AddWorkItemInput = {
        parent_work_item_id: args.parent_work_item_id,
        name: args.name,
        description: args.description,
        priority: args.priority,
        status: args.status,
        due_date: args.due_date,
        dependencies: args.dependencies?.map((dep) => ({
          depends_on_work_item_id: dep.depends_on_work_item_id,
          dependency_type: dep.dependency_type,
        })),
        // Include new positioning parameters
        insertAt: args.insertAt,
        insertAfter_work_item_id: args.insertAfter_work_item_id,
        insertBefore_work_item_id: args.insertBefore_work_item_id,
        // Removed order_key and shortname assignments
      };

      // Ensure undefined optional fields are not passed if necessary,
      // though typically services handle undefined inputs gracefully.
      // Example: if (serviceInput.description === undefined) delete serviceInput.description;
      // (Doing this for all optional fields might be overly verbose unless needed)

      const newWorkItem: WorkItemData = await workItemService.addWorkItem(serviceInput);

      logger.info(`[${TOOL_NAME}] Work item added successfully: ${newWorkItem.work_item_id}`); // TOOL_NAME is updated
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(newWorkItem) }],
      };
    } catch (error: unknown) {
      logger.error(`[${TOOL_NAME}] Error processing request:`, error); // TOOL_NAME is updated
      if (error instanceof NotFoundError || error instanceof ValidationError) {
        throw new McpError(ErrorCode.InvalidParams, error.message);
      } else {
        const message = error instanceof Error ? error.message : 'An unknown error occurred';
        throw new McpError(ErrorCode.InternalError, message);
      }
    }
  };
  // Register the tool handler using the BASE schema's shape
  server.tool(TOOL_NAME, TOOL_DESCRIPTION, AddTaskBaseSchema.shape, processRequest); // TOOL_NAME is updated
};
