# MCP Task Manager Server

<div align="center">
  <img src="public/images/mcp-task-manager-logo.svg" alt="MCP Task Manager Logo" width="200" height="200" />
</div>

A local Model Context Protocol (MCP) server providing backend tools for client-driven project and task management using a **PostgreSQL** database.

## Overview

This server acts as a persistent backend for local MCP clients (like AI agents or scripts) that need to manage structured work items (projects, tasks, goals). It handles data storage, ordering, dependencies, and history, providing a standardized set of tools for interaction via MCP. Client applications are responsible for workflow logic, user interface formatting, and mapping user references (like list numbers) to the work item UUIDs used by the tools.

**Key Features:**

* **Hierarchical:** Work items can be nested (projects containing tasks, tasks containing sub-tasks).
* **Ordered:** Sibling items maintain a specific order.
* **Dependencies:** Supports linking items (e.g., task B depends on task A).
* **PostgreSQL Persistence:** Uses a local PostgreSQL database for data storage. See `start_local_pg.sh` and configuration options.
* **History & Undo/Redo:** Tracks changes and allows undo/redo operations.
* **Audit Logging:** Maintains a basic log of database changes.
* **Client-Driven:** Provides tools for clients; does not dictate workflow.
* **MCP Compliant:** Adheres to the Model Context Protocol for tool definition and communication.

## Implemented MCP Tools

*(Note: Refer to the corresponding `src/tools/*Params.ts` files for detailed Zod schemas and agent formatting guidelines in descriptions.)*

**Creation & Deletion:**

* **`create_project`**: Creates a new top-level work item (project).
* **`add_task`**: Adds a single new work item as a child of a specified parent. Requires `parent_work_item_id`.
* **`add_child_tasks`**: Adds multiple new work items as children under a specified parent.
* **`delete_project`**: Soft-deletes a specific project (root work item) and all its descendants.
* **`delete_task`**: Soft-deletes one or more specified work items (which must not be root projects) and their descendants.
* **`delete_child_tasks`**: Soft-deletes specified child work items under a specific parent.

**Reading & Querying:**

* **`get_details`**: Retrieves the full details for a specific work item (project or task) by its UUID, including dependencies, dependents, and direct children.
* **`list_work_items`**: Lists work items based on specified filters (e.g., parent, status, active state, roots only). Agent is expected to format project lists in Markdown by default.
* **`get_full_tree`**: Retrieves a work item and its *entire* descendant hierarchy recursively. Returns a structured JSON object. Linked items (promoted tasks) and their children are suffixed with "(L)" in their names when viewed under their original parent.
* **`list_history`**: Lists recorded actions, optionally filtered by a date range.
* **`get_next_task`**: Intelligently identifies the next actionable task based on dependencies, status, priority, etc.

**Updating Item Properties:**

* **`set_name`**: Updates the name of a work item.
* **`set_description`**: Updates the description of a work item.
* **`set_status`**: Updates the status ('todo', 'in-progress', 'review', 'done') of a work item.
* **`set_priority`**: Updates the priority ('high', 'medium', 'low') of a work item.
* **`set_due_date`**: Sets or removes (by passing null) the due date of a work item.
* **`update_task`**: General-purpose update for multiple fields of a task (deprecated in favor of specific setters but still available).

**Dependencies & Hierarchy:**

* **`add_dependencies`**: Adds one or more dependency links *to* a specified work item.
* **`delete_dependencies`**: Removes specified dependency links *from* a work item.
* **`promote_to_project`**: Changes a task into a root project (sets parent to null) and adds a 'linked' dependency from the original parent back to the item.

**Ordering & Positioning:**

* **`move_item_to_start`**: Moves a work item to the beginning of its sibling list.
* **`move_item_to_end`**: Moves a work item to the end of its sibling list.
* **`move_item_after`**: Moves a work item to be immediately after a specified sibling.
* **`move_item_before`**: Moves a work item to be immediately before a specified sibling.

**History:**

* **`undo_last_action`**: Reverts the last performed action.
* **`redo_last_action`**: Re-applies the last undone action.

**Import/Export:**
* **`export_project`**: Exports a project structure to a shareable format (e.g., JSON).
* **`import_project`**: Creates a new project from an exported format.


## Getting Started

1.  **Prerequisites:** Node.js (LTS recommended), npm, Docker (for local PostgreSQL).
2.  **Install Dependencies:**
    ```bash
    npm install
    ```
3.  **Setup Local Database:** Run the script to start a local PostgreSQL container:
    ```bash
    bash ./start_local_pg.sh
    ```
    This will use the default credentials configured in the script and expected by the server (or set via environment variables).
4.  **Run in Development Mode:** (Uses `ts-node` and `nodemon` for auto-reloading)
    ```bash
    npm run dev
    ```
    The server will connect via stdio. Logs (JSON format) will be printed to stderr. The server will connect to the PostgreSQL database specified in the configuration.
5.  **Build for Production:**
    ```bash
    npm run build
    ```
6.  **Run Production Build:** Ensure your PostgreSQL database is running and accessible, and necessary environment variables (see Configuration) are set.
    ```bash
    npm start
    ```

## Configuration

Environment variables can be used to configure the database connection:

* **`PGHOST`**: Database host (default: `localhost`)
* **`PGPORT`**: Database port (default: `5432`)
* **`PGUSER`**: Database user (default: `taskmanager_user`)
* **`PGPASSWORD`**: Database password (no default, **required** in `.env` or environment)
* **`PGDATABASE`**: Database name (default: `taskmanager_db`)
* **`LOG_LEVEL`**: The logging level (e.g., `debug`, `info`, `warn`, `error`). The default is `info`.
* **`FORCE_SCHEMA_RUN`**: Set to `true` to force `schema.sql` execution on server startup (e.g., for `npm start`). Defaults to `false` if not set. Tests may override this.

You can set these directly or use a `.env` file (e.g., `.env.development`, `.env.production`) with a tool like `dotenv-cli`. The `npm test` scripts use `.env.test`.

## Project Structure

* `/src`: Source code.
    * `/config`: Configuration management.
    * `/db`: Database manager and schema (`schema.sql`).
    * `/repositories`: Data access layer (PostgreSQL interaction).
    * `/services`: Core business logic.
    * `/tools`: MCP tool definitions (`*params.ts`, `*tool.ts`).
    * `/utils`: Logging, custom errors, etc.
    * `/__tests__`: Test files.
        * `/e2e`: End-to-end tests.
        * `/services/__tests__`: Integration and Unit tests for services.
    * `createServer.ts`: Server instance creation.
    * `server.ts`: Main application entry point.
* `/dist`: Compiled JavaScript output.
* `/docs`: Project documentation (PRD, Feature Specs, RFC).
* `start_local_pg.sh`: Script to run a local PostgreSQL Docker container.
* Config files (`package.json`, `tsconfig.json`, `.eslintrc.json`, etc.)

## Testing Strategy

This project employs a multi-layered testing approach:

### 1. Unit Tests (`*.spec.ts`)
* **Scope:** Test individual functions, pure logic, and small, isolated units of code within services or utilities.
* **Characteristics:** No I/O (no database, no network calls). Relies on Jest. Mocks are avoided.
* **Data:** Test data is defined directly within the test. Database is not touched.
* **Execution:** Run via `npm run test:unit` or as part of `build.sh`.

### 2. Integration Tests (`*.test.ts` within `src/services/__tests__`)
* **Scope:** Test the interaction between different internal components, primarily service methods and their database interactions (repositories). Focus on CRUD operations, service logic involving data persistence, and workflows like undo/redo.
* **Characteristics:** Requires a running PostgreSQL database. Each test suite or individual test `it(...)` block ensures a clean data state, typically by truncating relevant tables via `cleanDatabase()` (from `integrationSetup.ts`) in `beforeEach` or `beforeAll` blocks. The overall database schema is assumed to be stable for the test run, set up once by `build.sh`.
* **Data:** Tests create their own necessary data.
* **Execution:** Run via `npm run test:integration` or as part of `build.sh`.

### 3. End-to-End (E2E) Tests (`*.test.ts` within `src/__tests__/e2e`)
* **Scope:** Test complete scenarios and workflows from the perspective of an external client (like an MCP agent). Involves making calls to the server's exposed tools and verifying results and side effects.
* **Characteristics:**
    * Requires a fully running server instance and its connected PostgreSQL database.
    * **Data Persists Across E2E Test Files:** Within a single `build.sh` execution, data created by one E2E test file (e.g., `1_*.test.ts`) is intended to be available to subsequent E2E test files (e.g., `2_*.test.ts`, `3_*.test.ts`). E2E tests *do not* clear the database or schema between test files. They build upon each other to simulate a continuous user/agent session.
    * The database schema is set up once at the beginning of the `build.sh` script (`rebuild_database_schema_directly` function).
    * Server instances started by E2E tests run with the environment variable `FORCE_SCHEMA_RUN=false` to prevent schema re-application.
    * Individual E2E tests within a file should be mindful of the state they create or depend on.
* **Tools:** Uses the `@modelcontextprotocol/sdk` client to interact with the server. Assertions are made using Jest.
* **Execution:** Run via `npm run test:e2e` or as part of `build.sh`. E2E test files are typically ordered by naming convention (e.g., `1_...`, `2_...`) to reflect dependent scenarios.

## Linting and Formatting

* **Lint:** `npm run lint`
* **Format:** `npm run format`

(Code is automatically linted/formatted on commit via Husky/lint-staged).