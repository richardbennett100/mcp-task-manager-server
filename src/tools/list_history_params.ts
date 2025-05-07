// src/tools/list_history_params.ts
import { z } from 'zod';

export const TOOL_NAME = 'list_history';

export const TOOL_DESCRIPTION = `
Retrieves a list of recorded actions (history).
Optionally filters actions that occurred within a specific date/time range.
Returns a list of actions, each including the timestamp and a description.
`;

// Zod schema for the parameters
export const ListHistoryParamsSchema = z.object({
  start_date: z
    .string()
    .datetime({ message: 'start_date must be a valid ISO 8601 timestamp string if provided.' })
    .optional()
    .describe('Optional. The inclusive start date/time (ISO 8601 format) to filter history records.'),
  end_date: z
    .string()
    .datetime({ message: 'end_date must be a valid ISO 8601 timestamp string if provided.' })
    .optional()
    .describe('Optional. The inclusive end date/time (ISO 8601 format) to filter history records.'),
  limit: z
    .number()
    .int()
    .positive()
    .max(1000)
    .optional()
    .default(100)
    .describe('Optional. The maximum number of history records to return (default 100, max 1000).'),
});

// Define the expected type for arguments based on the Zod schema
export type ListHistoryArgs = z.infer<typeof ListHistoryParamsSchema>;

// Define the expected return structure for a single history item
export interface HistoryEntry {
  timestamp: string;
  description: string | null;
  // Optional: could include action_type or action_id if useful for agent
  // action_type: string;
}
