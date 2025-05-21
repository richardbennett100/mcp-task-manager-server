// upload/src/tools/add_child_tasks_params.ts
import { z } from 'zod';
// These enums are directly used in the ChildTaskDataBaseSchema via .nullish()
import { WorkItemStatusEnum, WorkItemPriorityEnum } from '../services/WorkItemServiceTypes.js';

export const TOOL_NAME = 'add_child_tasks';
export const TOOL_DESCRIPTION = `
Adds a hierarchy of one or more child tasks (a tree structure) under a specified parent work item.
Each task in the tree must have a name. Optional fields for each task include: description, status, priority, due_date, and its own 'children' array for further nesting.
All tasks in the provided tree will be created under the given parent_work_item_id.
The order of tasks at each level will be preserved as provided in the input arrays.
Returns a flat array of all successfully created work item objects (including all descendants).
`;

const ChildTaskDataBaseSchema = z.object({
  name: z
    .string()
    .min(1, 'Child task name cannot be empty.')
    .max(255, 'Child task name cannot exceed 255 characters.')
    .describe('Required. The name for the child task.'),
  description: z
    .string()
    .max(1024, 'Child task description cannot exceed 1024 characters.')
    .nullish()
    .describe('Optional. Description for the child task.'),
  status: WorkItemStatusEnum.nullish().describe(
    // Direct usage of imported Zod enum
    `Optional. Status. Allowed: ${WorkItemStatusEnum.options.join(', ')}. Defaults to service default (likely 'todo').`
  ),
  priority: WorkItemPriorityEnum.nullish().describe(
    // Direct usage of imported Zod enum
    `Optional. Priority. Allowed: ${WorkItemPriorityEnum.options.join(', ')}. Defaults to service default (likely 'medium').`
  ),
  due_date: z
    .string()
    .datetime({ message: 'Due date must be a valid ISO 8601 date-time string.' })
    .nullish()
    .describe('Optional. Due date for the child task in ISO 8601 format or null.'),
});

export type ChildTaskInputRecursive = z.infer<typeof ChildTaskDataBaseSchema> & {
  children?: ChildTaskInputRecursive[];
};

const ChildTaskInputSchema: z.ZodType<ChildTaskInputRecursive> = ChildTaskDataBaseSchema.extend({
  children: z
    .lazy(() => z.array(ChildTaskInputSchema))
    .optional()
    .describe('Optional. An array of sub-tasks for this task, allowing for nested creation.'),
});

export const AddChildTasksBaseSchema = z.object({
  parent_work_item_id: z
    .string()
    .uuid({ message: 'Parent work item ID must be a valid UUID.' })
    .describe('Required. The UUID of the parent project or task for the new child tasks tree.'),
  child_tasks_tree: z
    .array(ChildTaskInputSchema)
    .min(1, { message: 'At least one child task/tree structure must be provided.' })
    .describe('Required. An array of child task objects, which can themselves contain children to define a tree.'),
});

export const AddChildTasksParamsSchema = AddChildTasksBaseSchema;

export type AddChildTasksArgs = z.infer<typeof AddChildTasksParamsSchema>;
