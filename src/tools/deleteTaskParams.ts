// src/tools/deleteTaskParams.ts
import { z } from 'zod';

export const TOOL_NAME = 'deleteTask'; // Keep familiar name

export const TOOL_DESCRIPTION = `
Marks one or more work items (projects, tasks, etc.) as 'deleted' (soft delete).
Requires an array of work item IDs to delete. Does not physically remove data.
Child items are NOT automatically deleted (unlike previous hard delete).
Returns the count of items successfully marked as deleted.
`;

// Zod schema for the parameters, adapted for work items
export const TOOL_PARAMS = z.object({
  // project_id removed
  work_item_ids: z // Renamed from task_ids
    .array(
      z
        .string()
        .uuid('Each work_item_id must be a valid UUID.')
        .describe('A unique identifier (UUID) of a work item to delete.')
    )
    .min(1, 'At least one work_item_id must be provided.')
    .max(100, 'Cannot delete more than 100 work items per call.')
    .describe('Required. An array of work item IDs (UUIDs, 1-100) to be marked as deleted.'),
});

// Define the expected type for arguments based on the Zod schema
export type DeleteTaskArgs = z.infer<typeof TOOL_PARAMS>;
