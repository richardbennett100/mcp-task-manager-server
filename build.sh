#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e
set -o pipefail # IMPORTANT: Ensure pipeline errors are propagated

# --- Configuration ---
PG_CONTAINER_NAME="local-postgres-tasks"
PG_USER="taskmanager_user"
PG_DATABASE="taskmanager_db"
SCHEMA_FILE_PATH="./src/db/schema.sql" # Path to your schema file

# Log file names
MAIN_OUTPUT_LOG="./logs/1.build_and_test_output.log"
UNIT_TEST_LOG="./logs/2.unit_test.log"
INTEGRATION_TEST_LOG="./logs/3.integration_test.log"
INTEGRATION_AUDIT_LOG="./logs/4.integration_test_auditlog.log"
E2E_TEST_LOG="./logs/5.e2e_test.log"
E2E_AUDIT_LOG="./logs/6.e2e_test_auditlog.log"

# --- Helper Functions ---
get_current_date() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

log_command_output() {
  local log_file="$1"
  local description="$2"
  local command_to_run="${*:3}"

  echo "--------------------------------------------------" >> "$log_file"
  echo "STARTING: $description at $(get_current_date)" >> "$log_file"
  echo "COMMAND: $command_to_run" >> "$log_file"
  echo "--------------------------------------------------" >> "$log_file"

  set +e # Temporarily disable set -e to capture the exit code of eval
  eval "$command_to_run" >> "$log_file" 2>&1
  cmd_exit_code=$?
  set -e # Re-enable set -e

  if [ $cmd_exit_code -eq 0 ]; then
    echo "FINISHED: $description at $(get_current_date)" >> "$log_file"
    echo "$description: SUCCESS" # To console
    echo "--------------------------------------------------" >> "$log_file"
    echo "" >> "$log_file"
    return 0
  else
    echo "ERROR: Command '$description' failed with exit code $cmd_exit_code." >&2 # To console (stderr)
    echo "FAILURE: $description FAILED with exit code $cmd_exit_code at $(get_current_date)" >> "$log_file" # To log file
    echo "--------------------------------------------------" >> "$log_file"
    echo "" >> "$log_file"
    exit $cmd_exit_code # Exit the entire script with the failed command's exit code
  fi
}

query_audit_log_for_phase() {
  local audit_log_file="$1"
  local phase_start_date="$2"
  local phase_description="$3"

  echo "Querying audit log for $phase_description (since $phase_start_date)..." # To console
  echo "" >> "$audit_log_file"
  echo "--- AUDIT LOG FOR PHASE: $phase_description (Entries SINCE $phase_start_date) ---" >> "$audit_log_file"

  local psql_command="docker exec -i \"$PG_CONTAINER_NAME\" psql -U \"$PG_USER\" -d \"$PG_DATABASE\" -X -A -t -c \"SELECT * FROM audit_log WHERE log_timestamp >= '$phase_start_date';\""

  local psql_success=true
  set +e
  eval "$psql_command" >> "$audit_log_file" 2>> "$audit_log_file" # Log both stdout and stderr from psql to the audit log file
  if [ $? -ne 0 ]; then
    psql_success=false
    echo "ERROR: psql command for '$phase_description' audit log failed. See $audit_log_file for details." >> "$MAIN_OUTPUT_LOG"
  fi
  set -e

  if [ "$psql_success" = true ]; then
    echo "SUCCESS: Audit log query for '$phase_description' successful." >> "$audit_log_file"
    echo "$phase_description Audit Query: SUCCESS"
  else
    echo "FAILURE: Audit log query for '$phase_description' failed. Command was: $psql_command. Check $audit_log_file." >> "$audit_log_file"
    echo "$phase_description Audit Query: FAILED (see $audit_log_file and $MAIN_OUTPUT_LOG)"
  fi
  echo "--- END AUDIT LOG FOR PHASE: $phase_description ---" >> "$audit_log_file"
  echo "" >> "$audit_log_file"
}

check_log_for_critical_errors() {
  local log_to_check="$1"
  local test_file_description="$2"

  echo "Checking $log_to_check for critical error patterns for $test_file_description..." >> "$log_to_check"

  if grep -q -E "^FAIL " "$log_to_check"; then
    echo "CRITICAL LOG ERROR: Pattern '^FAIL ' found in $log_to_check for $test_file_description. Details:" >&2  >> "$log_to_check"
    grep -n -E "^FAIL " "$log_to_check" >&2
    return 1
  fi

  if grep -q -F "console.error" "$log_to_check"; then
    echo "CRITICAL LOG ERROR: String 'console.error' found in $log_to_check for $test_file_description. Details:" >&2  >> "$log_to_check"
    grep -n -F "console.error" "$log_to_check" >&2
    return 1
  fi

  echo "No critical error patterns found in $log_to_check for $test_file_description."  >> "$log_to_check"
  return 0
}

clear_log_files() {
  mkdir -p ./logs
  echo "" > "$MAIN_OUTPUT_LOG"
  echo "" > "$UNIT_TEST_LOG"
  echo "" > "$INTEGRATION_TEST_LOG"
  echo "" > "$INTEGRATION_AUDIT_LOG"
  echo "" > "$E2E_TEST_LOG"
  echo "" > "$E2E_AUDIT_LOG"
  echo "Log files emptied."
  echo ""
}

format_lint_build(){
    echo "===== Formatting, Linting, and Building ====="
    log_command_output "$MAIN_OUTPUT_LOG" "Prettier (All files)" "npm run format"
    log_command_output "$MAIN_OUTPUT_LOG" "ESLint (All files)" "npm run lint -- --fix"
    log_command_output "$MAIN_OUTPUT_LOG" "Build (All files)" "npm run build"
    echo "Format, Lint, Build: COMPLETED SUCCESSFULLY"
    echo ""
}

rebuild_database_schema_directly() {
  echo "===== Rebuilding Database Schema Directly via psql (from build.sh) =====" | tee -a "$MAIN_OUTPUT_LOG"
  
  if [ ! -f "$SCHEMA_FILE_PATH" ]; then
    echo "ERROR: Schema file not found at $SCHEMA_FILE_PATH" | tee -a "$MAIN_OUTPUT_LOG" >&2
    exit 1
  fi

  echo "Executing schema file: $SCHEMA_FILE_PATH against database $PG_DATABASE" | tee -a "$MAIN_OUTPUT_LOG"
  
  local psql_exec_command="cat \"$SCHEMA_FILE_PATH\" | docker exec -i \"$PG_CONTAINER_NAME\" psql -v ON_ERROR_STOP=1 -U \"$PG_USER\" -d \"$PG_DATABASE\" -X -a -P pager=off --set=SHOW_CONTEXT=errors --single-transaction"
  
  log_command_output "$MAIN_OUTPUT_LOG" "Database Schema Rebuild (Direct psql)" "$psql_exec_command"
  echo "" 
}

# NEW FUNCTION to verify table existence via psql
verify_tables_exist_via_psql() {
  echo "===== Verifying Table Existence via psql (after schema rebuild) =====" | tee -a "$MAIN_OUTPUT_LOG"
  # -t is for tuples_only, removes headers and footers.
  # We expect 'work_items' and 'action_history' to be listed.
  local psql_check_command="docker exec -i \"$PG_CONTAINER_NAME\" psql -U \"$PG_USER\" -d \"$PG_DATABASE\" -X -t -c \"SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('work_items', 'action_history') ORDER BY table_name;\""
  
  echo "Verifying essential tables (work_items, action_history) exist..." | tee -a "$MAIN_OUTPUT_LOG"
  log_command_output "$MAIN_OUTPUT_LOG" "Verify Tables Exist (psql)" "$psql_check_command"
  # The output of this command will be in $MAIN_OUTPUT_LOG.
  # You'll need to inspect it to see if 'work_items' and 'action_history' are listed.
  # log_command_output will cause script to exit if psql_check_command fails.
  echo "Table verification command executed. Please check log for results." | tee -a "$MAIN_OUTPUT_LOG"
  echo ""
}

run_tests() {
    local test_type="$1"
    local search_path=""
    local log_file_name=""
    local audit_log_name=""
    local test_phase_name=""

    case "$test_type" in
        (unit)
            search_path="\./dist/services/__tests__/unit/.*\.spec\.js$"
            log_file_name="$UNIT_TEST_LOG"
            test_phase_name="Unit Tests"
            ;;
        (integration)
            search_path="\./dist/services/__tests__/.*\.test\.js$" 
            log_file_name="$INTEGRATION_TEST_LOG"
            audit_log_name="$INTEGRATION_AUDIT_LOG"
            test_phase_name="Integration Tests"
            ;;
        (e2e)
            search_path="\./dist/__tests__/e2e/.*\.test\.js$"
            log_file_name="$E2E_TEST_LOG"
            audit_log_name="$E2E_AUDIT_LOG"
            test_phase_name="E2E Tests"
            ;;
        (*)
            echo "Error: Invalid test type '$test_type'. Must be 'unit', 'integration', or 'e2e'." >&2
            return 1
            ;;
    esac

    echo "===== Run $test_type tests ====="  >> "$log_file_name"
    echo "Using search path: $search_path"  >> "$log_file_name"
    echo "Logging to: $log_file_name"  >> "$log_file_name"
    if [ -n "$audit_log_name" ]; then
        echo "Audit logging to: $audit_log_name"  >> "$log_file_name"
    fi

    local tests_start_date
    tests_start_date=$(get_current_date)

    local test_files_output 
    test_files_output=$(find ./dist -type f -regex "$search_path")

    if [ -z "$test_files_output" ]; then
        echo "No $test_type test files found for search path: $search_path" >> "$log_file_name"
        echo "Run $test_type tests: NO FILES FOUND, COMPLETED (no tests run)" 
        echo ""
        return 0 
    fi

    echo "Found $test_type test files:"  >> "$log_file_name"
    echo "$test_files_output"  >> "$log_file_name"

    local original_ifs="$IFS"
    IFS=$'\n'
    for test_file_path in $test_files_output; do
        IFS="$original_ifs" 
        echo "Running $test_type test: $test_file_path" 

        # <<< ADD EXTRA VERIFICATION HERE for integration tests >>>
        if [ "$test_type" = "integration" ]; then
            echo "===== Pre-Integration Test File Verification for $test_file_path =====" | tee -a "$MAIN_OUTPUT_LOG"
            local psql_check_command_inner="docker exec -i \"$PG_CONTAINER_NAME\" psql -U \"$PG_USER\" -d \"$PG_DATABASE\" -X -t -c \"SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('work_items', 'action_history') ORDER BY table_name;\""
            # Log this to a different place or just let it go to main log for now
            set +e
            docker exec -i "$PG_CONTAINER_NAME" psql -U "$PG_USER" -d "$PG_DATABASE" -X -t -c "SELECT 'PRE-TEST-CHECK for $test_file_path:' AS context, table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('work_items', 'action_history') ORDER BY table_name;" >> "$MAIN_OUTPUT_LOG" 2>&1
            set -e
            echo "Pre-Integration Test File Verification for $test_file_path done." | tee -a "$MAIN_OUTPUT_LOG"
        fi

        log_command_output "$log_file_name" "$test_type test: \"$test_file_path\" (--bail)" "npm run test -- \"$test_file_path\" --bail"
        
        check_log_for_critical_errors "$log_file_name" "$test_file_path"
        local log_check_exit_code=$?
        if [ $log_check_exit_code -ne 0 ]; then
            echo "Error: Critical error pattern found in log for $test_file_path. Stopping." >&2
            echo "Run $test_type tests: FAILED due to critical log pattern for $test_file_path" >> "$log_file_name"
            exit $log_check_exit_code
        fi
        IFS=$'\n' 
    done
    IFS="$original_ifs"

    if [ "$test_type" != "unit" ]; then
      if [ -n "$audit_log_name" ]; then
          query_audit_log_for_phase "$audit_log_name" "$tests_start_date" "$test_phase_name"
      fi
    fi
    
    echo "Run $test_type tests: COMPLETED SUCCESSFULLY" 
    echo "" 
}

# --- Main Script ---

clear_log_files

format_lint_build

rebuild_database_schema_directly

# ADDED VERIFICATION STEP
verify_tables_exist_via_psql

#run_tests "unit"

#read -p "Press Enter to continue..."

run_tests "integration"

run_tests "e2e"

echo "All script phases completed successfully."