// src/tools/set_priority_params.ts
import { z } from 'zod';
import { WorkItemPriorityEnum } from './add_task_params.js'; // Import the enum

export const TOOL_NAME = 'set_priority';

export const TOOL_DESCRIPTION = `Sets the priority of a specific work item.`;

export const SetPriorityParamsSchema = z.object({
  work_item_id: z
    .string()
    .uuid('The work_item_id must be a valid UUID.')
    .describe('Required. The UUID of the work item whose priority is to be set.'),
  priority: WorkItemPriorityEnum.describe("Required. The new priority ('high', 'medium', 'low')."),
});

// Define the expected type for arguments based on the Zod schema
export type SetPriorityArgs = z.infer<typeof SetPriorityParamsSchema>;
