# Task Manager - Svelte UI POC

## Description

This directory contains the SvelteKit frontend application for the Task Manager.
This initial version is a Proof of Concept (POC) focused on providing a read-only view of projects and tasks, with real-time updates from the backend via Server-Sent Events (SSE).

## Key Features (POC v1)

- View a list of projects in a collapsible sidebar.
- View the detailed task tree (always expanded) for a selected project in the main panel.
- Real-time updates to the project list and project tree when changes occur in the backend.
- Lightweight, "coder-vibe" interface with pastel color coding and fixed-width fonts.
- Textual display of task dependencies.
- Placeholder top bar.

## Technologies Used

- SvelteKit
- Svelte
- TypeScript
- Vite
- ESLint + Prettier
- PostCSS (for global styles)
- Svelte's Scoped CSS

## Project Structure (`ui/`)

- `src/`: Main application code.
  - `app.html`: Main HTML shell.
  - `app.d.ts`: Ambient TypeScript declarations.
  - `app.postcss`: Global CSS styles (theme, fonts, etc.).
  - `lib/`: Svelte components, stores, client utilities.
    - `client/`: Modules for API communication (`api.ts`) and SSE handling (`sse.ts`).
    - `components/`: Reusable Svelte components.
      - `layout/`: Components for the main page structure (TopBar, Sidebar, MainPanel, AppLayout).
      - `projectList/`: Components related to displaying the list of projects.
      - `projectTree/`: Components for the project's task tree view.
      - `common/`: Shared utility components (LoadingSpinner, Expander).
    - `stores/`: Svelte stores for state management (`projectStore.ts`, `uiStateStore.ts`).
    - `types/`: TypeScript type definitions for the UI (`index.ts`).
    - `utils/`: UI-specific utility functions (`colorUtils.ts`).
  - `routes/`: SvelteKit file-system based router (`+layout.svelte`, `+page.svelte`).
- `static/`: Static assets (e.g., `favicon.png`).
- `tests/`: Placeholder for frontend tests.
- `package.json`: Frontend project dependencies and scripts.
- `svelte.config.js`: SvelteKit configuration (using `adapter-static`).
- `vite.config.ts`: Vite configuration (includes proxy setup for dev).
- `tsconfig.json`: TypeScript configuration for the UI.
- `build.sh`: Build script for the UI.
- `.eslintrc.cjs`: ESLint configuration.
- `.prettierrc.json`: Prettier configuration.
- `postcss.config.cjs`: PostCSS configuration.

## Development Setup

1.  **Prerequisites:**

    - Node.js (e.g., v18.x or v20.x)
    - pnpm (preferred), npm, or yarn
    - Ensure the backend server (from the `../src` directory) is running and accessible (typically `http://localhost:3000`).

2.  **Installation (from within the `ui/` directory):**

    ```bash
    cd ui
    pnpm install  # or npm install / yarn install
    ```

3.  **Running in Development Mode (from within the `ui/` directory):**
    ```bash
    pnpm dev
    ```
    This will typically start the SvelteKit development server on `http://localhost:5173`. API and SSE requests to `/api/*` will be proxied to `http://localhost:3000/api/*` by Vite.

## Linting

To check for code style and potential errors (from within the `ui/` directory):

```bash
pnpm lint
```
