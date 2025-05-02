#!/bin/bash

# --- Configuration ---
CONTAINER_NAME="local-postgres-tasks"
PG_USER="taskmanager_user"
PG_DATABASE="taskmanager_db"
# IMPORTANT: Change this password or secure it appropriately!
PG_PASSWORD="mysecretpassword"
PG_PORT="5432"
# Volume name for data persistence
VOLUME_NAME="pgdata_tasks"
# --- End Configuration ---

# Check if a container with the same name exists
if [ "$(docker ps -a --filter name=^/${CONTAINER_NAME}$ --format '{{.Names}}')" = "$CONTAINER_NAME" ]; then
    echo "Found existing container named '$CONTAINER_NAME'. Stopping and removing it..."
    # Stop the container if it's running
    docker stop "$CONTAINER_NAME" > /dev/null 2>&1
    # Remove the container
    docker rm "$CONTAINER_NAME" > /dev/null 2>&1
    echo "Existing container '$CONTAINER_NAME' removed."
else
    echo "No existing container named '$CONTAINER_NAME' found."
fi

# Optional: Check if volume exists and remove if you want truly fresh start
# if [ "$(docker volume ls --filter name=^${VOLUME_NAME}$ --format '{{.Name}}')" = "$VOLUME_NAME" ]; then
#     echo "Removing existing volume '$VOLUME_NAME'..."
#     docker volume rm "$VOLUME_NAME" > /dev/null 2>&1
#     echo "Existing volume '$VOLUME_NAME' removed."
# fi

echo "Starting new container '$CONTAINER_NAME'..."

# Run the new container
docker run \
    --name "$CONTAINER_NAME" \
    -e POSTGRES_USER="$PG_USER" \
    -e POSTGRES_PASSWORD="$PG_PASSWORD" \
    -e POSTGRES_DB="$PG_DATABASE" \
    -p "$PG_PORT":5432 \
    -v "$VOLUME_NAME":/var/lib/postgresql/data \
    -d postgres

# Check if the container started successfully
if [ $? -eq 0 ]; then
    echo "Container '$CONTAINER_NAME' started successfully."
    echo "You can connect using:"
    echo "  Host: localhost"
    echo "  Port: $PG_PORT"
    echo "  User: $PG_USER"
    echo "  Password: $PG_PASSWORD"
    echo "  Database: $PG_DATABASE"
else
    echo "ERROR: Failed to start container '$CONTAINER_NAME'."
    exit 1
fi

exit 0

# export PGPASSWORD='mysecretpassword' && npm run build && npm test > test_output.txt 2>&1

# export PGPASSWORD='mysecretpassword' && export LOG_LEVEL='debug' && npm test -- dist/services/__tests__/workItemDeleteIntegration.test.js > delete_test_output.txt 2>&1

