#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status.

echo "Changing to ui directory..."
# Get the directory of the script itself
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

echo "Linting UI code..."
npm run format
npm run lint -- --fix

echo "Building UI for production..."
npm run build

echo "UI build complete. Output is typically in 'build/' directory."
