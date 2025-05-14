// src/tools/get_details_params.ts
import { z } from 'zod';

export const TOOL_NAME = 'get_details'; // Renamed from get_work_item_details
export const TOOL_DESCRIPTION = `
Retrieves the full details for a specific work item (project or task) by its UUID.
This includes its direct properties, dependencies, dependents, and direct children.
`;

// Schema name updated for clarity, though not strictly necessary if type name is different
export const GetDetailsParamsSchema = z.object({
  work_item_id: z
    .string()
    .uuid({ message: 'Work item ID must be a valid UUID.' })
    .describe('Required. The UUID of the work item to retrieve.'),
  // Optional: Add flags to control what details are returned, e.g., include_children, include_dependencies
  // For now, it will return FullWorkItemData by default.
});

export type GetDetailsArgs = z.infer<typeof GetDetailsParamsSchema>;
