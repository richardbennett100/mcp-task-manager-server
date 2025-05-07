// src/tools/redo_last_action_params.ts
import { z } from 'zod';

export const TOOL_NAME = 'redo_last_action';

export const TOOL_DESCRIPTION = `
Re-applies the last action that was undone using 'undo_last_action'.
Does not take any parameters.
Returns the details of the original action that was redone, or null if there was nothing to redo.
`;

// Zod schema: No parameters needed for this tool
export const RedoLastActionParamsSchema = z.object({});

// Define the expected type for arguments (empty object)
export type RedoLastActionArgs = z.infer<typeof RedoLastActionParamsSchema>;
