// src/tools/set_name_params.ts
import { z } from 'zod';

export const TOOL_NAME = 'set_name';

export const TOOL_DESCRIPTION = `Sets the name of a specific work item. This will also regenerate the item's shortname.`;

export const SetNameParamsSchema = z.object({
  work_item_id: z
    .string()
    .uuid('The work_item_id must be a valid UUID.')
    .describe('Required. The UUID of the work item whose name is to be set.'),
  name: z
    .string()
    .min(1, 'Name cannot be empty.')
    .max(255, 'Name cannot exceed 255 characters.')
    .describe('Required. The new name for the work item (1-255 characters).'),
});

// Define the expected type for arguments based on the Zod schema
export type SetNameArgs = z.infer<typeof SetNameParamsSchema>;
