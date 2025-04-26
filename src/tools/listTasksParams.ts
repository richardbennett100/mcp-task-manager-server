// src/tools/listTasksParams.ts
import { z } from 'zod';

export const TOOL_NAME = 'listTasks'; // Keep familiar name

export const TOOL_DESCRIPTION = `
Retrieves a list of work items (tasks, projects, etc.).
Can list top-level projects (if rootsOnly is true or parent_work_item_id is null)
OR direct children of a specific parent work item (if parent_work_item_id is provided).
Allows optional filtering by item status ('todo', 'in-progress', 'review', 'done').
Returns an array of work item objects matching the criteria. Does not fetch nested children.
`;

// Enum for status filtering
const WorkItemStatusEnum = z.enum([
  'todo',
  'in-progress',
  'review',
  'done',
]);

// Zod schema adapted for work items
export const TOOL_PARAMS = z.object({
  // Project ID removed
  parent_work_item_id: z
    .string()
    .uuid('parent_work_item_id must be a valid UUID if provided.')
    .nullable() // Explicitly allow null to fetch roots
    .optional()
    .describe(
      'Optional. The unique identifier (UUID) of the parent work item whose direct children are to be listed. Use null to list top-level projects.'
    ),

  rootsOnly: z
    .boolean()
    .optional()
    .describe(
      'Optional convenience flag. If true, lists only top-level projects (parent_work_item_id is ignored). If false or omitted, uses parent_work_item_id.'
    ),

  status: WorkItemStatusEnum.optional().describe(
    'Optional filter to return only items matching the specified status (excludes "deleted" items).'
  ),

  // include_subtasks removed as it's not supported by the current service implementation
});
// Add refinement to ensure either parent_work_item_id or rootsOnly makes sense?
// e.g., .refine(...) - maybe later if needed.

// Define the expected type for arguments based on the Zod schema
export type ListTasksArgs = z.infer<typeof TOOL_PARAMS>;