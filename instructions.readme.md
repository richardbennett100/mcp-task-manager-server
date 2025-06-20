use the systemPrompt.yml for your system-level instructions.

Review /logs/*.log files for any failing builds or tests.

Instructions for Developers: API Integration & Svelte UI Preparation
This document outlines the next phase of development, focusing on implementing and testing the backend API endpoints to ensure a solid foundation before proceeding with the Svelte UI integration.

Phase 1: API Integration Test Development & Implementation
Objective: To create comprehensive integration tests for existing API endpoints (projectRoutes.ts, sseRoutes.ts) and ensure their full functionality. The API has not been extensively used, and SSE triggers are not yet fully integrated into the services layer.

Prerequisites:

Ensure the project builds successfully with no errors.
Confirm all existing unit and integration tests (including WorkItemService - Promote to Project Integration Tests) are passing.
Familiarize yourself with the overall project structure, especially the src/api/, src/services/, and src/repositories/ directories.
Required Actions:

Create API Integration Test File:

Create a new integration test file, for example: src/api/__tests__/apiIntegration.test.ts.
Set up this test file similar to existing integration tests, including database cleaning routines from src/services/__tests__/integrationSetup.ts.
You will need to use supertest to make HTTP requests against the running Express application.
Define Test Suite for projectRoutes.ts:

Goal: Test the RESTful endpoints for work item management.
Test Cases (Example - Detailed endpoints will be provided upon content access):
POST /projects (Create Project/Work Item):
Test successful creation of a new root project.
Test creation with invalid input (e.g., missing required fields, invalid parent ID).
Test creation of a child task under an existing project.
GET /projects/:id (Get Work Item Details):
Test successful retrieval of an existing work item by ID.
Test retrieval of a non-existent work item (expecting 404 Not Found).
Test retrieval of an inactive work item (if applicable).
GET /projects (List Work Items):
Test listing all active work items.
Test filtering by status, parent ID, etc.
Test listing root-level projects only.
PUT /projects/:id (Update Work Item):
Test updating basic fields (name, description, status, priority).
Test moving work items (changing parent_work_item_id, order_key via relative moves).
Test updating non-existent or inactive work items.
DELETE /projects/:id (Soft Delete Work Item):
Test soft deleting a single work item.
Test cascading soft delete for parent and its children.
Test deleting non-existent work items.
Dependencies: Ensure you mock or appropriately manage dependencies (e.g., database connection) for robust testing.
Define Test Suite for sseRoutes.ts:

Goal: Verify that the SSE endpoint (/events) correctly streams updates as changes occur in the database.
Challenge: The SSE triggers are not yet added to the services layer. Your initial test here will likely fail, explicitly highlighting what is missing.
Test Cases (Example):
Test that connecting to /events establishes an SSE connection.
Test that adding a new work item (via a projectRoutes endpoint) triggers an SSE event on the /events stream containing the new work item's data.
Test that updating a work item triggers an SSE event.
Test that deleting a work item triggers an SSE event.
Test that undo/redo actions trigger appropriate SSE events.
Run API Integration Tests:

Execute the new API integration tests. Expect initial failures, especially for SSE.
Phase 2: API Implementation Completion & Refinement
Objective: To debug and fix any issues identified in Phase 1, ensuring all API integration tests pass and the API functions independently and reliably.

Required Actions:

Address Test Failures Iteratively:

Focus on one failing test or a small group of related tests at a time.
Diagnosis: Analyze the test failure logs, trace the execution through src/api/, src/services/, and src/repositories/ to pinpoint the root cause of the error. Utilize logging statements (logger.debug, logger.info) if necessary for deeper inspection.
Correction: Make the smallest possible code changes to address the identified issue. Avoid large-scale refactoring unless absolutely necessary and explicitly approved.
Re-test: Re-run the specific test(s) you are working on to confirm the fix.
Repeat: Continue this cycle until all API integration tests pass.
Implement SSE Triggers in Services Layer (Crucial for SSE tests):

Based on the failing SSE tests, you will need to add the necessary logic within the src/services/ layer (e.g., WorkItemAddingService, WorkItemUpdateService, WorkItemDeleteService, WorkItemHistoryService) to call SseNotificationService whenever a relevant change occurs in the database. This is a critical missing piece for real-time updates.
Code Quality Check:

Ensure all new or modified code adheres to the project's linting rules (ESLint, Prettier).
Keep in-code comments to a minimum, focusing on essential logic clarification.
Verify that changes do not significantly decrease file sizes unless logic has genuinely been removed.
Future Step (To be evaluated upon content provision): Svelte UI Review
After the API integration tests are stable, we will revisit the ui/ folder. We will assess the existing Svelte UI code to determine if it is suitable for continuation or if starting fresh would be more efficient.