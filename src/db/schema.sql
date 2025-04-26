-- Database schema for the MCP Task Manager Server (Unified Work Items Model - PostgreSQL)

-- Drop old tables and views first to ensure a clean slate (CASCADE removes dependent objects like indexes)
DROP VIEW IF EXISTS goals;
-- DROP VIEW IF EXISTS tasks; -- Removed
-- DROP VIEW IF EXISTS projects; -- REMOVED
DROP TABLE IF EXISTS task_dependencies CASCADE;
DROP TABLE IF EXISTS tasks CASCADE;
DROP TABLE IF EXISTS projects CASCADE; -- This drops the old projects table
DROP TABLE IF EXISTS work_item_dependencies CASCADE;
DROP TABLE IF EXISTS work_items CASCADE;


-- Ensure UUID extension is available (usually enabled by default, but good practice)
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table: work_items
CREATE TABLE IF NOT EXISTS work_items (
    work_item_id UUID PRIMARY KEY NOT NULL,
    parent_work_item_id UUID NULL REFERENCES work_items(work_item_id) ON DELETE NO ACTION,
    name TEXT NOT NULL,
    shortname TEXT NULL,
    description TEXT NULL,
    status VARCHAR(20) NOT NULL CHECK(status IN ('todo', 'in-progress', 'review', 'done', 'deleted')),
    priority VARCHAR(10) NOT NULL CHECK(priority IN ('high', 'medium', 'low')),
    order_key TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    due_date TIMESTAMPTZ NULL
);

-- Table: work_item_dependencies
CREATE TABLE IF NOT EXISTS work_item_dependencies (
    work_item_id UUID NOT NULL REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    depends_on_work_item_id UUID NOT NULL REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    dependency_type VARCHAR(20) NOT NULL DEFAULT 'finish-to-start' CHECK(dependency_type IN ('finish-to-start', 'linked')),
    PRIMARY KEY (work_item_id, depends_on_work_item_id)
);

-- Indexes on work_items table
CREATE INDEX IF NOT EXISTS idx_work_items_parent_id ON work_items(parent_work_item_id);
CREATE INDEX IF NOT EXISTS idx_work_items_status ON work_items(status);
CREATE INDEX IF NOT EXISTS idx_work_items_priority ON work_items(priority);
CREATE INDEX IF NOT EXISTS idx_work_items_due_date ON work_items(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_order_key ON work_items(order_key) WHERE order_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_parent_order ON work_items(parent_work_item_id, order_key);
-- CREATE INDEX IF NOT EXISTS idx_work_items_parent_shortname ON work_items(parent_work_item_id, shortname);


-- Indexes on work_item_dependencies table
CREATE INDEX IF NOT EXISTS idx_work_item_dependencies_depends_on ON work_item_dependencies(depends_on_work_item_id);

-- Views for convenience

-- View: projects (Top-level active items)
CREATE OR REPLACE VIEW projects AS
SELECT * FROM work_items
WHERE parent_work_item_id IS NULL
AND status != 'deleted';

-- View: tasks (Non-top-level active items)
CREATE OR REPLACE VIEW tasks AS
SELECT * FROM work_items
WHERE parent_work_item_id IS NOT NULL
AND status != 'deleted';

-- View: goals (Any active item with a due date - User choice Option A)
CREATE OR REPLACE VIEW goals AS
SELECT * FROM work_items
WHERE due_date IS NOT NULL
AND status != 'deleted';