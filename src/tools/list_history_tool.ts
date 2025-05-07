// src/tools/list_history_tool.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  TOOL_NAME,
  TOOL_DESCRIPTION,
  ListHistoryParamsSchema,
  ListHistoryArgs,
  HistoryEntry,
} from './list_history_params.js';
import { logger } from '../utils/logger.js';
import { DatabaseManager } from '../db/DatabaseManager.js';
// Removed unused WorkItemRepository import
import { ActionHistoryRepository } from '../repositories/index.js';
// Removed unused WorkItemService import

export const listHistoryTool = (server: McpServer): void => {
  const processRequest = async (args: ListHistoryArgs): Promise<{ content: { type: 'text'; text: string }[] }> => {
    logger.info(`[${TOOL_NAME}] Received request with args:`, args);

    try {
      const dbManager = await DatabaseManager.getInstance();
      const pool = dbManager.getPool();
      // Instantiate only the needed repository
      const actionHistoryRepository = new ActionHistoryRepository(pool);
      // Removed unused workItemRepository and workItemService instantiation

      // Directly call the method on ActionHistoryRepository
      const historyRecords = await actionHistoryRepository.listHistoryByDateRange({
        startDate: args.start_date,
        endDate: args.end_date,
        limit: args.limit,
      });

      // Map to the simpler HistoryEntry format for the agent
      const historyEntries: HistoryEntry[] = historyRecords.map((record) => ({
        timestamp: record.timestamp,
        description: record.description,
        // Optionally add action_type: record.action_type
      }));

      logger.info(`[${TOOL_NAME}] Found ${historyEntries.length} history records.`);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(historyEntries) }],
      };
    } catch (error: unknown) {
      logger.error(`[${TOOL_NAME}] Error processing request:`, error);
      const message = error instanceof Error ? error.message : 'An unknown error occurred while listing history.';
      throw new McpError(ErrorCode.InternalError, message);
    }
  };
  // Register the tool handler
  server.tool(TOOL_NAME, TOOL_DESCRIPTION, ListHistoryParamsSchema.shape, processRequest);
};
