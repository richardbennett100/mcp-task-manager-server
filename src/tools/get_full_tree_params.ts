// src/tools/get_full_tree_params.ts
import { z } from 'zod';

export const TOOL_NAME = 'get_full_tree';

export const TOOL_DESCRIPTION = `
Retrieves a specific work item and its entire descendant hierarchy (children, grandchildren, etc.) recursively.
For each item in the tree, its direct dependencies and dependents are also included.
Allows options to include inactive items/dependencies and limit recursion depth.
`;

export const GetFullTreeParamsSchema = z.object({
  work_item_id: z
    .string()
    .uuid('The work_item_id must be a valid UUID.')
    .describe('Required. The UUID of the root work item for the tree to be fetched.'),
  options: z
    .object({
      include_inactive_items: z
        .boolean()
        .optional()
        .default(false)
        .describe('Optional. If true, inactive work items will be included in the tree. Default is false.'),
      include_inactive_dependencies: z
        .boolean()
        .optional()
        .default(false)
        .describe('Optional. If true, inactive dependency links will be included for each item. Default is false.'),
      max_depth: z
        .number()
        .int()
        .positive()
        .max(20) // Sensible upper limit for max_depth
        .optional()
        .default(10) // Default recursion depth
        .describe('Optional. Maximum depth of the descendant tree to fetch. Default is 10, Max is 20.'),
    })
    .optional()
    .describe('Optional. Options to control the tree retrieval.'),
});

export type GetFullTreeArgs = z.infer<typeof GetFullTreeParamsSchema>;
