#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status.

echo "Preparing to patch 'src/createServer.ts' to remove unused 'pgConfigManager'..."

# Define the patch content
PATCH_CONTENT=$(cat << 'EOF_PATCH'
--- a/src/createServer.ts
+++ b/src/createServer.ts
@@ -23,9 +23,8 @@
 
   // For ConfigurationManager, using process.env directly for non-PG specific values
   // as the provided ConfigurationManager.ts focuses on PG and doesn't have a generic .get()
-  const pgConfigManager = ConfigurationManager.getInstance(); 
-  logger.info('Configuration Manager (for PG) initialized.'); 
+  ConfigurationManager.getInstance(); // Ensure it's initialized if DBManager or other parts rely on it being called once.
+  // logger.info('Configuration Manager (for PG) initialized.'); // Log line removed as variable is removed.
 
   const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
   logger.info(`Log level set to: ${LOG_LEVEL}`); 
EOF_PATCH
)

# Create a temporary patch file
TEMP_PATCH_FILE="pgconfigmanager_fix.patch"
echo "$PATCH_CONTENT" > "$TEMP_PATCH_FILE"
echo "Patch content saved to $TEMP_PATCH_FILE"

# Target file
TARGET_FILE="src/createServer.ts"

# Apply the patch
# The -p1 option strips the 'a/' and 'b/' prefixes from the file paths in the diff.
if [ -f "$TARGET_FILE" ]; then
  echo "Attempting to patch $TARGET_FILE..."
  if patch -p1 --verbose < "$TEMP_PATCH_FILE"; then
    echo "$TARGET_FILE patched successfully."
  else
    echo "ERROR: Patching $TARGET_FILE failed. This might be because the file content"
    echo "differs too much from the expected original state for the patch."
    echo "Please review '$TEMP_PATCH_FILE' and apply the changes manually if necessary."
    echo "The script will now exit to prevent further issues."
    # rm "$TEMP_PATCH_FILE" # Optionally remove patch file on failure
    exit 1
  fi
else
  echo "ERROR: $TARGET_FILE not found. Cannot apply patch."
  # rm "$TEMP_PATCH_FILE" # Optionally remove patch file on failure
  exit 1
fi

# Clean up the temporary patch file on success
rm "$TEMP_PATCH_FILE"
echo "Temporary patch file $TEMP_PATCH_FILE removed."

echo "---"
echo "Correction for 'pgConfigManager' unused variable applied to src/createServer.ts."
echo "Please try your ESLint check or build again."
echo "---"