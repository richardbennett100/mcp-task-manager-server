import { Pool, QueryResult } from 'pg'; // Import Pool and QueryResult from pg
import { logger } from '../utils/logger.js';

// Interface remains the same
export interface ProjectData {
    project_id: string; // Should match UUID type in schema
    name: string;
    created_at: string; // Will be string representation of TIMESTAMPTZ
}

export class ProjectRepository {
    // Store the pg Pool instance
    private pool: Pool;

    // Accept the Pool instance via the constructor
    constructor(pool: Pool) {
        this.pool = pool;
    }

    /**
     * Creates a new project record in the database. (Async)
     * @param project - The project data to insert.
     * @throws {Error} If the database operation fails.
     */
    public async create(project: ProjectData): Promise<void> {
        const sql = `
            INSERT INTO projects (project_id, name, created_at)
            VALUES ($1, $2, $3)
        `;
        // Parameters are passed as an array
        const params = [project.project_id, project.name, project.created_at];
        try {
            const result: QueryResult = await this.pool.query(sql, params);
            // Check if exactly one row was inserted
            if (result.rowCount !== 1) {
                // This might indicate an issue, though INSERT should usually insert 1 or throw error
                 logger.warn(`[ProjectRepository] Expected 1 row change, but got ${result.rowCount} for project ${project.project_id}`);
                 // Consider throwing an error if rowCount is not 1
                 // throw new Error(`Failed to insert project ${project.project_id}. Row count: ${result.rowCount}`);
            }
            logger.info(`[ProjectRepository] Created project ${project.project_id}, rowCount: ${result.rowCount}`);
        } catch (error: any) {
            logger.error(`[ProjectRepository] Failed to create project ${project.project_id}:`, {
                error: error.message,
                stack: error.stack,
                code: error.code // PG error code
            });
            // Re-throw the error to be handled by the service layer
            throw error;
        }
    }

    /**
     * Finds a project by its ID. (Async)
     * @param projectId - The ID of the project to find.
     * @returns The project data if found, otherwise undefined.
     */
    public async findById(projectId: string): Promise<ProjectData | undefined> {
        const sql = `SELECT project_id, name, created_at FROM projects WHERE project_id = $1`;
        try {
            const result: QueryResult = await this.pool.query(sql, [projectId]);
            // Check if any rows were returned
            if (result.rows.length === 0) {
                return undefined; // Not found
            }
            // pg driver might return Date objects for TIMESTAMPTZ, adjust mapping if needed
            // Assuming ProjectData expects string timestamps for now
            const row = result.rows[0];
            return {
                 project_id: row.project_id,
                 name: row.name,
                 // Convert Date object back to ISO string if necessary
                 created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
            };
        } catch (error: any) {
            logger.error(`[ProjectRepository] Failed to find project ${projectId}:`, {
                error: error.message,
                stack: error.stack,
                code: error.code
            });
            throw error; // Re-throw
        }
    }

    /**
     * Deletes a project by its ID. (Async)
     * Relies on ON DELETE CASCADE in the schema to remove associated tasks/dependencies.
     * @param projectId - The ID of the project to delete.
     * @returns The number of projects deleted (0 or 1).
     * @throws {Error} If the database operation fails.
     */
    public async deleteProject(projectId: string): Promise<number> {
        const sql = `DELETE FROM projects WHERE project_id = $1`;
        try {
            const result: QueryResult = await this.pool.query(sql, [projectId]);
            logger.info(`[ProjectRepository] Attempted to delete project ${projectId}. Rows affected: ${result.rowCount}`);
            // Cascade delete handles tasks/dependencies in the background via schema definition.
            return result.rowCount; // Returns the number of rows deleted
        } catch (error: any) {
            logger.error(`[ProjectRepository] Failed to delete project ${projectId}:`, {
                error: error.message,
                stack: error.stack,
                code: error.code
            });
            throw error; // Re-throw
        }
    }
    // Add other methods as needed (e.g., update, list) adapting similarly
}