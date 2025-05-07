// src/tools/move_item_before_params.ts
import { z } from 'zod';

export const TOOL_NAME = 'move_item_before';

export const TOOL_DESCRIPTION = `Moves a specific work item to be immediately before another specified sibling work item.`;

export const MoveItemBeforeParamsSchema = z.object({
  work_item_id_to_move: z
    .string()
    .uuid('The work_item_id_to_move must be a valid UUID.')
    .describe('Required. The UUID of the work item to be moved.'),
  target_sibling_id_to_move_before: z
    .string()
    .uuid('The target_sibling_id_to_move_before must be a valid UUID.')
    .describe('Required. The UUID of the sibling work item that the item_to_move will be placed before.'),
});

export type MoveItemBeforeArgs = z.infer<typeof MoveItemBeforeParamsSchema>;
