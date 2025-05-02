# MCP Task Manager Server

<div align="center">
  <img src="public/images/mcp-task-manager-logo.svg" alt="MCP Task Manager Logo" width="200" height="200" />
</div>

A local Model Context Protocol (MCP) server providing backend tools for client-driven project and task management using a **PostgreSQL** database.

## Overview

This server acts as a persistent backend for local MCP clients (like AI agents or scripts) that need to manage structured task data within distinct projects. It handles data storage and provides a standardized set of tools for interaction, while the strategic workflow logic resides within the client.

**Key Features:**

* **Project-Based:** Tasks are organized within distinct projects.
* **PostgreSQL Persistence:** Uses a local PostgreSQL database for data storage. See `start_local_pg.sh` and configuration options.
* **Client-Driven:** Provides tools for clients; does not dictate workflow.
* **MCP Compliant:** Adheres to the Model Context Protocol for tool definition and communication.
* **Task Management:** Supports creating projects, adding tasks, listing/showing tasks, updating status, expanding tasks into subtasks, and identifying the next actionable task.
* **Import/Export:** Allows exporting project data to JSON and importing from JSON to create new projects.

## Implemented MCP Tools

The following tools are available for MCP clients:

* **`createProject`**:
  * **Description:** Creates a new, empty project.
  * **Params:** `projectName` (string, optional, max 255)
  * **Returns:** `{ project_id: string }`
* **`addTask`**:
  * **Description:** Adds a new task to a project.
  * **Params:** `project_id` (string, required, UUID), `description` (string, required, 1-1024), `dependencies` (string[], optional, max 50), `priority` (enum 'high'|'medium'|'low', optional, default 'medium'), `status` (enum 'todo'|'in-progress'|'review'|'done', optional, default 'todo')
  * **Returns:** Full `TaskData` object of the created task.
* **`listTasks`**:
  * **Description:** Lists tasks for a project, with optional filtering and subtask inclusion.
  * **Params:** `project_id` (string, required, UUID), `status` (enum 'todo'|'in-progress'|'review'|'done', optional), `include_subtasks` (boolean, optional, default false)
  * **Returns:** Array of `TaskData` or `StructuredTaskData` objects.
* **`showTask`**:
  * **Description:** Retrieves full details for a specific task, including dependencies and direct subtasks.
  * **Params:** `project_id` (string, required, UUID), `task_id` (string, required)
  * **Returns:** `FullTaskData` object.
* **`setTaskStatus`**:
  * **Description:** Updates the status of one or more tasks.
  * **Params:** `project_id` (string, required, UUID), `task_ids` (string[], required, 1-100), `status` (enum 'todo'|'in-progress'|'review'|'done', required)
  * **Returns:** `{ success: true, updated_count: number }`
* **`expandTask`**:
  * **Description:** Breaks a parent task into subtasks, optionally replacing existing ones.
  * **Params:** `project_id` (string, required, UUID), `task_id` (string, required), `subtask_descriptions` (string[], required, 1-20, each 1-512), `force` (boolean, optional, default false)
  * **Returns:** Updated parent `FullTaskData` object including new subtasks.
* **`getNextTask`**:
  * **Description:** Identifies the next actionable task based on status ('todo'), dependencies ('done'), priority, and creation date.
  * **Params:** `project_id` (string, required, UUID)
  * **Returns:** `FullTaskData` object of the next task, or `null` if none are ready.
* **`exportProject`**:
  * **Description:** Exports complete project data as a JSON string.
  * **Params:** `project_id` (string, required, UUID), `format` (enum 'json', optional, default 'json')
  * **Returns:** JSON string representing the project.
* **`importProject`**:
  * **Description:** Creates a *new* project from an exported JSON string.
  * **Params:** `project_data` (string, required, JSON), `new_project_name` (string, optional, max 255)
  * **Returns:** `{ project_id: string }` of the newly created project.
* **`updateTask`**:
  * **Description:** Updates specific details (description, priority, dependencies) of an existing task.
  * **Params:** `project_id` (string, required, UUID), `task_id` (string, required, UUID), `description` (string, optional, 1-1024), `priority` (enum 'high'|'medium'|'low', optional), `dependencies` (string[], optional, max 50, replaces existing)
  * **Returns:** Updated `FullTaskData` object.
* **`deleteTask`**:
  * **Description:** Deletes one or more tasks (and their subtasks/dependency links via cascade).
  * **Params:** `project_id` (string, required, UUID), `task_ids` (string[], required, 1-100)
  * **Returns:** `{ success: true, deleted_count: number }`
* **`deleteProject`**:
  * **Description:** Permanently deletes a project and ALL associated data. **Use with caution!**
  * **Params:** `project_id` (string, required, UUID)
  * **Returns:** `{ success: true }`

*(Note: Refer to the corresponding `src/tools/*Params.ts` files for detailed Zod schemas and parameter descriptions.)*

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
  * `createServer.ts`: Server instance creation.
  * `server.ts`: Main application entry point.
* `/dist`: Compiled JavaScript output.
* `/docs`: Project documentation (PRD, Feature Specs, RFC).
* `start_local_pg.sh`: Script to run a local PostgreSQL Docker container.
* `tasks.md`: Manual task tracking file for development.
* Config files (`package.json`, `tsconfig.json`, `.eslintrc.cjs`, etc.)

## Linting and Formatting

* **Lint:** `npm run lint`
* **Format:** `npm run format`

(Code is automatically linted/formatted on commit via Husky/lint-staged).