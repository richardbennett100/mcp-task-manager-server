// src/tools/set_status_params.ts
import { z } from 'zod';

export const TOOL_NAME = 'set_status';

export const TOOL_DESCRIPTION = `Sets the status of a specific work item.`;

const WorkItemStatusEnum = z.enum(['todo', 'in-progress', 'review', 'done']);

export const SetStatusParamsSchema = z.object({
  work_item_id: z
    .string()
    .uuid('The work_item_id must be a valid UUID.')
    .describe('Required. The UUID of the work item whose status is to be set.'),
  status: WorkItemStatusEnum.describe("Required. The new status ('todo', 'in-progress', 'review', 'done')."),
});

// Define the expected type for arguments based on the Zod schema
export type SetStatusArgs = z.infer<typeof SetStatusParamsSchema>;
