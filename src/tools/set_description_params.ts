// src/tools/set_description_params.ts
import { z } from 'zod';

export const TOOL_NAME = 'set_description';

export const TOOL_DESCRIPTION = `Sets or clears the description of a specific work item.`;

export const SetDescriptionParamsSchema = z.object({
  work_item_id: z
    .string()
    .uuid('The work_item_id must be a valid UUID.')
    .describe('Required. The UUID of the work item whose description is to be set.'),
  description: z
    .string()
    .max(1024, 'Description cannot exceed 1024 characters.')
    .describe('Required. The new description for the work item (max 1024 characters), or null to clear it.'),
});

// Define the expected type for arguments based on the Zod schema
export type SetDescriptionArgs = z.infer<typeof SetDescriptionParamsSchema>;
