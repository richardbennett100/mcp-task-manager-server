// src/tools/delete_project_params.ts
import { z } from 'zod';

export const TOOL_NAME = 'delete_project';

export const TOOL_DESCRIPTION = `
Soft-deletes a specified top-level project and all its descendant work items (tasks, sub-tasks).
Requires the project_id (UUID) of the project to delete.
This performs a recursive soft delete.
`;

// Zod schema for the parameters
export const DeleteProjectParamsSchema = z.object({
  project_id: z
    .string()
    .uuid('The project_id must be a valid UUID.')
    .describe('Required. The unique identifier (UUID) of the top-level project to delete.'),
});

// Define the expected type for arguments based on the Zod schema
export type DeleteProjectArgs = z.infer<typeof DeleteProjectParamsSchema>;
