// src/services/__tests__/workItemGetNextTaskIntegration.test.ts
import { setupTestEnvironment, cleanDatabase } from './integrationSetup.js';
import { type WorkItemData } from '../../repositories/index.js';
import { logger } from '../../utils/logger.js';
import { addHours, formatISO } from 'date-fns'; // Using date-fns for date manipulation

// Helper function to get current time + offset in ISO format
const getDateISO = (hoursOffset = 0): string => {
  return formatISO(addHours(new Date(), hoursOffset));
};

describe('WorkItemService - Get Next Task Integration Tests', () => {
  let testEnvironment: Awaited<ReturnType<typeof setupTestEnvironment>>;
  let projA: WorkItemData,
    taskA1: WorkItemData,
    taskA2_PrioHigh: WorkItemData,
    taskA3_DueSoon: WorkItemData,
    taskA4_DueLater: WorkItemData,
    taskA5_Done: WorkItemData,
    taskA6_Blocked: WorkItemData,
    taskA7_DepDone: WorkItemData;
  let projB: WorkItemData, taskB1_TagFE: WorkItemData, taskB2_TagBE: WorkItemData, taskB3_TagBoth: WorkItemData;

  beforeAll(async () => {
    testEnvironment = await setupTestEnvironment();
  });

  // Setup a variety of tasks before each test
  beforeEach(async () => {
    await cleanDatabase(testEnvironment.pool);
    logger.debug('[GetNextTaskTest Setup] Database cleaned.');

    // --- Project A ---
    projA = await testEnvironment.workItemService.addWorkItem({
      name: 'Project A',
    });
    logger.debug(`[GetNextTaskTest Setup] Created projA: ${projA.work_item_id}`);

    // Task A1: Simple, medium priority, no due date, should be picked if nothing else qualifies
    taskA1 = await testEnvironment.workItemService.addWorkItem({
      name: 'Task A1 - Medium Prio, No Due Date',
      parent_work_item_id: projA.work_item_id,
      priority: 'medium',
      status: 'todo',
    });
    logger.debug(`[GetNextTaskTest Setup] Created taskA1: ${taskA1.work_item_id}`);

    // Task A2: High priority, no due date (should be picked over A1 if due dates are same/null)
    taskA2_PrioHigh = await testEnvironment.workItemService.addWorkItem({
      name: 'Task A2 - High Prio, No Due Date',
      parent_work_item_id: projA.work_item_id,
      priority: 'high',
      status: 'todo',
    });
    logger.debug(`[GetNextTaskTest Setup] Created taskA2_PrioHigh: ${taskA2_PrioHigh.work_item_id}`);

    // Task A3: Medium priority, due soon (should be picked over A2 and A4)
    taskA3_DueSoon = await testEnvironment.workItemService.addWorkItem({
      name: 'Task A3 - Medium Prio, Due Soon',
      parent_work_item_id: projA.work_item_id,
      priority: 'medium',
      status: 'todo',
      due_date: getDateISO(1), // Due in 1 hour
    });
    logger.debug(`[GetNextTaskTest Setup] Created taskA3_DueSoon: ${taskA3_DueSoon.work_item_id}`);

    // Task A4: Medium priority, due later (should be picked after A3)
    taskA4_DueLater = await testEnvironment.workItemService.addWorkItem({
      name: 'Task A4 - Medium Prio, Due Later',
      parent_work_item_id: projA.work_item_id,
      priority: 'medium',
      status: 'todo',
      due_date: getDateISO(24), // Due in 24 hours
    });
    logger.debug(`[GetNextTaskTest Setup] Created taskA4_DueLater: ${taskA4_DueLater.work_item_id}`);

    // Task A5: Done status - should never be picked
    taskA5_Done = await testEnvironment.workItemService.addWorkItem({
      name: 'Task A5 - Done',
      parent_work_item_id: projA.work_item_id,
      priority: 'high',
      status: 'done',
      due_date: getDateISO(-1), // Already past due, but done
    });
    logger.debug(`[GetNextTaskTest Setup] Created taskA5_Done: ${taskA5_Done.work_item_id}`);

    // Task A6: Blocked by A1 (which is 'todo')
    taskA6_Blocked = await testEnvironment.workItemService.addWorkItem({
      name: 'Task A6 - Blocked by A1',
      parent_work_item_id: projA.work_item_id,
      priority: 'high',
      status: 'todo',
      due_date: getDateISO(0.5), // Due very soon, but blocked
      dependencies: [{ depends_on_work_item_id: taskA1.work_item_id }],
    });
    logger.debug(`[GetNextTaskTest Setup] Created taskA6_Blocked: ${taskA6_Blocked.work_item_id}`);

    // Task A7: Dependency is A5 (which is 'done') - should be available if highest prio otherwise
    taskA7_DepDone = await testEnvironment.workItemService.addWorkItem({
      name: 'Task A7 - Depends on Done A5',
      parent_work_item_id: projA.work_item_id,
      priority: 'high',
      status: 'todo',
      due_date: getDateISO(2), // Due after A3, before A4
      dependencies: [{ depends_on_work_item_id: taskA5_Done.work_item_id }],
    });
    logger.debug(`[GetNextTaskTest Setup] Created taskA7_DepDone: ${taskA7_DepDone.work_item_id}`);

    // --- Project B (For Tagging/Scope) ---
    projB = await testEnvironment.workItemService.addWorkItem({
      name: 'Project B - Tags',
    });
    logger.debug(`[GetNextTaskTest Setup] Created projB: ${projB.work_item_id}`);

    // B1: Frontend tag
    taskB1_TagFE = await testEnvironment.workItemService.addWorkItem({
      name: 'Task B1 - Tag Frontend',
      parent_work_item_id: projB.work_item_id,
      priority: 'medium',
      status: 'in-progress',
      // Add tags requires update via service method currently (schema needs update)
      // We'll update it after creation
    });
    // Update with tags (assuming a setTags method or updateWorkItem enhancement exists)
    // For now, we'll assume tags were added somehow or test tag filtering separately
    // when tag modification tools are available.
    // await testEnvironment.workItemService.updateWorkItem(taskB1_TagFE.work_item_id, { tags: ['frontend'] });
    logger.debug(`[GetNextTaskTest Setup] Created taskB1_TagFE: ${taskB1_TagFE.work_item_id} (Tags not added yet)`);

    // B2: Backend tag
    taskB2_TagBE = await testEnvironment.workItemService.addWorkItem({
      name: 'Task B2 - Tag Backend',
      parent_work_item_id: projB.work_item_id,
      priority: 'high', // Higher priority than B1
      status: 'todo',
      // Add tags requires update
      // await testEnvironment.workItemService.updateWorkItem(taskB2_TagBE.work_item_id, { tags: ['backend'] });
    });
    logger.debug(`[GetNextTaskTest Setup] Created taskB2_TagBE: ${taskB2_TagBE.work_item_id} (Tags not added yet)`);

    // B3: Both tags
    taskB3_TagBoth = await testEnvironment.workItemService.addWorkItem({
      name: 'Task B3 - Tag Frontend and Backend',
      parent_work_item_id: projB.work_item_id,
      priority: 'medium',
      status: 'todo',
      // Add tags requires update
      // await testEnvironment.workItemService.updateWorkItem(taskB3_TagBoth.work_item_id, { tags: ['frontend', 'backend'] });
    });
    logger.debug(`[GetNextTaskTest Setup] Created taskB3_TagBoth: ${taskB3_TagBoth.work_item_id} (Tags not added yet)`);

    logger.debug('[GetNextTaskTest Setup] Finished creating test data.');
  });

  afterAll(async () => {
    if (testEnvironment.pool) {
      await testEnvironment.pool.end();
    }
  });

  // --- Test Cases ---

  it('should return null if no actionable tasks exist', async () => {
    // Mark all existing tasks as done or inactive
    await testEnvironment.workItemService.setStatus(taskA1.work_item_id, 'done');
    await testEnvironment.workItemService.setStatus(taskA2_PrioHigh.work_item_id, 'done');
    await testEnvironment.workItemService.setStatus(taskA3_DueSoon.work_item_id, 'done');
    await testEnvironment.workItemService.setStatus(taskA4_DueLater.work_item_id, 'done');
    // A5 is already done
    await testEnvironment.workItemService.setStatus(taskA6_Blocked.work_item_id, 'done');
    await testEnvironment.workItemService.setStatus(taskA7_DepDone.work_item_id, 'done');
    await testEnvironment.workItemService.setStatus(taskB1_TagFE.work_item_id, 'done');
    await testEnvironment.workItemService.setStatus(taskB2_TagBE.work_item_id, 'done');
    await testEnvironment.workItemService.setStatus(taskB3_TagBoth.work_item_id, 'done');

    const nextTask = await testEnvironment.workItemService.getNextTask({});
    expect(nextTask).toBeNull();
  });

  it('should prioritize task by earliest due date', async () => {
    const nextTask = await testEnvironment.workItemService.getNextTask({});
    // Expected: A3 (Due Soon) is the earliest due date among actionable tasks
    // A6 is due sooner but blocked by A1 (todo)
    expect(nextTask).toBeDefined();
    expect(nextTask?.work_item_id).toBe(taskA3_DueSoon.work_item_id);
  });

  it('should prioritize task by priority when due dates are same or null', async () => {
    // Make A3 and A7 done so they aren't picked by due date
    await testEnvironment.workItemService.setStatus(taskA3_DueSoon.work_item_id, 'done');
    await testEnvironment.workItemService.setStatus(taskA7_DepDone.work_item_id, 'done');
    await testEnvironment.workItemService.setStatus(taskA4_DueLater.work_item_id, 'done'); // Make A4 done too

    // Now candidates are A1 (medium), A2 (high), A6 (high, blocked), B1(medium), B2(high), B3(medium)
    // B2 has no due date and high priority, should be picked over A2 (same prio, no due date, but later creation/order key)
    // Or A2 depending on exact order key/creation time, let's assume B2 is higher based on setup order.
    // A6 is blocked.
    const nextTask = await testEnvironment.workItemService.getNextTask({});
    expect(nextTask).toBeDefined();
    // Check if it's one of the high-priority, available tasks
    expect([taskA2_PrioHigh.work_item_id, taskB2_TagBE.work_item_id]).toContain(nextTask?.work_item_id);
    // If we make B2 medium priority, A2 should be picked
    await testEnvironment.workItemService.setPriority(taskB2_TagBE.work_item_id, 'medium');
    const nextTaskAfterPrioChange = await testEnvironment.workItemService.getNextTask({});
    logger.info('Returned task after prio change:', nextTaskAfterPrioChange); // Or console.log
    expect(nextTaskAfterPrioChange?.work_item_id).toBe(taskA2_PrioHigh.work_item_id);
  });

  // Note: Testing order_key prioritization is tricky without explicit setting/verification,
  // relies on insertion order and default key calculation. Can add if needed.

  it('should not suggest a task blocked by an incomplete dependency', async () => {
    // A6 is due very soon, high priority, but blocked by A1 (todo)
    // A3 is due slightly later, medium priority
    const nextTask = await testEnvironment.workItemService.getNextTask({});
    expect(nextTask).toBeDefined();
    expect(nextTask?.work_item_id).toBe(taskA3_DueSoon.work_item_id); // Should pick A3, not the blocked A6
    expect(nextTask?.work_item_id).not.toBe(taskA6_Blocked.work_item_id);
  });

  it('should suggest a task whose dependency is done', async () => {
    // Make A3 (due soonest) done.
    await testEnvironment.workItemService.setStatus(taskA3_DueSoon.work_item_id, 'done');

    // Now candidates, ordered by repo (Due Date > Prio > OrderKey > Created):
    // 1. A6 (Due 0.5h, High Prio, Blocked by A1) -> Skipped
    // 2. A7 (Due 2h, High Prio, Depends on A5(Done)) -> Available! Should be picked.
    // 3. A2 (Due null, High Prio)
    // 4. A4 (Due 24h, Medium Prio)
    // 5. B2 (Due null, High Prio) - Assume later order key than A2
    // 6. B1 (Due null, Medium Prio)
    // 7. B3 (Due null, Medium Prio)
    // 8. A1 (Due null, Medium Prio) - Assume latest order key

    const nextTask = await testEnvironment.workItemService.getNextTask({});
    expect(nextTask).toBeDefined();
    expect(nextTask?.work_item_id).toBe(taskA7_DepDone.work_item_id);
  });

  it('should filter tasks by scope_item_id', async () => {
    // Get next task only within Project B
    const nextTask = await testEnvironment.workItemService.getNextTask({
      scope_item_id: projB.work_item_id,
    });
    // Inside Proj B, B2 is High Prio, B1/B3 Medium. B2 should be picked.
    expect(nextTask).toBeDefined();
    expect(nextTask?.work_item_id).toBe(taskB2_TagBE.work_item_id); // B2 is highest priority in Proj B
    expect(nextTask?.parent_work_item_id).toBe(projB.work_item_id);

    // Try a task ID as scope - should only consider itself (if actionable) or its children (none here)
    await testEnvironment.workItemService.setStatus(taskA1.work_item_id, 'todo'); // Ensure A1 is actionable
    const nextTaskScopedToA1 = await testEnvironment.workItemService.getNextTask({
      scope_item_id: taskA1.work_item_id,
    });
    expect(nextTaskScopedToA1).toBeDefined();
    expect(nextTaskScopedToA1?.work_item_id).toBe(taskA1.work_item_id); // A1 itself is the only item in its 'tree'

    // Try non-existent scope
    const nonExistentId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    const nextTaskNonExistentScope = await testEnvironment.workItemService.getNextTask({
      scope_item_id: nonExistentId,
    });
    expect(nextTaskNonExistentScope).toBeNull(); // No items in a non-existent scope
  });

  // --- Tag Filtering Tests (Skipped until tag setting is implemented) ---
  /*
  it('should filter tasks by include_tags', async () => {
      // Pre-req: Need to actually add tags to B1, B2, B3 in beforeEach
       await testEnvironment.workItemService.updateWorkItem(taskB1_TagFE.work_item_id, { tags: ['frontend'] });
       await testEnvironment.workItemService.updateWorkItem(taskB2_TagBE.work_item_id, { tags: ['backend'] });
       await testEnvironment.workItemService.updateWorkItem(taskB3_TagBoth.work_item_id, { tags: ['frontend', 'backend'] });


      // Only 'frontend' tasks
      const nextFeTask = await testEnvironment.workItemService.getNextTask({ include_tags: ['frontend'] });
      // B1 and B3 have frontend. B1 is in-progress, B3 is todo. Both Medium Prio. Depends on order key.
      expect(nextFeTask).toBeDefined();
      expect([taskB1_TagFE.work_item_id, taskB3_TagBoth.work_item_id]).toContain(nextFeTask!.work_item_id);

      // Only 'backend' tasks
      const nextBeTask = await testEnvironment.workItemService.getNextTask({ include_tags: ['backend'] });
      // B2 (High Prio) and B3 (Medium Prio) have backend. B2 should be picked.
      expect(nextBeTask).toBeDefined();
      expect(nextBeTask!.work_item_id).toBe(taskB2_TagBE.work_item_id);

      // Both 'frontend' AND 'backend'
       const nextBothTask = await testEnvironment.workItemService.getNextTask({ include_tags: ['frontend', 'backend'] });
       expect(nextBothTask).toBeDefined();
       expect(nextBothTask!.work_item_id).toBe(taskB3_TagBoth.work_item_id); // Only B3 has both


  });

  it('should filter tasks by exclude_tags', async () => {
       // Pre-req: Need to actually add tags to B1, B2, B3 in beforeEach
       await testEnvironment.workItemService.updateWorkItem(taskB1_TagFE.work_item_id, { tags: ['frontend'] });
       await testEnvironment.workItemService.updateWorkItem(taskB2_TagBE.work_item_id, { tags: ['backend', 'urgent'] });
       await testEnvironment.workItemService.updateWorkItem(taskB3_TagBoth.work_item_id, { tags: ['frontend', 'backend'] });

      // Exclude 'frontend' - should pick B2 (backend, urgent) as it's highest prio of remaining
      const nextNonFeTask = await testEnvironment.workItemService.getNextTask({ exclude_tags: ['frontend'] });
      expect(nextNonFeTask).toBeDefined();
      expect(nextNonFeTask!.work_item_id).toBe(taskB2_TagBE.work_item_id);

      // Exclude 'backend' - should pick highest prio non-backend task. A3 due soonest.
      const nextNonBeTask = await testEnvironment.workItemService.getNextTask({ exclude_tags: ['backend'] });
       expect(nextNonBeTask).toBeDefined();
      expect(nextNonBeTask!.work_item_id).toBe(taskA3_DueSoon.work_item_id);


       // Exclude 'urgent' - B2 is excluded. A3 is still due soonest overall.
       const nextNonUrgentTask = await testEnvironment.workItemService.getNextTask({ exclude_tags: ['urgent'] });
        expect(nextNonUrgentTask).toBeDefined();
       expect(nextNonUrgentTask!.work_item_id).toBe(taskA3_DueSoon.work_item_id);

  });

   it('should filter tasks by include_tags and exclude_tags combined', async () => {
       // Pre-req: Need tags added
       await testEnvironment.workItemService.updateWorkItem(taskB1_TagFE.work_item_id, { tags: ['frontend', 'ui'] });
       await testEnvironment.workItemService.updateWorkItem(taskB2_TagBE.work_item_id, { tags: ['backend', 'api'] });
       await testEnvironment.workItemService.updateWorkItem(taskB3_TagBoth.work_item_id, { tags: ['frontend', 'backend', 'refactor'] });

       // Include 'frontend', exclude 'backend' -> should suggest B1
       const nextTask = await testEnvironment.workItemService.getNextTask({ include_tags: ['frontend'], exclude_tags: ['backend'] });
       expect(nextTask).toBeDefined();
       expect(nextTask!.work_item_id).toBe(taskB1_TagFE.work_item_id);

       // Include 'backend', exclude 'frontend' -> should suggest B2
        const nextTask2 = await testEnvironment.workItemService.getNextTask({ include_tags: ['backend'], exclude_tags: ['frontend'] });
        expect(nextTask2).toBeDefined();
        expect(nextTask2!.work_item_id).toBe(taskB2_TagBE.work_item_id);

   });
  */
});
