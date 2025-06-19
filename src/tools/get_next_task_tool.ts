// src/tools/get_next_task_tool.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
// FIX: Removed TOOL_NAME, TOOL_DESCRIPTION from this import
import { GetNextTaskParamsSchema, GetNextTaskParams } from './get_next_task_params.js';
import { logger } from '../utils/logger.js';
import { NotFoundError } from '../utils/errors.js'; // Import custom error
// Import necessary components for instantiation inside the handler
import { DatabaseManager } from '../db/DatabaseManager.js';
import { WorkItemRepository, ActionHistoryRepository } from '../repositories/index.js';
import { WorkItemService } from '../services/WorkItemService.js';
import { WorkItemData } from '../repositories/index.js'; // Import return type
// import sseNotificationService from '../services/SseNotificationService.js';

// FIX: Define constants locally
export const TOOL_NAME = 'get_next_task';
export const TOOL_DESCRIPTION =
  'Suggests the next most relevant active task to work on based on due date, priority, dependencies, and optional scope (item sub-tree, tags).';

// Changed to a registration function pattern for consistency
export const getNextTaskTool = (server: McpServer): void => {
  const processRequest = async (args: GetNextTaskParams): Promise<{ content: { type: 'text'; text: string }[] }> => {
    logger.info(`[${TOOL_NAME}] Received request with args:`, args);

    try {
      // Instantiate dependencies inside the handler
      const dbManager = await DatabaseManager.getInstance();
      const pool = dbManager.getPool();
      const workItemRepository = new WorkItemRepository(pool);
      const actionHistoryRepository = new ActionHistoryRepository(pool);
      const workItemService = new WorkItemService(workItemRepository, actionHistoryRepository); //); //, sseNotificationService);

      // Call the new service method
      const nextTask: WorkItemData | null = await workItemService.getNextTask(args);

      if (!nextTask) {
        logger.info(`[${TOOL_NAME}] No suitable next task found.`);
        // Return a specific message indicating no task was found
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ message: 'No actionable task found matching criteria.' }) },
          ],
        };
      }

      logger.info(`[${TOOL_NAME}] Suggested next task: ${nextTask.work_item_id}`);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(nextTask) }],
      };
    } catch (error: unknown) {
      logger.error(`[${TOOL_NAME}] Error processing request:`, error);
      if (error instanceof NotFoundError) {
        // If scope_item_id was provided but not found, treat as invalid params
        throw new McpError(ErrorCode.InvalidParams, error.message);
      } else {
        const message =
          error instanceof Error ? error.message : 'An unknown error occurred while suggesting the next task.';
        throw new McpError(ErrorCode.InternalError, message);
      }
    }
  };

  // Register the tool with the MCP server
  server.tool(TOOL_NAME, TOOL_DESCRIPTION, GetNextTaskParamsSchema.shape, processRequest);
};
