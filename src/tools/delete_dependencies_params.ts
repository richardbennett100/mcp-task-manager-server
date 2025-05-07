// src/tools/delete_dependencies_params.ts
import { z } from 'zod';

export const TOOL_NAME = 'delete_dependencies';

export const TOOL_DESCRIPTION = `
Deletes (deactivates) one or more specified dependency links FROM a work item.
Requires the work_item_id and an array of the 'depends_on_work_item_id's for the links to remove.
Only affects active dependency links.
`;

export const DeleteDependenciesParamsSchema = z.object({
  work_item_id: z
    .string()
    .uuid('The work_item_id must be a valid UUID.')
    .describe('Required. The UUID of the work item from which dependencies should be removed.'),
  depends_on_ids_to_remove: z
    .array(z.string().uuid('Each ID in depends_on_ids_to_remove must be a valid UUID.'))
    .min(1, 'At least one depends_on_work_item_id must be provided.')
    .max(50, 'Cannot remove more than 50 dependencies at once.')
    .describe("Required. An array of 'depends_on' work item IDs for the dependency links to remove."),
});

// Define the expected type for arguments based on the Zod schema
export type DeleteDependenciesArgs = z.infer<typeof DeleteDependenciesParamsSchema>;
