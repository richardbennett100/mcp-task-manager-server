# Task Manager - Svelte UI POC

## Description

This directory contains the SvelteKit frontend application for the Task Manager. 
This initial version is a Proof of Concept (POC) focused on providing a read-only view of projects and tasks, with real-time updates from the backend via Server-Sent Events (SSE).

## Key Features (POC v1)

* View a list of projects.
* View the detailed task tree for a selected project (always expanded).
* Real-time updates to the project list and project tree when changes occur in the backend.
* Lightweight, "coder-vibe" interface with pastel color coding.

## Technologies Used

* SvelteKit
* Svelte
* TypeScript
* Vite
* ESLint + Prettier
* Scoped CSS/SCSS (via Svelte)

## Project Structure (`ui/`)

* `src/`: Main application code.
    * `app.html`: Main HTML shell.
    * `hooks.server.ts`: Server-side hooks (if any).
    * `lib/`: Svelte components, stores, client utilities.
        * `client/`: Modules for API communication and SSE handling.
        * `components/`: Reusable Svelte components (layout, project list, project tree, etc.).
        * `stores/`: Svelte stores for state management.
        * `types/`: TypeScript type definitions for the UI.
        * `utils/`: UI-specific utility functions.
    * `params/`: SvelteKit param matchers (if any).
    * `routes/`: SvelteKit file-system based router.
    * `service-worker.js`: (If PWA features are added later).
* `static/`: Static assets (fonts, images, etc.).
* `tests/`: Frontend tests (e.g., using Vitest, Playwright).
* `package.json`: Frontend project dependencies and scripts.
* `svelte.config.js`: SvelteKit configuration.
* `vite.config.ts`: Vite configuration.
* `tsconfig.json`: TypeScript configuration for the UI.
* `build.sh`: Build script for the UI.
* `.eslintrc.cjs`: ESLint configuration.
* `.prettierrc`: Prettier configuration.

## Development Setup

1.  **Prerequisites:**
    * Node.js (version X.X.X or later - specify from your backend's `package.json` or SvelteKit's recommendation)
    * npm or pnpm (specify preferred package manager)
    * Ensure the backend server (from the `../src` directory) is running and accessible at `http://localhost:PORT` (specify backend port).

2.  **Installation:**
    ```bash
    cd ui
    npm install  # or pnpm install / yarn install
    ```

3.  **Running in Development Mode:**
    ```bash
    npm run dev
    ```
    This will typically start the SvelteKit development server, often on `http://localhost:5173`.

## Linting

To check for code style and potential errors:
```bash
npm run lint