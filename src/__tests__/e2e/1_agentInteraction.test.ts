// upload/src/__tests__/e2e/1_agentInteraction.test.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';

// Define the expected shape of the inputSchema within a tool, according to MCP.ts ToolSchema
const JsonSchemaPropertiesSchema = z.object({}).passthrough(); // Allows any properties for now
const ToolInputSchemaDefinitionSchema = z.object({
  type: z.literal('object'),
  properties: JsonSchemaPropertiesSchema.optional(),
});

// Define the schema for a single tool based on MCP.ts ToolSchema
const ToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string().optional().nullable(),
  inputSchema: ToolInputSchemaDefinitionSchema,
});

// Correct schema for the *payload* of the "tools/list" result, which client.request expects
const ListToolsClientResponsePayloadSchema = z.object({
  tools: z.array(ToolDefinitionSchema),
});

const clientInfo = {
  name: 'e2eTest-client',
  version: '0.1.0',
};

describe('Agent Interaction E2E Test', () => {
  let client: Client | null = null;
  let transport: StdioClientTransport | null = null;
  const SERVER_CONNECT_TIMEOUT = 20000;
  const POST_CONNECT_WAIT = 10000;

  beforeAll(
    async () => {
      const transportParams = {
        command: 'node',
        args: ['--loader', 'ts-node/esm', './dist/server.js'],
        env: {
          ...process.env,
          LOG_LEVEL: 'debug',
          FORCE_SCHEMA_RUN: 'false', // Explicitly ensure schema is NOT rebuilt for E2E tests
        },
      };
      transport = new StdioClientTransport(transportParams);
      client = new Client(clientInfo);

      let connectError: Error | null = null;
      transport.onerror = (err) => {
        console.error(`Transport onerror: ${err.message}`);
        connectError = err;
      };
      transport.onclose = () => console.log('Transport onclose: Connection closed.');

      console.log('Attempting to connect client...');
      try {
        await client.connect(transport);
        console.log('Client connect promise resolved.');
      } catch (err) {
        console.error('Client connect promise rejected:', err);
        connectError = err as Error;
      }

      if (connectError) {
        throw new Error(`Failed to connect in beforeAll: ${connectError.message}`);
      }

      console.log(`Waiting ${POST_CONNECT_WAIT}ms for server to fully initialize...`);
      await new Promise((r) => setTimeout(r, POST_CONNECT_WAIT));
      console.log('Wait finished, proceeding with test.');
    },
    SERVER_CONNECT_TIMEOUT + POST_CONNECT_WAIT + 5000
  );

  afterAll(async () => {
    try {
      if (transport) {
        await transport.close();
        console.log('Transport closed in afterAll.');
      }
    } catch (e) {
      console.warn("transport.close() failed or doesn't exist in afterAll.", e);
    }
    client = null;
    transport = null;
  });

  it(
    'should connect to the local server and list available tools',
    async () => {
      if (!client) {
        throw new Error('Client was not initialized');
      }
      console.log('Sending "tools/list" request via client.request...');

      const listToolsResponse = await client.request({ method: 'tools/list' }, ListToolsClientResponsePayloadSchema);

      expect(listToolsResponse.tools).toBeDefined();
      const tools = listToolsResponse.tools;
      expect(Array.isArray(tools)).toBe(true);

      const toolNames = tools.map((t: { name: string }) => t.name);
      console.log('Received tool names:', toolNames);

      expect(tools.length).toBeGreaterThan(0);

      expect(toolNames).toContain('create_project');
      expect(toolNames).toContain('add_task');
      // MODIFIED: Expect 'get_details' instead of 'list_tasks'
      expect(toolNames).toContain('get_details');
      expect(toolNames).toContain('undo_last_action');

      const createProject = tools.find((t: { name: string }) => t.name === 'create_project');
      expect(createProject).toBeDefined();
      if (createProject) {
        expect(createProject.description).toBeDefined();
        expect(createProject.inputSchema).toBeDefined();
        expect(createProject.inputSchema.type).toBe('object');
      }

      // ADDED: Check for the new 'get_details' tool structure (optional, but good practice)
      const getDetailsToolInfo = tools.find((t: { name: string }) => t.name === 'get_details');
      expect(getDetailsToolInfo).toBeDefined();
      if (getDetailsToolInfo) {
        expect(getDetailsToolInfo.description).toBeDefined();
        expect(getDetailsToolInfo.inputSchema).toBeDefined();
        expect(getDetailsToolInfo.inputSchema.type).toBe('object');
        expect(getDetailsToolInfo.inputSchema.properties).toHaveProperty('work_item_id');
      }
    },
    15000 + POST_CONNECT_WAIT
  );
});
