// src/tools/delete_child_tasks_params.ts
import { z } from 'zod';

export const TOOL_NAME = 'delete_child_tasks';
export const TOOL_DESCRIPTION = `
Deletes specified child tasks of a given parent work item.
If a list of child_task_ids is provided, only those tasks are deleted.
If delete_all_children is true, all direct child tasks of the parent are deleted (use with caution).
Returns a summary of the deletion operation.
`;

// Define the base schema first
const baseDeleteChildTasksParamsSchema = z.object({
  parent_work_item_id: z
    .string()
    .uuid({ message: 'Parent work item ID must be a valid UUID.' })
    .describe('Required. The UUID of the parent work item whose children are to be deleted.'),
  child_task_ids: z
    .array(z.string().uuid({ message: 'Each child task ID must be a valid UUID.' }))
    .optional()
    .describe(
      'Optional. An array of specific child task UUIDs to delete. If provided and delete_all_children is false, only these are targeted.'
    ),
  delete_all_children: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Optional. If true, all direct child tasks of the parent_work_item_id will be deleted. child_task_ids will be ignored if this is true. Defaults to false.'
    ),
});

// Apply refine to the base schema
export const DeleteChildTasksParamsSchema = baseDeleteChildTasksParamsSchema.refine(
  (data) => data.delete_all_children || (data.child_task_ids && data.child_task_ids.length > 0),
  {
    message: "Either 'delete_all_children' must be true, or 'child_task_ids' must be provided and non-empty.",
    path: ['child_task_ids'],
  }
);

export type DeleteChildTasksArgs = z.infer<typeof DeleteChildTasksParamsSchema>;

// Export the shape from the base schema for tool registration
export const DeleteChildTasksParamsSchemaShape = baseDeleteChildTasksParamsSchema.shape;
