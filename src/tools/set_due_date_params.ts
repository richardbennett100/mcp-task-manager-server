// src/tools/set_due_date_params.ts
import { z } from 'zod';

export const TOOL_NAME = 'set_due_date';

export const TOOL_DESCRIPTION = `Sets or clears the due date of a specific work item.`;

export const SetDueDateParamsSchema = z.object({
  work_item_id: z
    .string()
    .uuid('The work_item_id must be a valid UUID.')
    .describe('Required. The UUID of the work item whose due date is to be set.'),
  due_date: z
    .string()
    .datetime({ message: 'Due date must be a valid ISO 8601 timestamp string if provided.' })
    .nullable() // Allows clearing the due date by passing null
    .describe('Required. The new due date (ISO 8601 format, e.g., "2025-12-31T23:59:59Z"), or null to clear it.'),
});

// Define the expected type for arguments based on the Zod schema
export type SetDueDateArgs = z.infer<typeof SetDueDateParamsSchema>;
