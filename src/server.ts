import { createServer } from './createServer.js'; // createServer is now sync
import { logger } from './utils/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

// Keep main async only because server.connect is async
const main = async () => {
  try {
    // createServer is sync again
    const server = createServer();
    logger.info('MCP server setup complete.');

    const transport = new StdioServerTransport();
    logger.info('Connecting transport', {
      transport: transport.constructor.name,
    });

    // Connect transport *after* synchronous setup/registration
    await server.connect(transport);

    logger.info('MCP Server connected and listening');
  } catch (error) {
    logger.error('Failed to start server', error);
    console.error('Fallback console log: Failed to start server:', error);
    process.exit(1);
  }
};

main();
