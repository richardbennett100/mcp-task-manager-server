// src/tools/get_full_tree_params.ts
import { z } from 'zod';

export const TOOL_NAME = 'get_full_tree';
export const TOOL_DESCRIPTION = `
Retrieves a specified work item and its entire descendant hierarchy recursively.
Returns a structured JSON object representing the tree.

Key features of the output:
- Each node in the tree includes the work item's details (ID, name, status, etc.), its direct dependencies, and its dependents.
- Promoted Items (Linked Items): If a task was promoted to a project from under a parent, it will appear as a child of its original parent in this tree view, but its name will be suffixed with " (L)" to indicate it's a "linked" representation.
- Children of Linked Items: Any children that the promoted (linked) item itself has will also be displayed under it in this tree view, and their names will also be suffixed with " (L)" because they are part of that "linked" branch representation.
- Actual Project Status: A promoted item (e.g., "Task A (L)") is, in reality, a root-level project. To see its actual project details without the "(L)" suffix and its status as a root item, use the "get_details" tool with its ID, or "list_work_items" with "roots_only: true".

Optional parameters allow control over the depth and inclusion of inactive items.
`;

export const GetFullTreeOptionsSchema = z.object({
  include_inactive_items: z
    .boolean()
    .optional()
    .describe('Optional. If true, inactive work items will be included in the tree. Defaults to false.'),
  include_inactive_dependencies: z
    .boolean()
    .optional()
    .describe('Optional. If true, inactive dependency links will be included. Defaults to false.'),
  max_depth: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Optional. Maximum depth of the tree to retrieve. Defaults to 10.'),
});

export const GetFullTreeParamsSchema = z.object({
  work_item_id: z
    .string()
    .uuid({ message: 'Work item ID must be a valid UUID.' })
    .describe('Required. The UUID of the root work item for the tree view.'),
  options: GetFullTreeOptionsSchema.optional().describe('Optional. Parameters to control tree retrieval options.'),
});

export type GetFullTreeArgs = z.infer<typeof GetFullTreeParamsSchema>;
