// upload/src/tools/list_work_items_params.ts
import { z } from 'zod';
import { WorkItemStatusEnum } from '../services/WorkItemServiceTypes.js';

export const TOOL_NAME = 'list_work_items';

export const TOOL_DESCRIPTION = `Lists work items (projects or tasks) based on specified filters.
Returns a JSON array of work item objects.

**Agent Formatting Guide for "List Projects" Request:**
When user asks to list projects (e.g., "Which projects do we have?"), use filters: \`roots_only: true, is_active: true\`.
Present the output as follows:

Current Projects:
N. [S] Project Name (Due:YYYY-MM-DD)
        Description text.

**Format Details:**
- N: Sequential number (1, 2,...).
- [S]: Status Icon: '[ ]' todo, '[-]' in-progress, '[R]' review, '[x]' done.
- Due Date: Show if present.
- Description: Indent. If none, state "No description available."
- Deleted: Hidden by default. If asked, show with "(Deleted)" appended to name.

**Follow-up Actions:**
Agent must internally map displayed numbers to project \`work_item_id\` (GUID) from the tool's raw JSON output for subsequent commands.
`;

export const ListWorkItemsParamsSchema = z.object({
  parent_work_item_id: z
    .string()
    .uuid({ message: 'Parent work item ID must be a valid UUID.' })
    .optional()
    .describe('Optional. Filter by parent UUID. To list root items (projects), use roots_only: true.'),
  roots_only: z
    .boolean()
    .optional()
    .describe('Optional. If true, only root work items (typically projects) are returned.'),
  status: WorkItemStatusEnum.optional().describe(
    `Optional. Filter by status. Allowed values: ${WorkItemStatusEnum.options.join(', ')}.`
  ),
  is_active: z
    .boolean()
    .optional()
    .describe(
      'Optional. Filter by active status. True for active, false for inactive. Default: service usually returns active items.'
    ),
});

export type ListWorkItemsArgs = z.infer<typeof ListWorkItemsParamsSchema>;
