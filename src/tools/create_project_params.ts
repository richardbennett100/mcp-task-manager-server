// src/tools/create_project_params.ts
import { z } from 'zod';

export const TOOL_NAME = 'create_project';

export const TOOL_DESCRIPTION = `
Creates a new top-level project work item.
Optionally accepts a name and description.
Does not take a parent ID, as it always creates a root item.
Returns the full details of the newly created project work item upon success.
Future enhancement: Will accept initial child tasks.
`;

// Base Zod schema for project creation
export const CreateProjectParamsSchema = z.object({
  name: z
    .string()
    .min(1, 'Project name cannot be empty.')
    .max(255, 'Project name cannot exceed 255 characters.')
    .describe('Required. The primary name or title for the project (1-255 characters).'),

  description: z
    .string()
    .max(1024, 'Description cannot exceed 1024 characters.')
    .optional() // Now only optional, not nullable
    .describe('Optional. A detailed description for the project (max 1024 characters).'),
});

// Define the expected type for arguments based on the Zod schema
export type CreateProjectArgs = z.infer<typeof CreateProjectParamsSchema>;
