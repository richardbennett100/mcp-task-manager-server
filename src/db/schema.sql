-- src/db/schema.sql
-- Database schema for the MCP Task Manager Server (Unified Work Items Model - PostgreSQL)
-- Includes schema for Action History and Undo/Redo functionality
-- Includes Audit Logging functionality.
-- Ensures DROPs don't fail if old tables/views are missing.

-- Drop views first
DROP VIEW IF EXISTS goals;
DROP VIEW IF EXISTS tasks;
DROP VIEW IF EXISTS projects;

-- Drop triggers first, as they depend on the function
-- Drop triggers for work_items
DROP TRIGGER IF EXISTS work_items_audit_trigger ON work_items;
DROP TRIGGER IF EXISTS work_items_insert_audit_trigger ON work_items;
DROP TRIGGER IF EXISTS work_items_delete_audit_trigger ON work_items;
-- Drop triggers for work_item_dependencies
DROP TRIGGER IF EXISTS work_item_dependencies_audit_trigger ON work_item_dependencies;
DROP TRIGGER IF EXISTS work_item_dependencies_insert_audit_trigger ON work_item_dependencies;
DROP TRIGGER IF EXISTS work_item_dependencies_delete_audit_trigger ON work_item_dependencies;
-- Drop triggers for action_history
DROP TRIGGER IF EXISTS action_history_audit_trigger ON action_history;
DROP TRIGGER IF EXISTS action_history_insert_audit_trigger ON action_history;
DROP TRIGGER IF EXISTS action_history_delete_audit_trigger ON action_history;
-- Drop triggers for undo_steps
DROP TRIGGER IF EXISTS undo_steps_audit_trigger ON undo_steps;
DROP TRIGGER IF EXISTS undo_steps_insert_audit_trigger ON undo_steps;
DROP TRIGGER IF EXISTS undo_steps_delete_audit_trigger ON undo_steps;

-- NOW Drop the audit log trigger function
DROP FUNCTION IF EXISTS log_audit_trail(); -- Moved here

-- Drop tables (order matters due to FKs)
-- Added IF EXISTS to prevent errors if tables don't exist
DROP TABLE IF EXISTS undo_steps CASCADE;
DROP TABLE IF EXISTS action_history CASCADE;
DROP TABLE IF EXISTS work_item_dependencies CASCADE;
DROP TABLE IF EXISTS work_items CASCADE;
DROP TABLE IF EXISTS audit_log CASCADE; -- Renamed


-- Ensure UUID extension is available (usually enabled by default, but good practice)
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; -- Commented out as it might cause issues if already installed

-- ================================================
-- Main Data Tables
-- ================================================

-- Table: work_items
CREATE TABLE work_items (
    work_item_id UUID PRIMARY KEY NOT NULL,
    parent_work_item_id UUID NULL REFERENCES work_items(work_item_id) ON DELETE NO ACTION,
    name TEXT NOT NULL,
    description TEXT NULL,
    status VARCHAR(20) NOT NULL CHECK(status IN ('todo', 'in-progress', 'review', 'done')),
    priority VARCHAR(10) NOT NULL CHECK(priority IN ('high', 'medium', 'low')),
    order_key NUMERIC NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    due_date TIMESTAMPTZ NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    tags TEXT[] NULL -- ADDED tags column
);

-- Table: work_item_dependencies
CREATE TABLE work_item_dependencies (
    work_item_id UUID NOT NULL REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    depends_on_work_item_id UUID NOT NULL REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    dependency_type VARCHAR(20) NOT NULL DEFAULT 'finish-to-start' CHECK(dependency_type IN ('finish-to-start', 'linked')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (work_item_id, depends_on_work_item_id)
);

-- Table: action_history
CREATE TABLE action_history (
    action_id UUID PRIMARY KEY NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    action_type VARCHAR(50) NOT NULL,
    work_item_id UUID NULL,
    description TEXT NULL,
    is_undone BOOLEAN NOT NULL DEFAULT FALSE,
    undone_at_action_id UUID NULL REFERENCES action_history(action_id) ON DELETE SET NULL
);

-- Table: undo_steps
CREATE TABLE undo_steps (
    undo_step_id UUID PRIMARY KEY NOT NULL,
    action_id UUID NOT NULL REFERENCES action_history(action_id) ON DELETE CASCADE,
    step_order INTEGER NOT NULL,
    step_type VARCHAR(20) NOT NULL CHECK(step_type IN ('UPDATE')), -- Only 'UPDATE' is now expected
    table_name VARCHAR(50) NOT NULL,
    record_id TEXT NOT NULL, -- Ensure TEXT type for composite keys or UUIDs
    old_data JSONB NULL,
    new_data JSONB NULL
);

-- ================================================
-- Indexes for Performance
-- ================================================

-- Indexes on work_items table
CREATE INDEX IF NOT EXISTS idx_work_items_parent_id ON work_items(parent_work_item_id);
CREATE INDEX IF NOT EXISTS idx_work_items_status ON work_items(status);
CREATE INDEX IF NOT EXISTS idx_work_items_priority ON work_items(priority);
CREATE INDEX IF NOT EXISTS idx_work_items_due_date ON work_items(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_order_key ON work_items(order_key) WHERE order_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_parent_order ON work_items(parent_work_item_id, order_key);
CREATE INDEX IF NOT EXISTS idx_work_items_is_active ON work_items(is_active);
CREATE INDEX IF NOT EXISTS idx_work_items_parent_active_order ON work_items(parent_work_item_id, is_active, order_key);
CREATE INDEX IF NOT EXISTS idx_work_items_tags_gin ON work_items USING GIN (tags) WHERE tags IS NOT NULL; -- ADDED GIN index for tags


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

-- Indexes on undo_steps table
CREATE INDEX IF NOT EXISTS idx_undo_steps_action_id ON undo_steps(action_id);
CREATE INDEX IF NOT EXISTS idx_undo_steps_record_id ON undo_steps(record_id);
CREATE INDEX IF NOT EXISTS idx_undo_steps_action_order ON undo_steps(action_id, step_order);


-- ================================================
-- Convenience Views
-- ================================================

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


-- ================================================
-- Audit Logging Trigger Setup
-- ================================================

-- 1. Create the audit_log table (Renamed from change_logs)
CREATE TABLE audit_log (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- Use gen_random_uuid() if uuid-ossp is not enabled
    log_timestamp TIMESTAMPTZ DEFAULT current_timestamp,
    operation_type VARCHAR(10) NOT NULL, -- INSERT, UPDATE, DELETE
    schema_name TEXT NOT NULL,
    table_name TEXT NOT NULL,
    record_pk TEXT NULL, -- Store primary key as text (handles composite keys)
    old_row_data JSONB NULL,
    new_row_data JSONB NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(log_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_table_pk ON audit_log(table_name, record_pk);

-- 2. Create OR REPLACE the trigger function (Renamed and Expanded)
CREATE OR REPLACE FUNCTION log_audit_trail()
RETURNS TRIGGER AS $$
DECLARE
    v_old_data JSONB := NULL;
    v_new_data JSONB := NULL;
    v_record_pk TEXT := NULL;
BEGIN
    -- Determine PK and capture data based on the table and operation type
    IF TG_TABLE_NAME = 'work_items' THEN
        IF (TG_OP = 'UPDATE') THEN
            v_old_data := to_jsonb(OLD);
            v_new_data := to_jsonb(NEW);
            v_record_pk := OLD.work_item_id::text;
        ELSIF (TG_OP = 'DELETE') THEN
            v_old_data := to_jsonb(OLD);
            v_record_pk := OLD.work_item_id::text;
        ELSIF (TG_OP = 'INSERT') THEN
            v_new_data := to_jsonb(NEW);
            v_record_pk := NEW.work_item_id::text;
        END IF;
    ELSIF TG_TABLE_NAME = 'work_item_dependencies' THEN
        IF (TG_OP = 'UPDATE') THEN
            v_old_data := to_jsonb(OLD);
            v_new_data := to_jsonb(NEW);
            v_record_pk := OLD.work_item_id::text || ':' || OLD.depends_on_work_item_id::text;
        ELSIF (TG_OP = 'DELETE') THEN
            v_old_data := to_jsonb(OLD);
            v_record_pk := OLD.work_item_id::text || ':' || OLD.depends_on_work_item_id::text;
        ELSIF (TG_OP = 'INSERT') THEN
            v_new_data := to_jsonb(NEW);
            v_record_pk := NEW.work_item_id::text || ':' || NEW.depends_on_work_item_id::text;
        END IF;
    ELSIF TG_TABLE_NAME = 'action_history' THEN
        IF (TG_OP = 'UPDATE') THEN
            v_old_data := to_jsonb(OLD);
            v_new_data := to_jsonb(NEW);
            v_record_pk := OLD.action_id::text;
        ELSIF (TG_OP = 'DELETE') THEN
            v_old_data := to_jsonb(OLD);
            v_record_pk := OLD.action_id::text;
        ELSIF (TG_OP = 'INSERT') THEN
            v_new_data := to_jsonb(NEW);
            v_record_pk := NEW.action_id::text;
        END IF;
    ELSIF TG_TABLE_NAME = 'undo_steps' THEN
        IF (TG_OP = 'UPDATE') THEN
            v_old_data := to_jsonb(OLD);
            v_new_data := to_jsonb(NEW);
            v_record_pk := OLD.undo_step_id::text;
        ELSIF (TG_OP = 'DELETE') THEN
            v_old_data := to_jsonb(OLD);
            v_record_pk := OLD.undo_step_id::text;
        ELSIF (TG_OP = 'INSERT') THEN
            v_new_data := to_jsonb(NEW);
            v_record_pk := NEW.undo_step_id::text;
        END IF;
    END IF;

    -- Insert into the log table
    INSERT INTO audit_log (
        operation_type,
        schema_name,
        table_name,
        record_pk,
        old_row_data,
        new_row_data
    )
    VALUES (
        TG_OP,          -- INSERT, UPDATE, or DELETE
        TG_TABLE_SCHEMA,
        TG_TABLE_NAME,
        v_record_pk,
        v_old_data,     -- Old row data (null for INSERT)
        v_new_data      -- New row data (null for DELETE)
    );

    -- Return null for AFTER trigger
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 3. Create triggers on the work_items table (Using new function name)
CREATE TRIGGER work_items_audit_trigger
AFTER UPDATE ON work_items
FOR EACH ROW
EXECUTE FUNCTION log_audit_trail();

CREATE TRIGGER work_items_insert_audit_trigger
AFTER INSERT ON work_items
FOR EACH ROW
EXECUTE FUNCTION log_audit_trail();

CREATE TRIGGER work_items_delete_audit_trigger
AFTER DELETE ON work_items
FOR EACH ROW
EXECUTE FUNCTION log_audit_trail();

-- 4. Create triggers on the work_item_dependencies table (Using new function name)
CREATE TRIGGER work_item_dependencies_audit_trigger
AFTER UPDATE ON work_item_dependencies
FOR EACH ROW
EXECUTE FUNCTION log_audit_trail();

CREATE TRIGGER work_item_dependencies_insert_audit_trigger
AFTER INSERT ON work_item_dependencies
FOR EACH ROW
EXECUTE FUNCTION log_audit_trail();

CREATE TRIGGER work_item_dependencies_delete_audit_trigger
AFTER DELETE ON work_item_dependencies
FOR EACH ROW
EXECUTE FUNCTION log_audit_trail();

-- 5. Create triggers on the action_history table (NEW)
CREATE TRIGGER action_history_audit_trigger
AFTER UPDATE ON action_history
FOR EACH ROW
EXECUTE FUNCTION log_audit_trail();

CREATE TRIGGER action_history_insert_audit_trigger
AFTER INSERT ON action_history
FOR EACH ROW
EXECUTE FUNCTION log_audit_trail();

CREATE TRIGGER action_history_delete_audit_trigger
AFTER DELETE ON action_history
FOR EACH ROW
EXECUTE FUNCTION log_audit_trail();

-- 6. Create triggers on the undo_steps table (NEW)
CREATE TRIGGER undo_steps_audit_trigger
AFTER UPDATE ON undo_steps
FOR EACH ROW
EXECUTE FUNCTION log_audit_trail();

CREATE TRIGGER undo_steps_insert_audit_trigger
AFTER INSERT ON undo_steps
FOR EACH ROW
EXECUTE FUNCTION log_audit_trail();

CREATE TRIGGER undo_steps_delete_audit_trigger
AFTER DELETE ON undo_steps
FOR EACH ROW
EXECUTE FUNCTION log_audit_trail();