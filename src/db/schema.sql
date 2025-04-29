-- Database schema for the MCP Task Manager Server (Unified Work Items Model - PostgreSQL)
-- Includes schema for Action History and Undo/Redo functionality
-- Ensures DROPs don't fail if old tables/views are missing.

-- Drop views first
DROP VIEW IF EXISTS goals;
DROP VIEW IF EXISTS tasks;
DROP VIEW IF EXISTS projects;

-- Drop history tables first due to foreign key constraints
-- FIX: Added IF EXISTS
DROP TABLE IF EXISTS undo_steps CASCADE;
DROP TABLE IF EXISTS action_history CASCADE;

-- Drop work item tables and old dependency table
-- FIX: Added IF EXISTS
DROP TABLE IF EXISTS work_item_dependencies CASCADE;
DROP TABLE IF EXISTS task_dependencies CASCADE; -- Old table
DROP TABLE IF EXISTS work_items CASCADE;
DROP TABLE IF EXISTS tasks CASCADE; -- Old table
DROP TABLE IF EXISTS projects CASCADE; -- Old table


-- Ensure UUID extension is available (usually enabled by default, but good practice)
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table: work_items
-- NO 'IF NOT EXISTS' - Should be created after successful DROP
CREATE TABLE work_items (
    work_item_id UUID PRIMARY KEY NOT NULL,
    parent_work_item_id UUID NULL REFERENCES work_items(work_item_id) ON DELETE NO ACTION,
    name TEXT NOT NULL,
    shortname TEXT NULL,
    description TEXT NULL,
    status VARCHAR(20) NOT NULL CHECK(status IN ('todo', 'in-progress', 'review', 'done')),
    priority VARCHAR(10) NOT NULL CHECK(priority IN ('high', 'medium', 'low')),
    order_key TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    due_date TIMESTAMPTZ NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Table: work_item_dependencies
-- NO 'IF NOT EXISTS'
CREATE TABLE work_item_dependencies (
    work_item_id UUID NOT NULL REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    depends_on_work_item_id UUID NOT NULL REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    dependency_type VARCHAR(20) NOT NULL DEFAULT 'finish-to-start' CHECK(dependency_type IN ('finish-to-start', 'linked')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (work_item_id, depends_on_work_item_id)
);

-- Table: action_history
-- NO 'IF NOT EXISTS'
CREATE TABLE action_history (
    action_id UUID PRIMARY KEY NOT NULL,
    user_id TEXT NULL, -- Ensure TEXT type
    timestamp TIMESTAMPTZ NOT NULL,
    action_type VARCHAR(50) NOT NULL,
    work_item_id UUID NULL,
    description TEXT NULL,
    is_undone BOOLEAN NOT NULL DEFAULT FALSE,
    undone_at_action_id UUID NULL REFERENCES action_history(action_id) ON DELETE SET NULL
);

-- Table: undo_steps
-- NO 'IF NOT EXISTS'
CREATE TABLE undo_steps (
    undo_step_id UUID PRIMARY KEY NOT NULL,
    action_id UUID NOT NULL REFERENCES action_history(action_id) ON DELETE CASCADE,
    step_order INTEGER NOT NULL,
    step_type VARCHAR(20) NOT NULL CHECK(step_type IN ('INSERT', 'UPDATE', 'DELETE')),
    table_name VARCHAR(50) NOT NULL,
    record_id TEXT NOT NULL, -- Ensure TEXT type
    old_data JSONB NULL,
    new_data JSONB NULL
);

-- Indexes for performance optimization (Keep IF NOT EXISTS for indexes)

-- Indexes on work_items table
CREATE INDEX IF NOT EXISTS idx_work_items_parent_id ON work_items(parent_work_item_id);
CREATE INDEX IF NOT EXISTS idx_work_items_status ON work_items(status);
CREATE INDEX IF NOT EXISTS idx_work_items_priority ON work_items(priority);
CREATE INDEX IF NOT EXISTS idx_work_items_due_date ON work_items(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_order_key ON work_items(order_key) WHERE order_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_parent_order ON work_items(parent_work_item_id, order_key);
CREATE INDEX IF NOT EXISTS idx_work_items_is_active ON work_items(is_active);
CREATE INDEX IF NOT EXISTS idx_work_items_parent_active_order ON work_items(parent_work_item_id, is_active, order_key);


-- Indexes on work_item_dependencies table
CREATE INDEX IF NOT EXISTS idx_work_item_dependencies_depends_on ON work_item_dependencies(depends_on_work_item_id);
CREATE INDEX IF NOT EXISTS idx_work_item_dependencies_is_active ON work_item_dependencies(is_active);
CREATE INDEX IF NOT EXISTS idx_work_item_dependencies_active_work_item ON work_item_dependencies(work_item_id, is_active);
CREATE INDEX IF NOT EXISTS idx_work_item_dependencies_active_depends_on ON work_item_dependencies(depends_on_work_item_id, is_active);

-- Indexes on action_history table
CREATE INDEX IF NOT EXISTS idx_action_history_timestamp ON action_history(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_action_history_work_item_id ON action_history(work_item_id);
CREATE INDEX IF NOT EXISTS idx_action_history_is_undone ON action_history(is_undone);
CREATE INDEX IF NOT EXISTS idx_action_history_undone_at_action_id ON action_history(undone_at_action_id);
CREATE INDEX IF NOT EXISTS idx_action_history_action_type ON action_history(action_type);
CREATE INDEX IF NOT EXISTS idx_action_history_user_id ON action_history(user_id);


-- Indexes on undo_steps table
CREATE INDEX IF NOT EXISTS idx_undo_steps_action_id ON undo_steps(action_id);
CREATE INDEX IF NOT EXISTS idx_undo_steps_record_id ON undo_steps(record_id);
CREATE INDEX IF NOT EXISTS idx_undo_steps_action_order ON undo_steps(action_id, step_order);


-- Views for convenience (Keep IF EXISTS for DROP, use CREATE OR REPLACE VIEW)

-- View: projects (Top-level active items)
CREATE OR REPLACE VIEW projects AS
SELECT * FROM work_items
WHERE parent_work_item_id IS NULL
AND is_active = TRUE;

-- View: tasks (Non-top-level active items)
CREATE OR REPLACE VIEW tasks AS
SELECT * FROM work_items
WHERE parent_work_item_id IS NOT NULL
AND is_active = TRUE;

-- View: goals (Any active item with a due date)
CREATE OR REPLACE VIEW goals AS
SELECT * FROM work_items
WHERE due_date IS NOT NULL
AND is_active = TRUE;
