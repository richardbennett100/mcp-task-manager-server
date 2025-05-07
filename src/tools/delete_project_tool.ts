// src/tools/delete_project_tool.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAME, TOOL_DESCRIPTION, DeleteProjectParamsSchema, DeleteProjectArgs } from './delete_project_params.js';
import { logger } from '../utils/logger.js';
import { NotFoundError } from '../utils/errors.js';
import { DatabaseManager } from '../db/DatabaseManager.js';
import { WorkItemRepository, ActionHistoryRepository } from '../repositories/index.js';
import { WorkItemService } from '../services/WorkItemService.js';

export const deleteProjectTool = (server: McpServer): void => {
  const processRequest = async (args: DeleteProjectArgs): Promise<{ content: { type: 'text'; text: string }[] }> => {
    logger.info(`[${TOOL_NAME}] Received request to delete project ${args.project_id}.`);

    try {
      const dbManager = await DatabaseManager.getInstance();
      const pool = dbManager.getPool();
      const workItemRepository = new WorkItemRepository(pool);
      const actionHistoryRepository = new ActionHistoryRepository(pool);
      const workItemService = new WorkItemService(workItemRepository, actionHistoryRepository);

      // --- Validation Step ---
      const projectItem = await workItemRepository.findById(args.project_id, { isActive: true }); // Check active projects first

      if (!projectItem) {
        // Maybe it was already deleted? Check inactive.
        const inactiveProjectItem = await workItemRepository.findById(args.project_id, { isActive: false });
        if (!inactiveProjectItem) {
          throw new NotFoundError(`Project with ID ${args.project_id} not found.`);
        }
        // It exists but is inactive - treat as success? Or specific message?
        // For now, let's just report 0 deleted if it was already inactive.
        logger.info(`[${TOOL_NAME}] Project ${args.project_id} was already inactive. No action taken.`);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ success: true, deleted_count: 0, message: 'Project already inactive.' }),
            },
          ],
        };
      }

      if (projectItem.parent_work_item_id !== null) {
        throw new McpError(ErrorCode.InvalidParams, `Work item ID ${args.project_id} is not a top-level project.`);
      }
      // --- End Validation ---

      // Call the existing delete service, which handles the cascade
      const deletedCount = await workItemService.deleteWorkItem([args.project_id]);

      logger.info(
        `[${TOOL_NAME}] Successfully soft-deleted project ${args.project_id} and its descendants (count: ${deletedCount}).`
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ success: true, deleted_count: deletedCount }),
          },
        ],
      };
    } catch (error: unknown) {
      logger.error(`[${TOOL_NAME}] Error processing request for project ${args.project_id}:`, error);
      if (error instanceof NotFoundError || error instanceof McpError) {
        // Catch McpError from validation
        throw new McpError(ErrorCode.InvalidParams, error.message);
      } else {
        const message = error instanceof Error ? error.message : 'An unknown error occurred';
        throw new McpError(ErrorCode.InternalError, message);
      }
    }
  };
  // Register the tool handler
  server.tool(TOOL_NAME, TOOL_DESCRIPTION, DeleteProjectParamsSchema.shape, processRequest);
};
