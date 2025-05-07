// src/tools/get_next_task_params.ts
import { z } from 'zod';
// No import from './common_params.js' needed

/**
 * Parameters for the get_next_task tool.
 * All parameters are optional.
 */
export const GetNextTaskParamsSchema = z.object({
  scope_item_id: z // Defined inline
    .string()
    .uuid({ message: 'scope_item_id must be a valid UUID.' })
    .optional()
    .describe(
      'Optional. If provided, scope the task search to this specific work item and its descendants (its sub-tree). Otherwise, searches across all tasks.'
    ),
  include_tags: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Optional. If provided, suggests tasks that include ALL of the specified tags. E.g., ["frontend", "bug"]. Assumes tags are case-sensitive unless a system-wide convention is adopted (e.g., lowercase).'
    ),
  exclude_tags: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Optional. If provided, suggests tasks that do NOT include ANY of the specified tags. E.g., ["on-hold", "meeting"]. Processed after include_tags.'
    ),
  current_date_override: z
    .string()
    .datetime({ message: 'current_date_override must be a valid ISO 8601 date string' })
    .optional()
    .describe(
      'Optional. Overrides the current system time for evaluating due dates. Primarily for testing and advanced agent scenarios. Defaults to the actual current time.'
    ),
});

export type GetNextTaskParams = z.infer<typeof GetNextTaskParamsSchema>;
