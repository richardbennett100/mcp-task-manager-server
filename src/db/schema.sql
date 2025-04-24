-- Database schema for the MCP Task Manager Server (PostgreSQL)

-- Ensure UUID extension is available (usually enabled by default, but good practice)
-- Run this command manually in psql or via your DB tool if needed:
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table: projects
-- Stores project metadata
CREATE TABLE IF NOT EXISTS projects (
    project_id UUID PRIMARY KEY NOT NULL,
    name TEXT NOT NULL, -- TEXT is fine, or use VARCHAR(255)
    created_at TIMESTAMPTZ NOT NULL -- Timestamp with Time Zone
);

-- Table: tasks
-- Stores individual task details
CREATE TABLE IF NOT EXISTS tasks (
    task_id UUID PRIMARY KEY NOT NULL,
    project_id UUID NOT NULL,
    parent_task_id UUID NULL, -- For subtasks
    description TEXT NOT NULL,
    status VARCHAR(20) NOT NULL CHECK(status IN ('todo', 'in-progress', 'review', 'done')), -- VARCHAR is common for enums
    priority VARCHAR(10) NOT NULL CHECK(priority IN ('high', 'medium', 'low')),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
    FOREIGN KEY (parent_task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
);

-- Table: task_dependencies
-- Stores prerequisite relationships between tasks
CREATE TABLE IF NOT EXISTS task_dependencies (
    task_id UUID NOT NULL, -- The task that depends on another
    depends_on_task_id UUID NOT NULL, -- The task that must be completed first
    PRIMARY KEY (task_id, depends_on_task_id),
    FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE,
    FOREIGN KEY (depends_on_task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
);

-- Indexes for performance optimization (Syntax is largely compatible)

-- Index on tasks table
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
CREATE INDEX IF NOT EXISTS idx_tasks_parent_task_id ON tasks(parent_task_id); -- Index on NULLable column is fine
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);

-- Indexes on task_dependencies table
CREATE INDEX IF NOT EXISTS idx_task_dependencies_task_id ON task_dependencies(task_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on_task_id ON task_dependencies(depends_on_task_id);

-- Removed SQLite PRAGMA statements (foreign_keys = ON, journal_mode = WAL)
-- Foreign keys are enforced by default in PostgreSQL unless explicitly disabled.
-- Concurrency/WAL is handled differently and automatically by PostgreSQL.