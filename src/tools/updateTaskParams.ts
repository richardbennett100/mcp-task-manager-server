// src/tools/updateTaskParams.ts
import { z } from 'zod';
// Note: TaskPriority and TaskStatus types are defined within WorkItemData now
// We might need to define the enums directly here or import WorkItemData if needed elsewhere

export const TOOL_NAME = 'updateTask'; // Keep familiar name

export const TOOL_DESCRIPTION = `
Updates specific details of an existing work item (project, task, etc.).
Requires the work_item_id of the item to update.
Allows updating name, description, parent, status (but not to 'deleted'), priority, due_date, order_key, shortname, and/or dependencies.
At least one optional field OR the dependencies array must be provided.
The dependencies array, if provided, completely replaces the existing dependencies for the item.
Returns the full details of the updated work item upon success.
`;

// Define the possible enum values directly or import from a shared location
const priorities = ['high', 'medium', 'low'] as const;
const updateableStatuses = ['todo', 'in-progress', 'review', 'done'] as const; // Excludes 'deleted'
const dependencyTypes = ['finish-to-start', 'linked'] as const;

// Base Zod schema without refinement - needed for server.tool registration
export const UPDATE_TASK_BASE_SCHEMA = z.object({
  // project_id removed
  work_item_id: z // Renamed from task_id
    .string()
    .uuid('The work_item_id must be a valid UUID.')
    .describe(
      'Required. The unique identifier (UUID) of the work item to update.'
    ),

  // Add other updatable fields as optional
  parent_work_item_id: z
    .string()
    .uuid('parent_work_item_id must be a valid UUID if provided.')
    .nullable()
    .optional()
    .describe(
      'Optional. The new parent work item ID. Set to null to make it a top-level project.'
    ),

  name: z
    .string()
    .min(1, 'Name cannot be empty if provided.')
    .max(255, 'Name cannot exceed 255 characters.')
    .optional()
    .describe(
      'Optional. The new name or title for the work item (1-255 characters).'
    ),

  description: z
    .string()
    .max(1024, 'Description cannot exceed 1024 characters.')
    .nullable() // Allow setting description to null
    .optional()
    .describe(
      'Optional. The new textual description for the work item (max 1024 characters).'
    ),

  priority: z
    .enum(priorities)
    .optional()
    .describe(
      "Optional. The new priority level ('high', 'medium', or 'low')."
    ),

  status: z
    .enum(updateableStatuses) // Use enum excluding 'deleted'
    .optional()
    .describe(
      "Optional. The new status ('todo', 'in-progress', 'review', 'done'). Use deleteTask tool to mark as deleted."
    ),

   due_date: z
     .string()
     .datetime({ message: 'Due date must be a valid ISO 8601 timestamp string if provided.'})
     .nullable() // Allow setting due date to null
     .optional()
     .describe('Optional. The new due date (ISO 8601 format) or null to remove it.'),

   order_key: z
     .string()
     .nullable() // Allow setting order key to null (though app logic might regenerate)
     .optional()
     .describe('Optional. Explicitly set the lexicographical order key (advanced use).'),

   shortname: z
     .string()
     .nullable() // Allow setting shortname to null
     .optional()
     .describe('Optional. Explicitly set the shortname (advanced use).'),

  // Updated dependencies structure
  dependencies: z
    .array(
      z.object({
        depends_on_work_item_id: z
          .string()
          .uuid('Each depends_on_work_item_id must be a valid UUID.'),
        dependency_type: z.enum(dependencyTypes).default('finish-to-start'),
      })
    )
    .max(50, 'A work item cannot have more than 50 dependencies.')
    .optional()
    .describe(
      'Optional. The complete list of dependencies. Replaces the existing list entirely. Max 50 dependencies.'
    ),
});

// Refined schema to ensure at least one field is being updated
export const TOOL_PARAMS = UPDATE_TASK_BASE_SCHEMA.refine(
  (data) =>
    data.parent_work_item_id !== undefined ||
    data.name !== undefined ||
    data.description !== undefined || // Check includes null assignment
    data.priority !== undefined ||
    data.status !== undefined ||
    data.due_date !== undefined || // Check includes null assignment
    data.order_key !== undefined || // Check includes null assignment
    data.shortname !== undefined || // Check includes null assignment
    data.dependencies !== undefined, // Updating dependencies is a valid operation
  {
    message:
      'At least one field to update (parent, name, description, priority, status, due_date, order_key, shortname) or the dependencies list must be provided.',
  }
);

// Define the expected type for arguments based on the *refined* Zod schema
export type UpdateTaskArgs = z.infer<typeof TOOL_PARAMS>;