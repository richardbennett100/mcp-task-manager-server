import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
// Remove unused imports: ConfigManager, DBManager, Repos, Pool, Services
import { logger } from '../utils/index.js';

// Import only the tool registration functions
import { addTaskTool } from './addTaskTool.js';
import { listTasksTool } from './listTasksTool.js';
import { updateTaskTool } from './updateTaskTool.js';
import { deleteTaskTool } from './deleteTaskTool.js';
/**
 * Register all defined tools with the MCP server instance. (Now SYNCHRONOUS)
 * Does NOT instantiate dependencies anymore.
 */
export function registerTools(server: McpServer): void {
  // Sync function
  logger.info('Registering tools...');

  try {
    // --- NO DB/Repo/Service Instantiation Here ---

    // --- Register Tools ---
    // Pass only the server instance. Dependencies will be created inside tool handlers.
    addTaskTool(server);
    listTasksTool(server);
    updateTaskTool(server);
    deleteTaskTool(server);

    logger.info('All tools registered successfully.');
  } catch (error) {
    // Catch errors during the registration calls themselves (less likely)
    logger.error('Failed during synchronous tool registration:', error);
    console.error('Fallback console log: Failed during synchronous tool registration:', error);
    // Throw error to prevent server starting with incomplete tools
    throw new Error(`Failed to register tools: ${error instanceof Error ? error.message : error}`);
  }
}
