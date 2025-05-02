// src/tools/addTaskParams.ts
import { z } from 'zod';

// Keep tool name familiar? Or rename to addWorkItem? Let's keep addTask for now.
export const TOOL_NAME = 'addTask';

export const TOOL_DESCRIPTION = `
Adds a new work item (e.g., project, task, goal) to the system.
Requires a name for the item.
Optionally accepts a parent_work_item_id (UUID) to make it a child item; if omitted or null, it becomes a top-level project.
Also accepts optional description, initial status, priority, due date, and dependencies.
Dependencies are specified as an array of objects, each containing the ID of the item it depends on and the dependency type ('finish-to-start' or 'linked').
Returns the full details of the newly created work item upon success.
`;

const WorkItemStatusEnum = z.enum(['todo', 'in-progress', 'review', 'done']);
const WorkItemPriorityEnum = z.enum(['high', 'medium', 'low']);
const DependencyTypeEnum = z.enum(['finish-to-start', 'linked']);

// Zod schema for the parameters, adapted for the unified work-item model
export const TOOL_PARAMS = z.object({
  // Project ID removed, replaced by optional parent ID
  parent_work_item_id: z
    .string()
    .uuid('parent_work_item_id must be a valid UUID if provided.')
    .nullable() // Allow null for root items
    .optional()
    .describe(
      'Optional. The unique identifier (UUID) of the parent work item. If omitted or null, the new item will be a top-level project.'
    ),

  name: z
    .string()
    .min(1, 'Work item name cannot be empty.')
    .max(255, 'Work item name cannot exceed 255 characters.') // Use same limit as old project name?
    .describe('Required. The primary name or title for the work item (1-255 characters).'),

  description: z
    .string()
    .max(1024, 'Description cannot exceed 1024 characters.')
    .optional()
    .nullable() // Allow null description
    .describe('Optional. A detailed description for the work item (max 1024 characters).'),

  // Dependencies now include type
  dependencies: z
    .array(
      z.object({
        depends_on_work_item_id: z.string().uuid('Each depends_on_work_item_id must be a valid UUID.'),
        dependency_type: DependencyTypeEnum.default('finish-to-start'), // Default type
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
    .nullable() // Allow null due date
    .describe('Optional due date for the work item in ISO 8601 format (e.g., "2025-12-31T23:59:59Z").'),

  // Allow optionally specifying order/shortname, though service will generate if omitted
  order_key: z.string().optional().nullable().describe('Optional explicit order key (advanced use).'),
  shortname: z.string().optional().nullable().describe('Optional explicit shortname (advanced use).'),
});

// Define the expected type for arguments based on the Zod schema
export type AddTaskArgs = z.infer<typeof TOOL_PARAMS>;
