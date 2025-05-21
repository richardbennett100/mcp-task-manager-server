// Modified upload/src/__tests__/e2e/3_scenario_pub_crawl_sub_tasks.test.ts
// Changes:
// 1. In the call to 'add_child_tasks' tool, changed parameter name from 'child_tasks' to 'child_tasks_tree'.
// upload/src/__tests__/e2e/3_scenario_pub_crawl_sub_tasks.test.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';

// --- Schemas ---
const WorkItemSchemaForListing = z
  .object({
    // Schema for items returned by list_work_items
    work_item_id: z.string().uuid(),
    name: z.string(),
    is_active: z.boolean().optional(), // list_work_items returns this
    // Add other fields if list_work_items returns more and they are needed for filtering
  })
  .passthrough();

const ListWorkItemsResponseSchema = z.array(WorkItemSchemaForListing);

const MinimalWorkItemDataSchema = z // For add_child_tasks response and get_details
  .object({
    work_item_id: z.string().uuid(),
    name: z.string(),
    parent_work_item_id: z.string().uuid().nullable().optional(),
    description: z.string().nullable().optional(),
    status: z.string().optional(),
    is_active: z.boolean().optional(),
  })
  .passthrough();

const AddChildTasksResponseSchema = z.array(MinimalWorkItemDataSchema);

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
    description: z.string().nullable().optional(),
    status: z.string().optional(),
    is_active: z.boolean().optional(),
  })
  .passthrough();

type MinimalWorkItemTreeNode = z.infer<typeof BaseMinimalWorkItemTreeNodeSchema> & {
  children: MinimalWorkItemTreeNode[];
};

const MinimalWorkItemTreeNodeSchema: z.ZodType<MinimalWorkItemTreeNode> = BaseMinimalWorkItemTreeNodeSchema.extend({
  children: z.lazy(() => z.array(MinimalWorkItemTreeNodeSchema)),
});
// --- End Schemas ---

const clientInfoPubCrawlTasks = {
  name: 'e2eTest-client-pubCrawl-scenario',
  version: '0.1.0',
};

describe('E2E Scenario: Agent adds tasks to an existing "Pub Crawl" project', () => {
  let client: Client | null = null;
  let transport: StdioClientTransport | null = null;
  const SERVER_CONNECT_TIMEOUT = 20000;
  const POST_CONNECT_WAIT = 10000;
  const TEST_TIMEOUT = POST_CONNECT_WAIT + 60000;

  const TARGET_PROJECT_NAME_FRAGMENT = 'Pub Crawl'; // Agent might get this from user

  beforeAll(
    async () => {
      logger.info(
        `E2E Test Starting: Scenario - Agent finds "${TARGET_PROJECT_NAME_FRAGMENT}" and adds tasks. Steps: 1. Connect. 2. List projects. 3. Find target project by name. 4. Add child tasks. 5. Get full tree and verify. 6. Set project to done.`
      );
      const transportParams = {
        command: 'node',
        args: ['--loader', 'ts-node/esm', './dist/server.js'],
        env: { ...process.env, LOG_LEVEL: 'info', FORCE_SCHEMA_RUN: 'false' },
      };
      transport = new StdioClientTransport(transportParams);
      client = new Client(clientInfoPubCrawlTasks);

      transport.onerror = (err) =>
        logger.error(`Transport onerror (${TARGET_PROJECT_NAME_FRAGMENT} Scenario Test): ${err.message}`);
      transport.onclose = () =>
        logger.info(`Transport onclose (${TARGET_PROJECT_NAME_FRAGMENT} Scenario Test): Connection closed.`);

      logger.info(`Attempting to connect client (${TARGET_PROJECT_NAME_FRAGMENT} Scenario Test)...`);
      await client.connect(transport);
      logger.info(`Client connect promise resolved (${TARGET_PROJECT_NAME_FRAGMENT} Scenario Test).`);

      logger.info(
        `Waiting ${POST_CONNECT_WAIT}ms for server to fully initialize (${TARGET_PROJECT_NAME_FRAGMENT} Scenario Test)...`
      );
      await new Promise((r) => setTimeout(r, POST_CONNECT_WAIT));
      logger.info(`Wait finished, proceeding with ${TARGET_PROJECT_NAME_FRAGMENT} Scenario Test.`);
    },
    SERVER_CONNECT_TIMEOUT + POST_CONNECT_WAIT + 5000
  );

  afterAll(async () => {
    if (transport) await transport.close();
    client = null;
    transport = null;
    logger.info(`Transport closed in afterAll (${TARGET_PROJECT_NAME_FRAGMENT} Scenario Test).`);
  });

  it(
    `should simulate an agent finding "${TARGET_PROJECT_NAME_FRAGMENT}", adding tasks, verifying, and marking as done`,
    async () => {
      if (!client) throw new Error('Client was not initialized');

      // Step 1: Agent lists projects to find the "Pub Crawl" project
      logger.info(`Agent action: Listing projects to find one named containing "${TARGET_PROJECT_NAME_FRAGMENT}".`);
      const listResponse = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'list_work_items',
            arguments: { roots_only: true, is_active: true },
          },
        },
        MinimalToolCallResponsePayloadSchema
      );
      const allProjects = ListWorkItemsResponseSchema.parse(JSON.parse(listResponse.content[0].text));

      const pubCrawlProject = allProjects.find((p) => p.name.includes(TARGET_PROJECT_NAME_FRAGMENT) && p.is_active);

      if (!pubCrawlProject) {
        logger.error(
          `E2E SCENARIO FAIL: Could not find an active project containing the name "${TARGET_PROJECT_NAME_FRAGMENT}". Ensure '2_scenario_pub_crawl.test.ts' runs first and creates it.`
        );
        throw new Error(
          `Project "${TARGET_PROJECT_NAME_FRAGMENT}" not found. This test depends on it being created by a previous E2E test.`
        );
      }
      const pubCrawlProjectId = pubCrawlProject.work_item_id;
      logger.info(`Agent found project: "${pubCrawlProject.name}" with ID: ${pubCrawlProjectId}.`);

      // Step 2: Agent adds tasks to the found "Pub Crawl" project
      const pubCrawlTaskDefs = [
        {
          name: 'Select first pub',
          description: 'Must have good craft beer and outdoor seating.',
          status: 'todo' as const,
          children: [], // Explicitly empty children for clarity, though optional
        },
        {
          name: 'Invite friends',
          description: 'Create WhatsApp group and send a Doodle for date.',
          status: 'todo' as const,
          children: [], // Explicitly empty children
        },
        {
          name: 'Confirm headcount',
          description: 'Finalize by Wednesday.',
          status: 'in-progress' as const,
          children: [],
        },
      ];

      logger.info(
        `Agent action: Adding ${pubCrawlTaskDefs.length} tasks to "${pubCrawlProject.name}" (ID: ${pubCrawlProjectId}).`
      );
      const addChildTasksResponse = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'add_child_tasks',
            arguments: {
              parent_work_item_id: pubCrawlProjectId,
              child_tasks_tree: pubCrawlTaskDefs.map((task) => ({
                // Corrected: child_tasks_tree
                name: task.name,
                description: task.description,
                status: task.status,
                children: task.children, // Pass children if defined, or omit if truly flat
              })),
            },
          },
        },
        MinimalToolCallResponsePayloadSchema
      );
      const addedTasks = AddChildTasksResponseSchema.parse(JSON.parse(addChildTasksResponse.content[0].text));
      expect(addedTasks.length).toBe(pubCrawlTaskDefs.length);
      logger.info(`${addedTasks.length} tasks successfully added to "${pubCrawlProject.name}".`);

      // Step 3: Agent verifies by getting the full tree
      logger.info(
        `Agent action: Getting full tree for "${pubCrawlProject.name}" (ID: ${pubCrawlProjectId}) to verify children.`
      );
      const treeResponse = await client.request(
        { method: 'tools/call', params: { name: 'get_full_tree', arguments: { work_item_id: pubCrawlProjectId } } },
        MinimalToolCallResponsePayloadSchema
      );
      const projectTree = MinimalWorkItemTreeNodeSchema.parse(JSON.parse(treeResponse.content[0].text));

      const treeMarkdown = formatTreeToMarkdown(projectTree);
      logger.info(`Full tree for "${pubCrawlProject.name}" (Markdown):\n${treeMarkdown}`);

      expect(projectTree.work_item_id).toBe(pubCrawlProjectId);
      expect(projectTree.children).toBeDefined();
      expect(projectTree.children.length).toBe(pubCrawlTaskDefs.length);
      const childNamesInTree = projectTree.children.map((child) => child.name).sort();
      const expectedChildNames = pubCrawlTaskDefs.map((task) => task.name).sort();
      expect(childNamesInTree).toEqual(expectedChildNames);
      logger.info(
        `Tree structure for "${pubCrawlProject.name}" with its ${projectTree.children.length} tasks verified.`
      );

      // Step 4: Agent marks the "Pub Crawl" project as "done"
      logger.info(
        `Agent action: Setting status of project "${pubCrawlProject.name}" (ID: ${pubCrawlProjectId}) to "done".`
      );
      const setStatusResponse = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'set_status',
            arguments: { work_item_id: pubCrawlProjectId, status: 'done' },
          },
        },
        MinimalToolCallResponsePayloadSchema
      );
      const updatedProjectStatus = MinimalWorkItemDataSchema.parse(JSON.parse(setStatusResponse.content[0].text));
      expect(updatedProjectStatus.status).toBe('done');
      logger.info(`Project "${pubCrawlProject.name}" status successfully updated to "done".`);
    },
    TEST_TIMEOUT
  );
});

// Helper function for Markdown tree output
function formatTreeToMarkdown(node: MinimalWorkItemTreeNode, indent = ''): string {
  let markdown = `${indent}- ${node.name} (id: ${node.work_item_id}, status: ${node.status || 'N/A'}, active: ${node.is_active === undefined ? 'N/A' : node.is_active})\n`;
  if (node.description) {
    markdown += `${indent}  > ${node.description.replace(/\n/g, `\n${indent}  > `)}\n`;
  }
  if (node.children && node.children.length > 0) {
    const sortedChildren = [...node.children].sort((a, b) => {
      if (a.name && b.name) return a.name.localeCompare(b.name);
      return 0;
    });
    for (const child of sortedChildren) {
      markdown += formatTreeToMarkdown(child, `${indent}  `);
    }
  }
  return markdown;
}
