// src/tools/add_child_tasks_params.ts
import { z } from 'zod';

export const TOOL_NAME = 'add_child_tasks';
export const TOOL_DESCRIPTION = `
Adds multiple child tasks to a specified parent work item.
Each child task must have a name, and can optionally have a description, status, priority, and due date.
Returns an array of the created child task details or a summary of the operation.
`;

// Enums aligned with the TypeScript error messages for AddWorkItemInput
const ValidStatusForNewTaskSchema = z.enum(['todo', 'in-progress', 'review', 'done']);
const ValidPriorityForNewTaskSchema = z.enum(['low', 'medium', 'high']);

const ChildTaskInputSchema = z.object({
  name: z
    .string()
    .min(1, 'Child task name cannot be empty.')
    .max(255, 'Child task name cannot exceed 255 characters.')
    .describe('Required. The name for the child task.'),
  description: z
    .string()
    .max(1024, 'Child task description cannot exceed 1024 characters.')
    .optional()
    .describe('Optional. Description for the child task.'),
  status: ValidStatusForNewTaskSchema.optional().describe(
    `Optional. Status for the child task. Allowed: ${ValidStatusForNewTaskSchema.options.join(', ')}. Defaults to service default (likely 'todo').`
  ),
  priority: ValidPriorityForNewTaskSchema.optional().describe(
    `Optional. Priority for the child task. Allowed: ${ValidPriorityForNewTaskSchema.options.join(', ')}. Defaults to service default (likely 'medium').`
  ),
  due_date: z
    .string()
    .datetime({ message: 'Due date must be a valid ISO 8601 date-time string.' })
    .optional() // Removed .nullable() for Vertex AI compatibility
    .describe('Optional. Due date for the child task in ISO 8601 format.'),
});

export const AddChildTasksParamsSchema = z.object({
  parent_work_item_id: z
    .string()
    .uuid({ message: 'Parent work item ID must be a valid UUID.' })
    .describe('Required. The UUID of the parent project or task for the new child tasks.'),
  child_tasks: z
    .array(ChildTaskInputSchema)
    .min(1, { message: 'At least one child task must be provided.' })
    .describe('Required. An array of child task objects to create.'),
});

export type AddChildTasksArgs = z.infer<typeof AddChildTasksParamsSchema>;
