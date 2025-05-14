// src/__tests__/e2e/3_scenario_pub_crawl_sub_tasks.test.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import { logger } from '../../utils/logger.js'; // Assuming logger is accessible

// Schemas (can be shared or adapted from other E2E tests)
const MinimalWorkItemDataSchema = z
  .object({
    work_item_id: z.string().uuid(),
    name: z.string(),
    parent_work_item_id: z.string().uuid().nullable().optional(),
  })
  .passthrough();

const AddChildTasksResponseSchema = z.array(MinimalWorkItemDataSchema);
const PromoteToProjectResponseSchema = MinimalWorkItemDataSchema;
const ListWorkItemsResponseSchema = z.array(MinimalWorkItemDataSchema);

const MinimalToolCallResponsePayloadSchema = z.object({
  content: z
    .array(
      z.object({
        type: z.literal('text'),
        text: z.string(),
      })
    )
    .length(1),
});

const BaseMinimalWorkItemTreeNodeSchema = z
  .object({
    work_item_id: z.string().uuid(),
    name: z.string(),
    // Add other fields from WorkItemData if needed for assertions
  })
  .passthrough();

// Recursive type for MinimalWorkItemTreeNode
type MinimalWorkItemTreeNode = z.infer<typeof BaseMinimalWorkItemTreeNodeSchema> & {
  children: MinimalWorkItemTreeNode[];
  // Add dependencies if needed for very specific link verification, though name suffix might be enough
};

// Zod schema for MinimalWorkItemTreeNode, handling recursion with z.lazy
const MinimalWorkItemTreeNodeSchema: z.ZodType<MinimalWorkItemTreeNode> = BaseMinimalWorkItemTreeNodeSchema.extend({
  children: z.lazy(() => z.array(MinimalWorkItemTreeNodeSchema)),
});

const clientInfoAdvancedPromotion = {
  name: 'e2eTest-client-pubCrawlSubTasks', // Keeping original client name for this file
  version: '0.1.0',
};

describe('Scenario: Pub Crawl with Sub-Tasks and Advanced Promotion', () => {
  // Updated describe block
  let client: Client | null = null;
  let transport: StdioClientTransport | null = null;
  const SERVER_CONNECT_TIMEOUT = 20000;
  const POST_CONNECT_WAIT = 10000;
  const TEST_TIMEOUT = POST_CONNECT_WAIT + 75000; // Increased timeout for multi-step test

  beforeAll(
    async () => {
      const transportParams = {
        command: 'node',
        args: ['--loader', 'ts-node/esm', './dist/server.js'],
        env: { ...process.env, LOG_LEVEL: 'info' },
      };
      transport = new StdioClientTransport(transportParams);
      client = new Client(clientInfoAdvancedPromotion);

      let connectError: Error | null = null;
      transport.onerror = (err) => {
        logger.error(`Transport onerror (Pub Crawl SubTasks Test): ${err.message}`);
        connectError = err;
      };
      transport.onclose = () => logger.info('Transport onclose (Pub Crawl SubTasks Test): Connection closed.');

      logger.info('Attempting to connect client (Pub Crawl SubTasks Test)...');
      try {
        await client.connect(transport);
        logger.info('Client connect promise resolved (Pub Crawl SubTasks Test).');
      } catch (err) {
        logger.error('Client connect promise rejected (Pub Crawl SubTasks Test):', err);
        connectError = err as Error;
      }

      if (connectError) {
        throw new Error(`Failed to connect in beforeAll (Pub Crawl SubTasks Test): ${connectError.message}`);
      }

      logger.info(`Waiting ${POST_CONNECT_WAIT}ms for server to fully initialize (Pub Crawl SubTasks Test)...`);
      await new Promise((r) => setTimeout(r, POST_CONNECT_WAIT));
      logger.info('Wait finished, proceeding with Pub Crawl SubTasks Test.');
    },
    SERVER_CONNECT_TIMEOUT + POST_CONNECT_WAIT + 5000
  );

  afterAll(async () => {
    try {
      if (transport) {
        await transport.close();
        logger.info('Transport closed in afterAll (Pub Crawl SubTasks Test).');
      }
    } catch (e) {
      logger.warn('transport.close() failed (Pub Crawl SubTasks Test).', e);
    }
    client = null;
    transport = null;
  });

  it(
    'should handle project creation, multi-level sub-tasking, promotion, and verify complex tree view with propagated (L) links',
    async () => {
      if (!client) {
        throw new Error('Client was not initialized (Pub Crawl SubTasks Test)');
      }

      // 1. Create "MainProject"
      const mainProjectName = 'Main Project (for advanced promotion)';
      logger.info(`Creating project: "${mainProjectName}"`);
      const createResponse = await client.request(
        { method: 'tools/call', params: { name: 'create_project', arguments: { name: mainProjectName } } },
        MinimalToolCallResponsePayloadSchema
      );
      const mainProject = MinimalWorkItemDataSchema.parse(JSON.parse(createResponse.content[0].text));
      const mainProjectId = mainProject.work_item_id;
      expect(mainProject.name).toBe(mainProjectName);
      logger.info(`"${mainProjectName}" created with ID: ${mainProjectId}`);

      // 2. Add "Sub1", "Sub2", "Sub3" to "MainProject"
      const subTaskNamesL1 = ['Sub1', 'Sub2', 'Sub3'];
      logger.info(`Adding L1 sub-tasks to ${mainProjectId}`);
      const addChildTasksL1Response = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'add_child_tasks',
            arguments: { parent_work_item_id: mainProjectId, child_tasks: subTaskNamesL1.map((name) => ({ name })) },
          },
        },
        MinimalToolCallResponsePayloadSchema
      );
      const subTasksL1 = AddChildTasksResponseSchema.parse(JSON.parse(addChildTasksL1Response.content[0].text));
      expect(subTasksL1.length).toBe(3);
      const sub1 = subTasksL1.find((t) => t.name === 'Sub1');
      const sub2 = subTasksL1.find((t) => t.name === 'Sub2');
      const sub3 = subTasksL1.find((t) => t.name === 'Sub3');
      expect(sub1).toBeDefined();
      expect(sub2).toBeDefined();
      expect(sub3).toBeDefined();
      const sub1Id = sub1!.work_item_id;
      logger.info(`L1 sub-tasks added. "Sub1" ID: ${sub1Id}`);

      // 3. Add "SubSub1", "SubSub2", "SubSub3" to "Sub1"
      const subTaskNamesL2 = ['SubSub1', 'SubSub2', 'SubSub3'];
      logger.info(`Adding L2 sub-tasks to "Sub1" (${sub1Id})`);
      const addChildTasksL2Response = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'add_child_tasks',
            arguments: { parent_work_item_id: sub1Id, child_tasks: subTaskNamesL2.map((name) => ({ name })) },
          },
        },
        MinimalToolCallResponsePayloadSchema
      );
      const subTasksL2 = AddChildTasksResponseSchema.parse(JSON.parse(addChildTasksL2Response.content[0].text));
      expect(subTasksL2.length).toBe(3);
      const subSub1 = subTasksL2.find((t) => t.name === 'SubSub1');
      const subSub2 = subTasksL2.find((t) => t.name === 'SubSub2');
      const subSub3 = subTasksL2.find((t) => t.name === 'SubSub3');
      expect(subSub1).toBeDefined();
      expect(subSub2).toBeDefined();
      expect(subSub3).toBeDefined();
      logger.info(`L2 sub-tasks added under "Sub1".`);

      // 4. Promote "Sub1" to a project
      logger.info(`Promoting "Sub1" (${sub1Id}) to a project`);
      await client.request(
        { method: 'tools/call', params: { name: 'promote_to_project', arguments: { work_item_id: sub1Id } } },
        MinimalToolCallResponsePayloadSchema.extend({
          content: z
            .array(
              z.object({
                type: z.literal('text'),
                text: z.string().transform((val) => PromoteToProjectResponseSchema.parse(JSON.parse(val))),
              })
            )
            .length(1),
        })
      );
      logger.info(`"Sub1" promoted.`);

      // 5. Get the full tree for "MainProject"
      logger.info(`Getting full tree for "${mainProjectName}" (${mainProjectId})`);
      const treeResponse = await client.request(
        { method: 'tools/call', params: { name: 'get_full_tree', arguments: { work_item_id: mainProjectId } } },
        MinimalToolCallResponsePayloadSchema
      );
      const projectTree = MinimalWorkItemTreeNodeSchema.parse(JSON.parse(treeResponse.content[0].text));
      logger.info('Full tree received for MainProject:', JSON.stringify(projectTree, null, 2));

      // 6. Verify the tree structure of "MainProject"
      expect(projectTree.work_item_id).toBe(mainProjectId);
      expect(projectTree.name).toBe(mainProjectName);
      expect(projectTree.children).toBeDefined();
      // Expecting Sub1 (L), Sub2, Sub3
      expect(projectTree.children.length).toBe(3);

      // Find Sub1 (L)
      const sub1LinkedNode = projectTree.children.find((child) => child.work_item_id === sub1Id);
      expect(sub1LinkedNode).toBeDefined();
      expect(sub1LinkedNode?.name).toBe('Sub1 (L)'); // "Sub1" is linked
      expect(sub1LinkedNode?.children).toBeDefined();
      // Expecting SubSub1 (L), SubSub2 (L), SubSub3 (L) under Sub1 (L)
      expect(sub1LinkedNode?.children.length).toBe(3);

      const subSub1LinkedNode = sub1LinkedNode?.children.find((child) => child.work_item_id === subSub1!.work_item_id);
      expect(subSub1LinkedNode).toBeDefined();
      expect(subSub1LinkedNode?.name).toBe('SubSub1 (L)'); // Child of a linked item is also shown as (L)
      expect(subSub1LinkedNode?.children.length).toBe(0); // Leaf in this representation

      const subSub2LinkedNode = sub1LinkedNode?.children.find((child) => child.work_item_id === subSub2!.work_item_id);
      expect(subSub2LinkedNode).toBeDefined();
      expect(subSub2LinkedNode?.name).toBe('SubSub2 (L)'); // Child of a linked item is also shown as (L)
      expect(subSub2LinkedNode?.children.length).toBe(0); // Leaf

      const subSub3LinkedNode = sub1LinkedNode?.children.find((child) => child.work_item_id === subSub3!.work_item_id);
      expect(subSub3LinkedNode).toBeDefined();
      expect(subSub3LinkedNode?.name).toBe('SubSub3 (L)'); // Child of a linked item is also shown as (L)
      expect(subSub3LinkedNode?.children.length).toBe(0); // Leaf

      // Find Sub2 and Sub3 (should not have (L))
      const sub2Node = projectTree.children.find((child) => child.work_item_id === sub2!.work_item_id);
      expect(sub2Node).toBeDefined();
      expect(sub2Node?.name).toBe('Sub2');
      expect(sub2Node?.children.length).toBe(0);

      const sub3Node = projectTree.children.find((child) => child.work_item_id === sub3!.work_item_id);
      expect(sub3Node).toBeDefined();
      expect(sub3Node?.name).toBe('Sub3');
      expect(sub3Node?.children.length).toBe(0);

      logger.info('Tree structure for MainProject verified.');

      // 7. List all projects (roots_only)
      logger.info('Listing all root projects');
      const listProjectsResponse = await client.request(
        { method: 'tools/call', params: { name: 'list_work_items', arguments: { roots_only: true } } },
        MinimalToolCallResponsePayloadSchema
      );
      const rootProjects = ListWorkItemsResponseSchema.parse(JSON.parse(listProjectsResponse.content[0].text));
      logger.info('Root projects received:', rootProjects);

      const mainProjectInList = rootProjects.find((p) => p.work_item_id === mainProjectId);
      expect(mainProjectInList).toBeDefined();
      expect(mainProjectInList?.name).toBe(mainProjectName); // No (L)

      const sub1PromotedProjectInList = rootProjects.find((p) => p.work_item_id === sub1Id);
      expect(sub1PromotedProjectInList).toBeDefined();
      expect(sub1PromotedProjectInList?.name).toBe('Sub1'); // No (L), it's the actual project

      logger.info('Root projects list verified.');
    },
    TEST_TIMEOUT
  );
});
