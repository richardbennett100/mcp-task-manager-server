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

*(Note: Refer to the corresponding `src/tools/*Params.ts` files for detailed Zod schemas.)*

**Creation & Deletion:**

* **`create_project`**: Creates a new top-level work item (project).
* **`add_task`**: Adds a single new work item as a child of a specified parent. Requires `parent_work_item_id`.
* **`add_child_tasks`**: Adds multiple new work items as children under a specified parent.
* **`delete_project`**: Soft-deletes a specific project (root work item) and all its descendants.
* **`delete_task`**: Soft-deletes one or more specified work items (which must not be root projects) and their descendants.
* **`delete_child_tasks`**: Soft-deletes specified child work items under a specific parent.

**Reading & Querying:**

* **`get_details`**: Retrieves the full details for a specific work item (project or task) by its UUID, including dependencies, dependents, and direct children.
* **`list_work_items`**: Lists work items based on specified filters (e.g., parent, status, active state, roots only).
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
* **`PGPASSWORD`**: Database password (no default, **required**)
* **`PGDATABASE`**: Database name (default: `taskmanager_db`)
* **`LOG_LEVEL`**: The logging level (e.g., `debug`, `info`, `warn`, `error`). The default is `info`.

You can set these directly or use a `.env` file (e.g., `.env.development`, `.env.production`) with a tool like `dotenv-cli`.

## Project Structure

* `/src`: Source code.
    * `/config`: Configuration management.
    * `/db`: Database manager and schema (`schema.sql`).
    * `/repositories`: Data access layer (PostgreSQL interaction).
    * `/services`: Core business logic.
    * `/tools`: MCP tool definitions (*Params.ts) and implementation (*Tool.ts).
    * `/utils`: Logging, custom errors, etc.
    * `/__tests__`: Test files.
        * `/e2e`: End-to-end tests.
    * `createServer.ts`: Server instance creation.
    * `server.ts`: Main application entry point.
* `/dist`: Compiled JavaScript output.
* `/docs`: Project documentation (PRD, Feature Specs, RFC).
* `start_local_pg.sh`: Script to run a local PostgreSQL Docker container.
* Config files (`package.json`, `tsconfig.json`, `.eslintrc.json`, etc.)

## Linting and Formatting

* **Lint:** `npm run lint`
* **Format:** `npm run format`

(Code is automatically linted/formatted on commit via Husky/lint-staged).

## Testing

This project uses Jest for unit and integration tests, and a custom E2E testing setup using the MCP SDK.

### E2E Test Logging Standards

To improve the utility of E2E test logs for debugging and understanding test flow, the following logging practices should be adopted:

1.  **Start of Test Log:**
    At the beginning of each E2E test case (within the `it(...)` block), use `logger.info()` to print a descriptive message outlining the scenario and the high-level steps the test will perform.
    *Example:*
    ```typescript
    logger.info(
      'E2E Test Starting: Scenario - Advanced Promotion and Tree Verification. Steps: ' +
      '1. Create MainProject. 2. Add L1 sub-tasks (Sub1, Sub2, Sub3). ' +
      '3. Add L2 sub-tasks (SubSub1, SubSub2, SubSub3) to Sub1. 4. Promote Sub1. ' +
      '5. Get MainProject tree. 6. Verify MainProject tree structure. ' +
      '7. List root projects. 8. Verify root projects list.'
    );
    ```

2.  **End of Test Log (Markdown Tree Output):**
    Towards the end of each E2E test case, after the primary operations have been performed and before final assertions (or as part of verification), fetch the full tree structure of the main work item(s) created or manipulated during the test using the `get_full_tree` tool. Format this tree into a human-readable Markdown list and print it using `logger.info()`. This provides a visual snapshot of the state.

    *Example Markdown Output:*
    ```markdown
    - MainProject Alpha (id: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
      - Sub1 (L) (id: yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy)
        - SubSub1 (L) (id: zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz)
        - SubSub2 (L) (id: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa)
        - SubSub3 (L) (id: bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb)
      - Sub2 (id: cccccccc-cccc-cccc-cccc-cccccccccccc)
      - Sub3 (id: dddddddd-dddd-dddd-dddd-dddddddddddd)
    ```

    *Helper Function for Markdown Tree (Example for E2E tests):*
    A helper function should be used within the E2E tests to generate this Markdown. It can be defined in a shared test utility file or directly within the test files if simple.
    ```typescript
    // Example helper (assuming 'MinimalWorkItemTreeNode' type is defined in the test)
    function formatTreeToMarkdown(node: MinimalWorkItemTreeNode, indent = ''): string {
      let markdown = `${indent}- ${node.name} (id: ${node.work_item_id})\n`;
      if (node.children && node.children.length > 0) {
        // Ensure children are sorted for consistent output if order matters for visual inspection
        const sortedChildren = [...node.children].sort((a, b) => {
            // Basic sort by name, adapt if order_key or other properties are more relevant
            return a.name.localeCompare(b.name);
        });
        for (const child of sortedChildren) {
          markdown += formatTreeToMarkdown(child, `${indent}  `);
        }
      }
      return markdown;
    }
    ```
    The `MinimalWorkItemTreeNode` type would be the Zod schema type used for parsing the `get_full_tree` response within the E2E test. Ensure the helper function is adapted to the actual structure of your tree nodes.
