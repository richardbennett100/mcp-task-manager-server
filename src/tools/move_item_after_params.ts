// src/tools/move_item_after_params.ts
import { z } from 'zod';

export const TOOL_NAME = 'move_item_after';

export const TOOL_DESCRIPTION = `Moves a specific work item to be immediately after another specified sibling work item.`;

export const MoveItemAfterParamsSchema = z.object({
  work_item_id_to_move: z
    .string()
    .uuid('The work_item_id_to_move must be a valid UUID.')
    .describe('Required. The UUID of the work item to be moved.'),
  target_sibling_id_to_move_after: z
    .string()
    .uuid('The target_sibling_id_to_move_after must be a valid UUID.')
    .describe('Required. The UUID of the sibling work item that the item_to_move will be placed after.'),
});

export type MoveItemAfterArgs = z.infer<typeof MoveItemAfterParamsSchema>;
