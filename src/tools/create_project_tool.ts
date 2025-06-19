// src/tools/create_project_tool.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAME, TOOL_DESCRIPTION, CreateProjectParamsSchema, CreateProjectArgs } from './create_project_params.js';
import { logger } from '../utils/logger.js';
import { ValidationError } from '../utils/errors.js';
import { DatabaseManager } from '../db/DatabaseManager.js';
import { WorkItemRepository, ActionHistoryRepository } from '../repositories/index.js';
import { WorkItemService } from '../services/WorkItemService.js';
import { AddWorkItemInput } from '../services/WorkItemServiceTypes.js'; // Service uses this
import { WorkItemData } from '../repositories/index.js';
// import sseNotificationService from '../services/SseNotificationService.js';

export const createProjectTool = (server: McpServer): void => {
  const processRequest = async (args: CreateProjectArgs): Promise<{ content: { type: 'text'; text: string }[] }> => {
    logger.info(`[${TOOL_NAME}] Received request with args:`, args);

    try {
      const dbManager = await DatabaseManager.getInstance();
      const pool = dbManager.getPool();
      const workItemRepository = new WorkItemRepository(pool);
      const actionHistoryRepository = new ActionHistoryRepository(pool);
      const workItemService = new WorkItemService(workItemRepository, actionHistoryRepository); //); //, sseNotificationService);

      // Map tool arguments to service input, explicitly setting parent to null
      const serviceInput: AddWorkItemInput = {
        parent_work_item_id: null, // Explicitly null for project creation
        name: args.name,
        description: args.description,
        // Let service handle defaults for status, priority, etc.
        // Let service handle positioning defaults (likely end of root list)
      };
      // Future: Add logic here to handle nested child task input when implemented

      const newProject: WorkItemData = await workItemService.addWorkItem(serviceInput);

      logger.info(`[${TOOL_NAME}] Project created successfully: ${newProject.work_item_id}`);
      // Return the full project data, as addWorkItem returns it
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(newProject) }],
      };
    } catch (error: unknown) {
      logger.error(`[${TOOL_NAME}] Error processing request:`, error);
      if (error instanceof ValidationError) {
        throw new McpError(ErrorCode.InvalidParams, error.message);
      } else {
        const message = error instanceof Error ? error.message : 'An unknown error occurred';
        throw new McpError(ErrorCode.InternalError, message);
      }
    }
  };
  // Register the tool handler using the BASE schema's shape
  server.tool(TOOL_NAME, TOOL_DESCRIPTION, CreateProjectParamsSchema.shape, processRequest);
};
