// src/tools/update_task_params.ts
import { z } from 'zod';

export const TOOL_NAME = 'update_task'; // Renamed (Will be replaced by granular tools later)

export const TOOL_DESCRIPTION = `
[DEPRECATED - Use granular tools like set_name, add_dependencies, etc.] Updates specific details of an existing work item (project, task, etc.).
Requires the work_item_id of the item to update.
Allows updating name, description, parent, status (but not to 'deleted'), priority, due_date, and/or dependencies.
Optionally allows specifying a new position using ONE of: moveTo ('start' or 'end'), moveAfter_work_item_id, or moveBefore_work_item_id.
At least one optional field OR a positioning parameter OR the dependencies array must be provided.
The dependencies array, if provided, completely replaces the existing dependencies for the item.
Returns the full details of the updated work item upon success.
`;

const priorities = ['high', 'medium', 'low'] as const;
const updateableStatuses = ['todo', 'in-progress', 'review', 'done'] as const;
const dependencyTypes = ['finish-to-start', 'linked'] as const;
const MovePositionEnum = z.enum(['start', 'end']); // Similar to InsertPositionEnum

// Base Zod schema - Add export and new move parameters
export const UPDATE_TASK_BASE_SCHEMA = z.object({
  work_item_id: z
    .string()
    .uuid('The work_item_id must be a valid UUID.')
    .describe('Required. The unique identifier (UUID) of the work item to update.'),

  // Other updatable fields
  parent_work_item_id: z
    .string()
    .uuid('parent_work_item_id must be a valid UUID if provided.')
    .optional()
    .describe(
      'Optional. The new parent work item ID. Set to null to make it a top-level project. Requires recalculating order.'
    ),

  name: z
    .string()
    .min(1, 'Name cannot be empty if provided.')
    .max(255, 'Name cannot exceed 255 characters.')
    .optional()
    .describe('Optional. The new name or title for the work item (1-255 characters).'),

  description: z
    .string()
    .max(1024, 'Description cannot exceed 1024 characters.')
    .optional()
    .describe('Optional. The new textual description for the work item (max 1024 characters).'),

  priority: z.enum(priorities).optional().describe("Optional. The new priority level ('high', 'medium', or 'low')."),

  status: z
    .enum(updateableStatuses)
    .optional()
    .describe("Optional. The new status ('todo', 'in-progress', 'review', 'done')."),

  due_date: z
    .string()
    .datetime({ message: 'Due date must be a valid ISO 8601 timestamp string if provided.' })
    .optional()
    .describe('Optional. The new due date (ISO 8601 format) or null to remove it.'),

  dependencies: z
    .array(
      z.object({
        depends_on_work_item_id: z.string().uuid('Each depends_on_work_item_id must be a valid UUID.'),
        dependency_type: z.enum(dependencyTypes).default('finish-to-start'),
      })
    )
    .max(50, 'A work item cannot have more than 50 dependencies.')
    .optional()
    .describe('Optional. The complete list of dependencies. Replaces the existing list entirely. Max 50 dependencies.'),

  // --- New Optional Positioning Params ---
  moveTo: MovePositionEnum.optional().describe("Optional. Move to the 'start' or 'end' of the sibling list."),
  moveAfter_work_item_id: z
    .string()
    .uuid('moveAfter_work_item_id must be a valid UUID.')
    .optional()
    .describe('Optional. Move the item immediately after the item with this ID.'),
  moveBefore_work_item_id: z
    .string()
    .uuid('moveBefore_work_item_id must be a valid UUID.')
    .optional()
    .describe('Optional. Move the item immediately before the item with this ID.'),

  // Removed order_key and shortname - position handled by move params now
});

// Refined schema to ensure at least one update action is requested
// AND only one positioning parameter is used.
export const TOOL_PARAMS = UPDATE_TASK_BASE_SCHEMA.superRefine((data, ctx) => {
  // Check if at least one updatable field (excluding IDs and position controls) is present
  const hasUpdateField =
    data.parent_work_item_id !== undefined ||
    data.name !== undefined ||
    data.description !== undefined ||
    data.priority !== undefined ||
    data.status !== undefined ||
    data.due_date !== undefined ||
    data.dependencies !== undefined;

  // Check positioning parameters
  const positioningParams = [data.moveTo, data.moveAfter_work_item_id, data.moveBefore_work_item_id].filter(
    (p) => p !== undefined
  );
  const hasPositioningParam = positioningParams.length > 0;

  // Ensure at least one update or positioning action is requested
  if (!hasUpdateField && !hasPositioningParam) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'At least one field to update (parent, name, description, priority, status, due_date, dependencies) or a positioning parameter (moveTo, moveAfter_work_item_id, moveBefore_work_item_id) must be provided.',
    });
  }

  // Ensure only one positioning parameter is used
  if (positioningParams.length > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide only one positioning parameter: moveTo, moveAfter_work_item_id, or moveBefore_work_item_id.',
    });
  }
});

// Define the expected type for arguments based on the *refined* Zod schema
export type UpdateTaskArgs = z.infer<typeof TOOL_PARAMS>; // Keep type name for now
