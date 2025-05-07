#!/bin/bash

npm run ci:test > build_and_test_output.log 2>&1

docker exec -i local-postgres-tasks psql -U taskmanager_user -d taskmanager_db -c "SELECT * FROM audit_log" >> build_and_test_output.log 2>&1



