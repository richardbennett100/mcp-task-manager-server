import { Pool, PoolClient, QueryResult } from 'pg'; // Import Pool, PoolClient, QueryResult
import { logger } from '../utils/logger.js';

// Interfaces remain the same
export interface TaskData {
    task_id: string; // UUID
    project_id: string; // UUID
    parent_task_id?: string | null; // UUID or null
    description: string;
    status: 'todo' | 'in-progress' | 'review' | 'done';
    priority: 'high' | 'medium' | 'low';
    created_at: string; // ISO8601 String representation
    updated_at: string; // ISO8601 String representation
}

export interface DependencyData {
    task_id: string; // UUID
    depends_on_task_id: string; // UUID
}

// Helper function to map row data to TaskData, handling potential Date objects
function mapRowToTaskData(row: any): TaskData {
     return {
        task_id: row.task_id,
        project_id: row.project_id,
        parent_task_id: row.parent_task_id,
        description: row.description,
        status: row.status,
        priority: row.priority,
        created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    };
}


export class TaskRepository {
    private pool: Pool;

    constructor(pool: Pool) {
        this.pool = pool;
    }

    /**
     * Creates a new task and optionally its dependencies using a transaction. (Async)
     * @param task - The core task data to insert.
     * @param dependencies - An array of dependency task IDs for this task.
     * @throws {Error} If the database operation fails.
     */
    public async create(task: TaskData, dependencies: string[] = []): Promise<void> {
        const client: PoolClient = await this.pool.connect();
        logger.debug(`[TaskRepository] Starting transaction for creating task ${task.task_id}`);
        try {
            await client.query('BEGIN');

            const insertTaskSql = `
                INSERT INTO tasks (
                    task_id, project_id, parent_task_id, description,
                    status, priority, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `;
            const taskParams = [
                task.task_id, task.project_id, task.parent_task_id, task.description,
                task.status, task.priority, task.created_at, task.updated_at
            ];
            const taskInsertResult = await client.query(insertTaskSql, taskParams);
            // Checking rowCount against 1 is fine here, doesn't involve assignment/return type conflict
            if (taskInsertResult.rowCount !== 1) {
                 throw new Error(`Failed to insert task ${task.task_id}. Changes: ${taskInsertResult.rowCount ?? 'null'}`);
            }

            if (dependencies.length > 0) {
                const insertDepSql = `
                    INSERT INTO task_dependencies (task_id, depends_on_task_id)
                    VALUES ($1, $2)
                    ON CONFLICT(task_id, depends_on_task_id) DO NOTHING
                `;
                for (const depId of dependencies) {
                    await client.query(insertDepSql, [task.task_id, depId]);
                }
            }

            await client.query('COMMIT');
            logger.info(`[TaskRepository] Created task ${task.task_id} with ${dependencies.length} dependencies (Transaction committed).`);

        } catch (error: any) {
            logger.error(`[TaskRepository] Error in transaction for creating task ${task.task_id}, rolling back:`, error);
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError: any) {
                 logger.error(`[TaskRepository] Failed to rollback transaction:`, rollbackError);
                 // Decide how to handle nested errors, original error might be more important
            }
            throw error;
        } finally {
            client.release();
            logger.debug(`[TaskRepository] Released client after task creation attempt for ${task.task_id}`);
        }
    }

    /**
     * Finds tasks by project ID, optionally filtering by status. (Async)
     */
    public async findByProjectId(projectId: string, statusFilter?: TaskData['status']): Promise<TaskData[]> {
        let sql = `
            SELECT task_id, project_id, parent_task_id, description, status, priority, created_at, updated_at
            FROM tasks
            WHERE project_id = $1
        `;
        const params: (string | null)[] = [projectId];
        let paramIndex = 2;

        if (statusFilter) {
            sql += ` AND status = $${paramIndex}`;
            params.push(statusFilter);
            paramIndex++;
        }

        sql += ` ORDER BY created_at ASC`;

        try {
            const result: QueryResult = await this.pool.query(sql, params);
            logger.debug(`[TaskRepository] Found ${result.rows.length} tasks for project ${projectId} with status filter '${statusFilter || 'none'}'`);
            return result.rows.map(mapRowToTaskData);
        } catch (error: any) {
            logger.error(`[TaskRepository] Failed to find tasks for project ${projectId}:`, error);
            throw error;
        }
    }

    /**
     * Finds a single task by its ID and project ID. (Async)
     */
    public async findById(projectId: string, taskId: string): Promise<TaskData | undefined> {
        const sql = `
            SELECT task_id, project_id, parent_task_id, description, status, priority, created_at, updated_at
            FROM tasks
            WHERE project_id = $1 AND task_id = $2
        `;
        try {
            const result = await this.pool.query(sql, [projectId, taskId]);
            if (result.rows.length === 0) {
                logger.debug(`[TaskRepository] Task ${taskId} not found in project ${projectId}`);
                return undefined;
            }
            logger.debug(`[TaskRepository] Found task ${taskId} in project ${projectId}`);
            return mapRowToTaskData(result.rows[0]);
        } catch (error: any) {
            logger.error(`[TaskRepository] Failed to find task ${taskId} in project ${projectId}:`, error);
            throw error;
        }
    }

     /**
     * Finds the direct subtasks for a given parent task ID. (Async)
     */
    public async findSubtasks(parentTaskId: string): Promise<TaskData[]> {
        const sql = `
            SELECT task_id, project_id, parent_task_id, description, status, priority, created_at, updated_at
            FROM tasks
            WHERE parent_task_id = $1
            ORDER BY created_at ASC
        `;
        try {
            const result = await this.pool.query(sql, [parentTaskId]);
            logger.debug(`[TaskRepository] Found ${result.rows.length} subtasks for parent ${parentTaskId}`);
            return result.rows.map(mapRowToTaskData);
        } catch (error: any) {
            logger.error(`[TaskRepository] Failed to find subtasks for parent ${parentTaskId}:`, error);
            throw error;
        }
    }

    /**
     * Finds the IDs of tasks that the given task depends on. (Async)
     */
    public async findDependencies(taskId: string): Promise<string[]> {
        const sql = `SELECT depends_on_task_id FROM task_dependencies WHERE task_id = $1`;
        try {
            const result = await this.pool.query(sql, [taskId]);
            const dependencyIds = result.rows.map(row => row.depends_on_task_id);
            logger.debug(`[TaskRepository] Found ${dependencyIds.length} dependencies for task ${taskId}`);
            return dependencyIds;
        } catch (error: any) {
            logger.error(`[TaskRepository] Failed to find dependencies for task ${taskId}:`, error);
            throw error;
        }
    }

    /**
     * Updates the status and updated_at timestamp for a list of tasks within a project. (Async)
     */
    public async updateStatus(projectId: string, taskIds: string[], status: TaskData['status'], timestamp: string): Promise<number> {
        if (taskIds.length === 0) {
            return 0;
        }

        const placeholders = taskIds.map((_, i) => `$${i + 3}`).join(',');
        const sql = `
            UPDATE tasks
            SET status = $1, updated_at = $2
            WHERE project_id = $3 AND task_id IN (${placeholders})
        `;
        const params = [status, timestamp, projectId, ...taskIds];

        try {
            const result = await this.pool.query(sql, params);
            // Use '?? 0' for rowCount in log message
            logger.info(`[TaskRepository] Updated status for ${result.rowCount ?? 0} tasks in project ${projectId} to ${status}.`);
            // Use '?? 0' for rowCount in return value
            return result.rowCount ?? 0;
        } catch (error: any) {
            logger.error(`[TaskRepository] Failed to update status for tasks in project ${projectId}:`, error);
            throw error;
        }
    }

    /**
     * Checks if all provided task IDs exist within the specified project. (Async)
     */
     public async checkTasksExist(projectId: string, taskIds: string[]): Promise<{ allExist: boolean; missingIds: string[] }> {
        if (taskIds.length === 0) {
            return { allExist: true, missingIds: [] };
        }

        const placeholders = taskIds.map((_, i) => `$${i + 2}`).join(',');
        const sql = `
            SELECT task_id FROM tasks
            WHERE project_id = $1 AND task_id IN (${placeholders})
        `;
        const params = [projectId, ...taskIds];

        try {
            const result = await this.pool.query(sql, params);
            const foundIds = new Set(result.rows.map(t => t.task_id));
            const missingIds = taskIds.filter(id => !foundIds.has(id));
            const allExist = missingIds.length === 0;

            if (!allExist) {
                logger.warn(`[TaskRepository] Missing tasks in project ${projectId}:`, missingIds);
            }
            return { allExist, missingIds };

        } catch (error: any) {
            logger.error(`[TaskRepository] Failed to check task existence in project ${projectId}:`, error);
            throw error;
        }
    }


    /**
     * Deletes all direct subtasks of a given parent task. (Async)
     */
    public async deleteSubtasks(parentTaskId: string): Promise<number> {
        const sql = `DELETE FROM tasks WHERE parent_task_id = $1`;
        try {
            const result = await this.pool.query(sql, [parentTaskId]);
             // Use '?? 0' for rowCount in log message
            logger.info(`[TaskRepository] Deleted ${result.rowCount ?? 0} subtasks for parent ${parentTaskId}.`);
             // Use '?? 0' for rowCount in return value
            return result.rowCount ?? 0;
        } catch (error: any) {
            logger.error(`[TaskRepository] Failed to delete subtasks for parent ${parentTaskId}:`, error);
            throw error;
        }
    }

    /**
     * Finds tasks that are ready to be worked on. (Async)
     */
    public async findReadyTasks(projectId: string): Promise<TaskData[]> {
        const sql = `
            SELECT t.task_id, t.project_id, t.parent_task_id, t.description, t.status, t.priority, t.created_at, t.updated_at
            FROM tasks t
            WHERE t.project_id = $1 AND t.status = 'todo'
            AND NOT EXISTS (
                SELECT 1
                FROM task_dependencies td
                JOIN tasks dep_task ON td.depends_on_task_id = dep_task.task_id
                WHERE td.task_id = t.task_id AND dep_task.status != 'done'
            )
            ORDER BY
                CASE t.priority
                    WHEN 'high' THEN 1
                    WHEN 'medium' THEN 2
                    WHEN 'low' THEN 3
                    ELSE 4
                END ASC,
                t.created_at ASC
        `;
        try {
            const result = await this.pool.query(sql, [projectId]);
            logger.debug(`[TaskRepository] Found ${result.rows.length} ready tasks for project ${projectId}`);
            return result.rows.map(mapRowToTaskData);
        } catch (error: any) {
            logger.error(`[TaskRepository] Failed to find ready tasks for project ${projectId}:`, error);
            throw error;
        }
    }

    /**
     * Finds ALL tasks for a given project ID. (Async)
     */
    public async findAllTasksForProject(projectId: string): Promise<TaskData[]> {
        const sql = `
            SELECT task_id, project_id, parent_task_id, description, status, priority, created_at, updated_at
            FROM tasks
            WHERE project_id = $1
            ORDER BY created_at ASC
        `;
        try {
            const result = await this.pool.query(sql, [projectId]);
            logger.debug(`[TaskRepository] Found all ${result.rows.length} tasks for project ${projectId}`);
            return result.rows.map(mapRowToTaskData);
        } catch (error: any) {
            logger.error(`[TaskRepository] Failed to find all tasks for project ${projectId}:`, error);
            throw error;
        }
    }

     /**
     * Finds ALL dependencies for tasks within a given project ID. (Async)
     */
    public async findAllDependenciesForProject(projectId: string): Promise<DependencyData[]> {
        const sql = `
            SELECT td.task_id, td.depends_on_task_id
            FROM task_dependencies td
            JOIN tasks t ON td.task_id = t.task_id
            WHERE t.project_id = $1
        `;
        try {
            const result = await this.pool.query(sql, [projectId]);
            logger.debug(`[TaskRepository] Found ${result.rows.length} dependencies for project ${projectId}`);
            return result.rows;
        } catch (error: any) {
            logger.error(`[TaskRepository] Failed to find all dependencies for project ${projectId}:`, error);
            throw error;
        }
    }


    /**
     * Updates a task's description, priority, and/or dependencies using a transaction. (Async)
     */
    public async updateTask(
        projectId: string,
        taskId: string,
        updatePayload: { description?: string; priority?: TaskData['priority']; dependencies?: string[] },
        timestamp: string
    ): Promise<TaskData> {

        const client: PoolClient = await this.pool.connect();
        logger.debug(`[TaskRepository] Starting transaction for updating task ${taskId}`);
        try {
            await client.query('BEGIN');

            const setClauses: string[] = [];
            const params: (string | null)[] = [];
            let paramIndex = 1;

            if (updatePayload.description !== undefined) {
                setClauses.push(`description = $${paramIndex++}`);
                params.push(updatePayload.description);
            }
            if (updatePayload.priority !== undefined) {
                setClauses.push(`priority = $${paramIndex++}`);
                params.push(updatePayload.priority);
            }

            setClauses.push(`updated_at = $${paramIndex++}`);
            params.push(timestamp);

            const projectIdParamIndex = paramIndex++;
            const taskIdParamIndex = paramIndex++;
            params.push(projectId, taskId);

            if (setClauses.length > 1) {
                 const updateSql = `
                    UPDATE tasks
                    SET ${setClauses.join(', ')}
                    WHERE project_id = $${projectIdParamIndex} AND task_id = $${taskIdParamIndex}
                `;
                const updateResult = await client.query(updateSql, params);
                 // Check rowCount here too
                if (updateResult.rowCount !== 1) {
                    // Check existence using the *client* within the transaction
                    const existsCheckSql = `SELECT 1 FROM tasks WHERE project_id = $1 AND task_id = $2`;
                    const existsResult = await client.query(existsCheckSql, [projectId, taskId]);
                    if (existsResult.rows.length === 0) {
                         throw new Error(`Task ${taskId} not found in project ${projectId}.`);
                    } else {
                        throw new Error(`Failed to update task ${taskId}. Expected 1 change, got ${updateResult.rowCount ?? 'null'}.`);
                    }
                }
                logger.debug(`[TaskRepository] Updated task ${taskId} fields.`);
            } else {
                 logger.warn(`[TaskRepository] updateTask called for ${taskId} with no fields to update other than timestamp.`);
            }

            if (updatePayload.dependencies !== undefined) {
                const deleteDepsSql = `DELETE FROM task_dependencies WHERE task_id = $1`;
                const deleteInfo = await client.query(deleteDepsSql, [taskId]);
                logger.debug(`[TaskRepository] Deleted ${deleteInfo.rowCount ?? 0} existing dependencies for task ${taskId}.`);

                const newDeps = updatePayload.dependencies;
                if (newDeps.length > 0) {
                     const insertDepSql = `
                        INSERT INTO task_dependencies (task_id, depends_on_task_id)
                        VALUES ($1, $2)
                        ON CONFLICT(task_id, depends_on_task_id) DO NOTHING
                    `;
                    for (const depId of newDeps) {
                        await client.query(insertDepSql, [taskId, depId]);
                    }
                     logger.debug(`[TaskRepository] Inserted ${newDeps.length} new dependencies for task ${taskId}.`);
                }
            }

            await client.query('COMMIT');
            logger.info(`[TaskRepository] Successfully updated task ${taskId} (Transaction committed).`);

            const fetchSql = `SELECT * FROM tasks WHERE task_id = $1`;
            const fetchResult = await client.query(fetchSql, [taskId]);
             if (fetchResult.rows.length === 0) {
                 throw new Error(`Failed to retrieve updated task ${taskId} after update.`);
            }
            return mapRowToTaskData(fetchResult.rows[0]);

        } catch (error: any) {
            logger.error(`[TaskRepository] Failed transaction for updating task ${taskId}, rolling back:`, error);
             try {
                await client.query('ROLLBACK');
            } catch (rollbackError: any) {
                 logger.error(`[TaskRepository] Failed to rollback transaction:`, rollbackError);
            }
            throw error;
        } finally {
            client.release();
            logger.debug(`[TaskRepository] Released client after task update attempt for ${taskId}`);
        }
    }


    /**
     * Deletes multiple tasks by their IDs within a specific project. (Async)
     */
    public async deleteTasks(projectId: string, taskIds: string[]): Promise<number> {
        if (taskIds.length === 0) {
            return 0;
        }

        const placeholders = taskIds.map((_, i) => `$${i + 2}`).join(',');
        const sql = `
            DELETE FROM tasks
            WHERE project_id = $1 AND task_id IN (${placeholders})
        `;
        const params = [projectId, ...taskIds];

        try {
            const result = await this.pool.query(sql, params);
             // Use '?? 0' for rowCount in log message
            logger.info(`[TaskRepository] Deleted ${result.rowCount ?? 0} tasks from project ${projectId}.`);
            // Use '?? 0' for rowCount in return value
            return result.rowCount ?? 0;
        } catch (error: any) {
            logger.error(`[TaskRepository] Failed to delete tasks from project ${projectId}:`, error);
            throw error;
        }
    }
}