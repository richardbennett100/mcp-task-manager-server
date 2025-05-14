// src/tools/import_project_params.ts
import { z } from 'zod';

export const TOOL_NAME = 'import_project';
export const TOOL_DESCRIPTION = `
Imports a project from a JSON string.
The JSON string should represent the project hierarchy, including its name, description, and any nested tasks with their details.
Returns the details of the newly created root project upon successful import.
`;

// Define a recursive schema for tasks within the project data for validation
// Making this any for now to simplify, full schema would be complex
// In a real scenario, this should be a well-defined Zod schema matching the expected import structure.
const ImportTaskNodeSchema: z.ZodTypeAny = z.lazy(
  () =>
    z
      .object({
        name: z.string().min(1).max(255),
        description: z.string().max(1024).optional(),
        status: z.enum(['todo', 'inprogress', 'done', 'blocked', 'pending']).optional(),
        priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
        due_date: z.string().datetime({ message: 'Due date must be a valid ISO 8601 date-time string.' }).optional(),
        children: z.array(ImportTaskNodeSchema).optional(),
        // Note: Dependencies are complex for direct import, might be a separate step or simplified.
      })
      .passthrough() // Allow other fields that might exist in the import data
);

export const ImportProjectParamsSchema = z.object({
  project_data_json: z
    .string()
    .describe(
      'Required. A JSON string representing the project structure to import. Must include at least a project name.'
    ),
  // An alternative could be to directly expect the object:
  // project_data: z.object({
  //   name: z.string().min(1).max(255),
  //   description: z.string().max(1024).optional(),
  //   children: z.array(ImportTaskNodeSchema).optional(),
  //   // ... other project-level fields
  // }).describe('Required. The project data structure to import.'),
});

export type ImportProjectArgs = z.infer<typeof ImportProjectParamsSchema>;
