// src/tools/list_work_items_params.ts
import { z } from 'zod';
import { WorkItemStatusEnum } from '../services/WorkItemServiceTypes.js'; // Import the Zod enum

export const TOOL_NAME = 'list_work_items';
export const TOOL_DESCRIPTION = `
Lists work items (projects or tasks) based on specified filters.
Returns an array of work items.
If no filters are provided, it may list all work items or apply default filters (e.g., only active items).
`;

export const ListWorkItemsParamsSchema = z.object({
  parent_work_item_id: z
    .string()
    .uuid({ message: 'Parent work item ID must be a valid UUID.' })
    // .nullable() // REMOVED to avoid Vertex AI anyOf issue
    .optional()
    .describe(
      'Optional. Filter by parent UUID. If omitted and roots_only is not true, it might list items under various parents or all items depending on other filters. To list root items, use roots_only: true or omit this field and ensure roots_only is not false.'
    ),
  roots_only: z
    .boolean()
    .optional()
    .describe(
      'Optional. If true, only root work items (typically projects) are returned. This is the primary way to list root items.'
    ),
  status: WorkItemStatusEnum.optional().describe(
    `Optional. Filter by status. Allowed values: ${WorkItemStatusEnum.options.join(', ')}.`
  ),
  is_active: z
    .boolean()
    .optional()
    .describe(
      'Optional. Filter by active status. If true, only active items. If false, only inactive. If omitted, the service default is applied (usually active items).'
    ),
});

export type ListWorkItemsArgs = z.infer<typeof ListWorkItemsParamsSchema>;
