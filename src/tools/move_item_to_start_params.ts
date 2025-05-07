// src/tools/move_item_to_start_params.ts
import { z } from 'zod';

export const TOOL_NAME = 'move_item_to_start';

export const TOOL_DESCRIPTION = `Moves a specific work item to the beginning of its current sibling list.`;

export const MoveItemToStartParamsSchema = z.object({
  work_item_id: z
    .string()
    .uuid('The work_item_id must be a valid UUID.')
    .describe('Required. The UUID of the work item to move to the start.'),
});

export type MoveItemToStartArgs = z.infer<typeof MoveItemToStartParamsSchema>;
