#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status.

echo "Starting file creation for UI build script, gitignore, and favicon..."

# Ensure the ui/static directory exists
mkdir -p ui/static

# ui/build.sh
cat << 'EOF_UI_BUILD_SH' > ui/build.sh
#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status.

echo "Changing to ui directory..."
# Get the directory of the script itself
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

echo "Linting UI code..."
if command -v pnpm &> /dev/null
then
    pnpm lint
elif command -v npm &> /dev/null
then
    npm run lint
else
    echo "Error: pnpm or npm not found. Please install one to run linting."
    exit 1
fi

echo "Building UI for production..."
if command -v pnpm &> /dev/null
then
    pnpm build
elif command -v npm &> /dev/null
then
    npm run build
else
    echo "Error: pnpm or npm not found. Please install one to run the build."
    exit 1
fi

echo "UI build complete. Output is typically in 'build/' directory."
EOF_UI_BUILD_SH
chmod +x ui/build.sh
echo "Created/Updated ui/build.sh and made it executable."

# ui/.gitignore
cat << 'EOF_UI_GITIGNORE' > ui/.gitignore
/.svelte-kit
/build/
/dist/

# Mac
.DS_Store

# Node
/node_modules
*.log
logs
*debug.log*
*debug.*.log*
yarn-error.log
pnpm-debug.log

# Editor Directories and Files
.idea
.vscode/*
!.vscode/settings.json
!.vscode/tasks.json
!.vscode/launch.json
!.vscode/extensions.json
*.sublime-project
*.sublime-workspace

# Misc
.env
.env.*
!.env.example
*.tsbuildinfo

# SvelteKit cache files
.vite-inspect/
EOF_UI_GITIGNORE
echo "Created/Updated ui/.gitignore"

# ui/static/favicon.png (Base64 encoded)
FAVICON_B64="iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAABFSURBVDhPYxgFoxAYICIwASDF+v///wMyQlhAIH4A8Q+gfgLxL0A8AGIQEBiCkxUABots7hhmAAjC5LAyADMoY5gAIAAgyAAAy3B34qESs6UAAAAASUVORK5CYII="
echo "$FAVICON_B64" | base64 --decode > ui/static/favicon.png
echo "Created/Updated ui/static/favicon.png from base64 data."

echo "---"
echo "Script to create remaining UI helper files complete."
echo "Please ensure ui/README.md was created manually or by other means if it's still missing."
echo "Then, proceed with:"
echo "1. cd ui"
echo "2. pnpm install (or npm install / yarn install)"
echo "3. Start backend, then start UI dev server (pnpm dev from ui/)"