// src/tools/undo_last_action_params.ts
import { z } from 'zod';

export const TOOL_NAME = 'undo_last_action';

export const TOOL_DESCRIPTION = `
Reverts the last performed data-modifying action (like add, delete, update, move, promote).
Does not take any parameters.
Returns the details of the original action that was undone, or null if there was nothing to undo.
`;

// Zod schema: No parameters needed for this tool
export const UndoLastActionParamsSchema = z.object({});

// Define the expected type for arguments (empty object)
export type UndoLastActionArgs = z.infer<typeof UndoLastActionParamsSchema>;
