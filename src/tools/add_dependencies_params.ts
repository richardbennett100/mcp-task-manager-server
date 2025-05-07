// src/tools/add_dependencies_params.ts
import { z } from 'zod';

export const TOOL_NAME = 'add_dependencies';

export const TOOL_DESCRIPTION = `
Adds one or more dependency links TO a specified work item.
If a dependency link to the target already exists but is inactive, it will be reactivated.
If an active link already exists, its type might be updated if specified differently in the input.
`;

const DependencyInputSchema = z.object({
  depends_on_work_item_id: z.string().uuid('Each depends_on_work_item_id must be a valid UUID.'),
  dependency_type: z.enum(['finish-to-start', 'linked']).default('finish-to-start').optional(),
});

export const AddDependenciesParamsSchema = z.object({
  work_item_id: z
    .string()
    .uuid('The work_item_id must be a valid UUID.')
    .describe('Required. The UUID of the work item to which dependencies should be added.'),
  dependencies_to_add: z
    .array(DependencyInputSchema)
    .min(1, 'At least one dependency must be provided in dependencies_to_add.')
    .max(50, 'Cannot add more than 50 dependencies at once.')
    .describe('Required. An array of dependencies to add or update for the work_item_id.'),
});

// Define the expected type for arguments based on the Zod schema
export type AddDependenciesArgs = z.infer<typeof AddDependenciesParamsSchema>;
// Define the input type for a single dependency item
export type DependencyInput = z.infer<typeof DependencyInputSchema>;
