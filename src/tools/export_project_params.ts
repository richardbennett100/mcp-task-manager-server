// src/tools/export_project_params.ts
import { z } from 'zod';

export const TOOL_NAME = 'export_project';
export const TOOL_DESCRIPTION = `
Exports a specified project and its entire descendant hierarchy as a JSON string.
Includes tasks, sub-tasks, and their properties.
`;

export const ExportProjectParamsSchema = z.object({
  project_id: z
    .string()
    .uuid({ message: 'Project ID must be a valid UUID.' })
    .describe('Required. The UUID of the project to export.'),
  // format: z.enum(['json']) // Currently only JSON is planned
  //   .optional()
  //   .default('json')
  //   .describe("Optional. The format for the export. Defaults to 'json'. Currently only 'json' is supported."),
});

export type ExportProjectArgs = z.infer<typeof ExportProjectParamsSchema>;
