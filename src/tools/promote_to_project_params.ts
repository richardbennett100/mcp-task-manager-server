// src/tools/promote_to_project_params.ts
import { z } from 'zod';

export const TOOL_NAME = 'promote_to_project';

export const TOOL_DESCRIPTION = `
Converts an existing task into a top-level project.
Sets the task's parent_work_item_id to null.
Adds a 'linked' dependency from the task's original parent (if any) back to the newly promoted project.
Returns the full details of the updated work item (now a project).
`;

// Zod schema for the parameters
export const PromoteToProjectParamsSchema = z.object({
  work_item_id: z
    .string()
    .uuid('The work_item_id must be a valid UUID.')
    .describe('Required. The UUID of the task to be promoted to a project.'),
});

// Define the expected type for arguments based on the Zod schema
export type PromoteToProjectArgs = z.infer<typeof PromoteToProjectParamsSchema>;
