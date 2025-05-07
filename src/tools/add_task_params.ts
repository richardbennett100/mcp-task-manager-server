// src/tools/add_task_params.ts
import { z } from 'zod';

export const TOOL_NAME = 'add_task';

export const TOOL_DESCRIPTION = `
Adds a new work item (task, sub-task, etc.) as a child of an existing work item.
Requires the parent_work_item_id (UUID) and a name for the item.
Also accepts optional description, initial status, priority, due date, and dependencies.
Optionally specify the desired position within the parent using ONE of: insertAt ('start' or 'end'), insertAfter_work_item_id, or insertBefore_work_item_id. If no position is specified, it defaults to the end.
Returns the full details of the newly created work item upon success.
Use 'create_project' to create top-level items.
`;

export const WorkItemStatusEnum = z.enum(['todo', 'in-progress', 'review', 'done']);
export const WorkItemPriorityEnum = z.enum(['high', 'medium', 'low']); // Ensure this is exported
const DependencyTypeEnum = z.enum(['finish-to-start', 'linked']);
const InsertPositionEnum = z.enum(['start', 'end']);

// Base schema - parent_work_item_id is now required
export const AddTaskBaseSchema = z.object({
  parent_work_item_id: z
    .string()
    .uuid('parent_work_item_id must be a valid UUID.')
    .describe('Required. The unique identifier (UUID) of the parent work item.'),

  name: z
    .string()
    .min(1, 'Work item name cannot be empty.')
    .max(255, 'Work item name cannot exceed 255 characters.')
    .describe('Required. The primary name or title for the work item (1-255 characters).'),

  description: z
    .string()
    .max(1024, 'Description cannot exceed 1024 characters.')
    .optional()
    .nullable()
    .describe('Optional. A detailed description for the work item (max 1024 characters).'),

  dependencies: z
    .array(
      z.object({
        depends_on_work_item_id: z.string().uuid('Each depends_on_work_item_id must be a valid UUID.'),
        dependency_type: DependencyTypeEnum.default('finish-to-start'),
      })
    )
    .max(50, 'A work item cannot have more than 50 dependencies.')
    .optional()
    .describe(
      "Optional list of dependencies (max 50). Each dependency specifies the ID it depends on and the type ('finish-to-start' or 'linked')."
    ),

  priority: WorkItemPriorityEnum.optional()
    .default('medium')
    .describe("Optional work item priority. Defaults to 'medium' if not specified."),

  status: WorkItemStatusEnum.optional()
    .default('todo')
    .describe("Optional initial status of the work item. Defaults to 'todo' if not specified."),

  due_date: z
    .string()
    .datetime({
      message: 'Due date must be a valid ISO 8601 timestamp string.',
    })
    .optional()
    .nullable()
    .describe('Optional due date for the work item in ISO 8601 format (e.g., "2025-12-31T23:59:59Z").'),

  insertAt: InsertPositionEnum.optional().describe("Optional. Insert at the 'start' or 'end' of the sibling list."),
  insertAfter_work_item_id: z
    .string()
    .uuid('insertAfter_work_item_id must be a valid UUID.')
    .optional()
    .describe('Optional. Insert the new item immediately after the item with this ID.'),
  insertBefore_work_item_id: z
    .string()
    .uuid('insertBefore_work_item_id must be a valid UUID.')
    .optional()
    .describe('Optional. Insert the new item immediately before the item with this ID.'),
});

export const TOOL_PARAMS = AddTaskBaseSchema.superRefine((data, ctx) => {
  const positioningParams = [data.insertAt, data.insertAfter_work_item_id, data.insertBefore_work_item_id].filter(
    (p) => p !== undefined
  );

  if (positioningParams.length > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'Provide only one positioning parameter: insertAt, insertAfter_work_item_id, or insertBefore_work_item_id.',
    });
  }
});

export type AddTaskArgs = z.infer<typeof TOOL_PARAMS>;
