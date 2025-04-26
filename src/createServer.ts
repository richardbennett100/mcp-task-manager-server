import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
// Remove ConfigManager import if not used
import { registerTools } from './tools/index.js'; // registerTools is sync
import { logger } from './utils/index.js';

/**
 * Creates and configures an MCP server instance. (Now SYNCHRONOUS)
 */
export function createServer(): McpServer {
  // Sync function
  logger.info('Creating MCP server instance');

  // FIX: Added name and version properties
  const server = new McpServer({
    name: 'mcp-task-manager-server', // Or your preferred name
    version: '1.0.0', // Or your current version
    description: 'MCP Server for Task Management',
  });

  // Call synchronous tool registration
  registerTools(server);

  logger.info('MCP server instance created and tools registered successfully');
  return server; // Return the server instance
}
