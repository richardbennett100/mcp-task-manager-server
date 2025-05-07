// src/tools/move_item_to_end_params.ts
import { z } from 'zod';

export const TOOL_NAME = 'move_item_to_end';

export const TOOL_DESCRIPTION = `Moves a specific work item to the end of its current sibling list.`;

export const MoveItemToEndParamsSchema = z.object({
  work_item_id: z
    .string()
    .uuid('The work_item_id must be a valid UUID.')
    .describe('Required. The UUID of the work item to move to the end.'),
});

export type MoveItemToEndArgs = z.infer<typeof MoveItemToEndParamsSchema>;
