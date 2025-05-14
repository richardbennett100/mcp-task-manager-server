// src/__tests__/e2e/2_scenario_pub_crawl.test.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';

// Minimal Schemas for this test file
const MinimalWorkItemDataSchema = z
  .object({
    work_item_id: z.string().uuid(),
    name: z.string(),
  })
  .passthrough(); // Allows other fields without explicit definition

// Schema for the outer structure of a tool call response (content.text contains further JSON)
const MinimalToolCallResponsePayloadSchema = z.object({
  content: z
    .array(
      z.object({
        type: z.literal('text'),
        text: z.string(), // The inner JSON string will be parsed separately
      })
    )
    .length(1),
});

// Base schema for a tree node
const BaseMinimalWorkItemTreeNodeSchema = z
  .object({
    work_item_id: z.string().uuid(),
    name: z.string(),
  })
  .passthrough();

// Recursive type for MinimalWorkItemTreeNode
type MinimalWorkItemTreeNode = z.infer<typeof BaseMinimalWorkItemTreeNodeSchema> & {
  children: MinimalWorkItemTreeNode[];
};

// Zod schema for MinimalWorkItemTreeNode, handling recursion with z.lazy
const MinimalWorkItemTreeNodeSchema: z.ZodType<MinimalWorkItemTreeNode> = BaseMinimalWorkItemTreeNodeSchema.extend({
  children: z.lazy(() => z.array(MinimalWorkItemTreeNodeSchema)),
});

const clientInfoPubCrawl = {
  name: 'e2eTest-client-pubCrawl',
  version: '0.1.0',
};

describe('Scenario: Pub Crawl', () => {
  let client: Client | null = null;
  let transport: StdioClientTransport | null = null;
  const SERVER_CONNECT_TIMEOUT = 20000;
  const POST_CONNECT_WAIT = 10000;
  const TEST_TIMEOUT = POST_CONNECT_WAIT + 25000;

  beforeAll(
    async () => {
      const transportParams = {
        command: 'node',
        args: ['--loader', 'ts-node/esm', './dist/server.js'],
        env: { ...process.env, LOG_LEVEL: 'info' },
      };
      transport = new StdioClientTransport(transportParams);
      client = new Client(clientInfoPubCrawl);

      let connectError: Error | null = null;
      transport.onerror = (err) => {
        console.error(`Transport onerror (Pub Crawl Test): ${err.message}`);
        connectError = err;
      };
      transport.onclose = () => console.log('Transport onclose (Pub Crawl Test): Connection closed.');

      console.log('Attempting to connect client (Pub Crawl Test)...');
      try {
        await client.connect(transport);
        console.log('Client connect promise resolved (Pub Crawl Test).');
      } catch (err) {
        console.error('Client connect promise rejected (Pub Crawl Test):', err);
        connectError = err as Error;
      }

      if (connectError) {
        throw new Error(`Failed to connect in beforeAll (Pub Crawl Test): ${connectError.message}`);
      }

      console.log(`Waiting ${POST_CONNECT_WAIT}ms for server to fully initialize (Pub Crawl Test)...`);
      await new Promise((r) => setTimeout(r, POST_CONNECT_WAIT));
      console.log('Wait finished, proceeding with Pub Crawl Test.');
    },
    SERVER_CONNECT_TIMEOUT + POST_CONNECT_WAIT + 5000
  );

  afterAll(async () => {
    try {
      if (transport) {
        await transport.close();
        console.log('Transport closed in afterAll (Pub Crawl Test).');
      }
    } catch (e) {
      console.warn('transport.close() failed (Pub Crawl Test).', e);
    }
    client = null;
    transport = null;
  });

  it(
    'should create a project "Pub Crawl" and print its tree view',
    async () => {
      if (!client) {
        throw new Error('Client was not initialized (Pub Crawl Test)');
      }

      const projectName = 'Pub Crawl';
      const projectDescription = 'A minimal plan for an evening adventure.';

      console.log(`Attempting to create project: "${projectName}" (Pub Crawl Test) using "tools/call"`);

      const createResponse = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'create_project',
            arguments: { name: projectName, description: projectDescription },
          },
        },
        MinimalToolCallResponsePayloadSchema
      );

      const createdProjectText = createResponse.content[0].text;
      expect(createdProjectText).toBeDefined();
      const createdProject = MinimalWorkItemDataSchema.parse(JSON.parse(createdProjectText));

      expect(createdProject.work_item_id).toBeDefined();
      expect(createdProject.name).toBe(projectName);
      console.log(`Project "${projectName}" created with ID: ${createdProject.work_item_id} (Pub Crawl Test)`);

      const projectId = createdProject.work_item_id;

      console.log(`Workspaceing tree view for project ID: ${projectId} (Pub Crawl Test) using "tools/call"`);
      const treeResponse = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'get_full_tree',
            arguments: {
              work_item_id: projectId,
              // Options can be added here if needed, e.g.,
              // options: { max_depth: 5 }
            },
          },
        },
        MinimalToolCallResponsePayloadSchema
      );

      const projectTreeText = treeResponse.content[0].text;
      expect(projectTreeText).toBeDefined();
      const projectTree = MinimalWorkItemTreeNodeSchema.parse(JSON.parse(projectTreeText));

      expect(projectTree.work_item_id).toBe(projectId);
      expect(projectTree.name).toBe(projectName);
      expect(projectTree.children).toBeDefined();
      expect(Array.isArray(projectTree.children)).toBe(true);
      // A new project should have no children unless the tool creates them by default.
      expect(projectTree.children.length).toBe(0);

      console.log(`Tree view for project "${projectName}" (Pub Crawl Test):`);
      console.log(JSON.stringify(projectTree, null, 2));
    },
    TEST_TIMEOUT
  );
});
