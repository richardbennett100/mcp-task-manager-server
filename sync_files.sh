#!/bin/bash
# Using set -e -u -o pipefail for safety
set -e
set -u
set -o pipefail

# --- Configuration ---
SOURCE_DIR="/home/richard/repos/mcp-task-manager-server"
UPLOAD_DIR="/home/richard/repos/upload"

# --- Script Start ---
echo "Starting file synchronization process..."
echo "[DEBUG] Source directory: $SOURCE_DIR"
echo "[DEBUG] Upload directory: $UPLOAD_DIR"

# 1. Delete everything in the upload directory
echo "Step 1: Clearing destination directory: $UPLOAD_DIR"
rm -rf "$UPLOAD_DIR"
mkdir -p "$UPLOAD_DIR"
echo "Destination directory cleared and recreated."

# 2. Copy root files, renaming dotfiles during the copy process
echo "Step 2a: Copying and renaming root-level dotfiles (preserving timestamps)..."
# Use a subshell for cd and shopt locality
(
  cd "$SOURCE_DIR" || { echo "[ERROR] Failed cd to $SOURCE_DIR"; exit 1; }
  shopt -s dotglob # Enable dotglob for this subshell to catch dotfiles with '*'

  for file in .*; do
      # Check if it's a regular file and not . or ..
      if [[ -f "$file" && "$file" != "." && "$file" != ".." ]]; then
          # Calculate new name by removing the leading dot
          newname="${file#.}"
          # Ensure newname is not empty (shouldn't happen for real files)
          if [[ -n "$newname" ]]; then
              echo "Copying '$SOURCE_DIR/$file' to '$UPLOAD_DIR/$newname'"
              # Copy directly to the destination with the new name
              # Use -p to preserve timestamps and -- to handle potential leading hyphens
              cp -p -- "$file" "$UPLOAD_DIR/$newname"
          else
              echo "[WARN] Skipping '$file' as removing leading dot resulted in an empty name."
          fi
      fi
  done

  shopt -u dotglob # Unset dotglob (though subshell exit cleans up anyway)
) # End of subshell
echo "Root-level dotfiles processed."

echo "Step 2b: Copying remaining root-level non-dotfiles (preserving timestamps)..."
# Use find again, but this time specifically EXCLUDE dotfiles using ! -name '.*'
find "$SOURCE_DIR" -maxdepth 1 -type f ! -name '.*' -exec cp -pt "$UPLOAD_DIR" {} +
echo "Root-level non-dotfiles copied."

# --- DEBUG: List files after all root copies ---
echo "[DEBUG] Contents of $UPLOAD_DIR after copying ALL root files:"
ls -la "$UPLOAD_DIR"
echo "[DEBUG] -------------------------------------------"

# 3. Copy the src directory recursively (preserving timestamps)
echo "Step 3: Copying src directory recursively (preserving timestamps)..."
if [ -d "$SOURCE_DIR/src" ]; then
  # -a implies -p (preserve) and -R (recursive)
  cp -a "$SOURCE_DIR/src" "$UPLOAD_DIR/"
  echo "src directory copied."
else
  echo "Source src directory not found, skipping copy."
fi

# 3b. Copy the logs directory recursively (preserving timestamps)
echo "Step 3b: Copying logs directory recursively (preserving timestamps)..."
if [ -d "$SOURCE_DIR/logs" ]; then
  # -a implies -p (preserve) and -R (recursive)
  cp -a "$SOURCE_DIR/logs" "$UPLOAD_DIR/"
  echo "logs directory copied."
else
  echo "Source logs directory not found, skipping copy."
fi

# Step 4 (Renaming) is no longer needed

echo "File synchronization process completed successfully."
#echo "Associated debug SQL data:"

#docker exec -i local-postgres-tasks psql -U taskmanager_user -d taskmanager_db -c "SELECT log_timestamp, operation_type, table_name, record_pk, old_row_data ->> 'is_active' as old_is_active, new_row_data ->> 'is_active' as new_is_active FROM change_logs ORDER BY log_timestamp ASC;"

#echo "Debug data queried."

exit 0

# docker exec -i local-postgres-tasks psql -U taskmanager_user -d taskmanager_db -c "SELECT * FROM change_logs"

# sudo docker exec -i local-postgres-tasks psql -U taskmanager_user -d taskmanager_db -c "DELETE FROM change_logs"

# sudo docker exec -i local-postgres-tasks psql -U taskmanager_user -d taskmanager_db -c "SELECT work_item_id, name, is_active, updated_at FROM work_items ORDER BY created_at DESC LIMIT 20;"
# sudo docker exec -i local-postgres-tasks psql -U taskmanager_user -d taskmanager_db -c "UPDATE work_items SET is_active = false, updated_at = NOW() WHERE work_item_id = '7fff9699-3060-4e1a-8c6d-2ed5a018846e';"
# sudo docker exec -i local-postgres-tasks psql -U taskmanager_user -d taskmanager_db -c "UPDATE work_items SET is_active = false;"
# sudo docker exec -i local-postgres-tasks psql -U taskmanager_user -d taskmanager_db -c "UPDATE work_items SET is_active = true, updated_at = NOW() WHERE work_item_id = '7fff9699-3060-4e1a-8c6d-2ed5a018846e';"
# sudo docker exec -i local-postgres-tasks psql -U taskmanager_user -d taskmanager_db -c "SELECT log_timestamp, operation_type, table_name, record_pk, old_row_data ->> 'is_active' as old_is_active, new_row_data ->> 'is_active' as new_is_active FROM change_logs WHERE record_pk = '<WORK_ITEM_UUID_TO_UPDATE>' ORDER BY log_timestamp ASC;"
# sudo docker exec -i local-postgres-tasks psql -U taskmanager_user -d taskmanager_db -c "SELECT log_timestamp, operation_type, table_name, record_pk, old_row_data ->> 'is_active' as old_is_active, new_row_data ->> 'is_active' as new_is_active FROM change_logs ORDER BY log_timestamp ASC;"





