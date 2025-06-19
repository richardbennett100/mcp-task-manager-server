// src/tools/export_project_tool.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAME, TOOL_DESCRIPTION, ExportProjectParamsSchema, ExportProjectArgs } from './export_project_params.js';
import { logger } from '../utils/logger.js';
import { DatabaseManager } from '../db/DatabaseManager.js';
import { WorkItemRepository, ActionHistoryRepository } from '../repositories/index.js';
import { WorkItemService } from '../services/WorkItemService.js';
import { WorkItemTreeNode } from '../services/WorkItemServiceTypes.js'; // Assuming getFullTree returns this
// import sseNotificationService from '../services/SseNotificationService.js';

export const exportProjectTool = (server: McpServer): void => {
  const processRequest = async (args: ExportProjectArgs): Promise<{ content: { type: 'text'; text: string }[] }> => {
    logger.info(`[${TOOL_NAME}] Received request for project_id: ${args.project_id}`);

    try {
      const dbManager = await DatabaseManager.getInstance();
      const pool = dbManager.getPool();
      const workItemRepository = new WorkItemRepository(pool);
      const actionHistoryRepository = new ActionHistoryRepository(pool);
      const workItemService = new WorkItemService(workItemRepository, actionHistoryRepository); //); //, sseNotificationService);

      // In a real implementation, use workItemService.getFullTree or similar to get the project hierarchy
      const projectTree: WorkItemTreeNode | null = await workItemService.getFullTree(args.project_id, {
        //include_inactive_items: true, // Or based on further params
        //include_inactive_dependencies: true,
        max_depth: Infinity, // Export the whole tree
      });

      if (!projectTree) {
        throw new McpError(ErrorCode.InvalidParams, `Project with ID ${args.project_id} not found.`);
      }

      // For now, returning a placeholder.
      // const projectJson = JSON.stringify(projectTree, null, 2); // Pretty print JSON
      const projectJson = JSON.stringify({
        message: `Placeholder: Export data for project ${args.project_id}`,
        data: projectTree,
      });

      logger.info(`[${TOOL_NAME}] Successfully prepared export for project ${args.project_id}.`);
      return {
        content: [{ type: 'text' as const, text: projectJson }],
      };
    } catch (error: unknown) {
      logger.error(`[${TOOL_NAME}] Error processing request for project ${args.project_id}:`, error);
      if (error instanceof McpError) throw error;
      const message = error instanceof Error ? error.message : 'An unknown error occurred during project export.';
      throw new McpError(ErrorCode.InternalError, message);
    }
  };

  server.tool(TOOL_NAME, TOOL_DESCRIPTION, ExportProjectParamsSchema.shape, processRequest);
};
