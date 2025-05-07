import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '../utils/index.js';

// Import tool registration functions
import { addTaskTool } from './add_task_tool.js';
import { listTasksTool } from './list_tasks_tool.js';
import { updateTaskTool } from './update_task_tool.js';
import { deleteTaskTool } from './delete_task_tool.js';
import { createProjectTool } from './create_project_tool.js';
import { deleteProjectTool } from './delete_project_tool.js';
import { undoLastActionTool } from './undo_last_action_tool.js';
import { redoLastActionTool } from './redo_last_action_tool.js';
import { listHistoryTool } from './list_history_tool.js';
import { addDependenciesTool } from './add_dependencies_tool.js';
import { deleteDependenciesTool } from './delete_dependencies_tool.js';
import { setStatusTool } from './set_status_tool.js';
import { setNameTool } from './set_name_tool.js';
import { setDescriptionTool } from './set_description_tool.js';
import { setPriorityTool } from './set_priority_tool.js';
import { setDueDateTool } from './set_due_date_tool.js';
import { moveItemToStartTool } from './move_item_to_start_tool.js';
import { moveItemToEndTool } from './move_item_to_end_tool.js';
import { moveItemAfterTool } from './move_item_after_tool.js';
import { moveItemBeforeTool } from './move_item_before_tool.js';
import { getFullTreeTool } from './get_full_tree_tool.js';
import { promoteToProjectTool } from './promote_to_project_tool.js';
import { getNextTaskTool } from './get_next_task_tool.js'; // NEW import

/**
 * Register all defined tools with the MCP server instance.
 */
export function registerTools(server: McpServer): void {
  logger.info('Registering tools...');

  try {
    createProjectTool(server);
    addTaskTool(server);
    listTasksTool(server);
    updateTaskTool(server); // To be deprecated
    deleteProjectTool(server);
    deleteTaskTool(server);
    undoLastActionTool(server);
    redoLastActionTool(server);
    listHistoryTool(server);
    addDependenciesTool(server);
    deleteDependenciesTool(server);
    setStatusTool(server);
    setNameTool(server);
    setDescriptionTool(server);
    setPriorityTool(server);
    setDueDateTool(server);
    moveItemToStartTool(server);
    moveItemToEndTool(server);
    moveItemAfterTool(server);
    moveItemBeforeTool(server);
    getFullTreeTool(server);
    promoteToProjectTool(server);
    getNextTaskTool(server); // NEW registration

    logger.info('All tools registered successfully.');
  } catch (error) {
    logger.error('Failed during synchronous tool registration:', error);
    console.error('Fallback console log: Failed during synchronous tool registration:', error);
    throw new Error(`Failed to register tools: ${error instanceof Error ? error.message : String(error)}`);
  }
}
