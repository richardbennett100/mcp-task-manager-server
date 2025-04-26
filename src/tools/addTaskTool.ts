// src/tools/addTaskTool.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  TOOL_NAME,
  TOOL_DESCRIPTION,
  TOOL_PARAMS,
  AddTaskArgs, // Use updated args type
} from './addTaskParams.js'; // Use updated params file
import { logger } from '../utils/logger.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
// Import necessary components for instantiation inside the handler
import { DatabaseManager } from '../db/DatabaseManager.js';
import { WorkItemRepository } // Import NEW repository
  from '../repositories/WorkItemRepository.js';
import { WorkItemService, AddWorkItemInput } // Import NEW service and input type
  from '../services/WorkItemService.js';

/**
 * Registers the addTask (now addWorkItem conceptually) tool with the MCP server.
 * @param server - The McpServer instance.
 */
export const addTaskTool = (server: McpServer): void => {
  const processRequest = async (args: AddTaskArgs) => {
    logger.info(`[${TOOL_NAME}] Received request with args:`, args);
    try {
      // Instantiate dependencies inside the handler
      const dbManager = await DatabaseManager.getInstance();
      const pool = dbManager.getPool();
      const workItemRepository = new WorkItemRepository(pool);
      const workItemService = new WorkItemService(workItemRepository);

      // Map tool arguments to the service input type
      const serviceInput: AddWorkItemInput = {
        parent_work_item_id: args.parent_work_item_id, // Can be null/undefined
        name: args.name,
        description: args.description,
        priority: args.priority,
        status: args.status,
        due_date: args.due_date,
        order_key: args.order_key,
        shortname: args.shortname,
        // Map dependencies structure if provided
        dependencies: args.dependencies?.map((dep) => ({
          depends_on_work_item_id: dep.depends_on_work_item_id,
          dependency_type: dep.dependency_type,
        })),
      };

      // Call the new service method
      const newWorkItem = await workItemService.addWorkItem(serviceInput);

      logger.info(
        `[${TOOL_NAME}] Work item added successfully: ${newWorkItem.work_item_id}`
      );
      // Return the data for the newly created work item
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(newWorkItem) }],
      };
    } catch (error: unknown) {
      logger.error(`[${TOOL_NAME}] Error processing request:`, error);
      if (error instanceof NotFoundError) {
        // e.g., If parent_work_item_id was provided but doesn't exist (add check in service?)
        throw new McpError(ErrorCode.InvalidParams, error.message);
      } else if (error instanceof ValidationError) {
        // e.g., Validation errors from service layer
        throw new McpError(ErrorCode.InvalidParams, error.message);
      } else {
        const message =
          error instanceof Error
            ? error.message
            : 'An unknown error occurred while adding the work item.';
        throw new McpError(ErrorCode.InternalError, message);
      }
    }
  };

  // Register the tool with the updated Zod schema object's shape
  server.tool(TOOL_NAME, TOOL_DESCRIPTION, TOOL_PARAMS.shape, processRequest);

  // Log registration from index.ts
};