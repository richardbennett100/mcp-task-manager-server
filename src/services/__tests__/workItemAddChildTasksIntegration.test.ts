// src/services/__tests__/workItemAddChildTasksIntegration.test.ts
import { setupTestEnvironment, cleanDatabase } from './integrationSetup.js';
import { WorkItemService } from '../WorkItemService.js';
import { AppError } from '../../utils/errors.js';

describe('WorkItemService - Add Child Tasks Integration Tests', () => {
  let testEnvironment: Awaited<ReturnType<typeof setupTestEnvironment>>;
  let workItemService: WorkItemService;

  beforeEach(async () => {
    testEnvironment = await setupTestEnvironment();
    workItemService = testEnvironment.workItemService;
    await cleanDatabase(testEnvironment.pool);
  });

  afterAll(async () => {
    if (testEnvironment.pool) {
      await testEnvironment.pool.end();
    }
  });

  it('should add multiple child tasks under a parent project', async () => {
    const project = await workItemService.addWorkItem({
      name: 'Parent Project',
    });

    const childTasksTree = [
      {
        name: 'Child Task 1',
        description: 'First child',
        children: [
          {
            name: 'Sub-task 1.1',
          },
        ],
      },
      {
        name: 'Child Task 2',
      },
    ];

    const createdItems = await workItemService.addWorkItemTree(project.work_item_id, childTasksTree);

    expect(createdItems).toHaveLength(3);

    const fullTree = await workItemService.getFullTree(project.work_item_id);

    // **THE FIX**: Use nested checks to be explicit for the TypeScript compiler.
    expect(fullTree).toBeDefined();
    if (fullTree && fullTree.children) {
      expect(fullTree.children).toHaveLength(2);

      const child1 = fullTree.children[0];
      if (child1) {
        expect(child1.name).toBe('Child Task 1');
        expect(child1.children).toBeDefined();
        if (child1.children) {
          expect(child1.children).toHaveLength(1);
          const subTask1 = child1.children[0];
          if (subTask1) {
            expect(subTask1.name).toBe('Sub-task 1.1');
          }
        }
      }

      const child2 = fullTree.children[1];
      if (child2) {
        expect(child2.name).toBe('Child Task 2');
      }
    }
  });

  it('add_child_tasks: should fail with ValidationError if parent_work_item_id is an invalid UUID format', async () => {
    const invalidUuidParentId = 'not-a-uuid';
    const childTasksTree = [{ name: 'Should Fail' }];

    try {
      await workItemService.addWorkItemTree(invalidUuidParentId, childTasksTree);
      fail('Should have thrown ValidationError for invalid parent UUID format');
    } catch (error: any) {
      expect(error).toBeDefined();
      if (!error) return;

      expect(error).toBeInstanceOf(AppError);
      expect(error.errorCode).toBe('ValidationError');
      expect((error as Error).message).toContain(`Invalid parent_work_item_id format: ${invalidUuidParentId}`);
    }
  });

  it('add_child_tasks: should fail with NotFoundError if parent_work_item_id is valid format but does not exist', async () => {
    const nonExistentButValidUuidParentId = '123e4567-e89b-12d3-a456-426614174000';
    const childTasksTree = [{ name: 'Should Also Fail' }];

    try {
      await workItemService.addWorkItemTree(nonExistentButValidUuidParentId, childTasksTree);
      fail('Should have thrown an error for non-existent parent');
    } catch (error: any) {
      expect(error).toBeDefined();
      if (!error) return;

      expect(error).toBeInstanceOf(AppError);
      expect(error.errorCode).toBe('NotFound');
      expect((error as Error).message).toContain(
        `Initial parent work item with ID ${nonExistentButValidUuidParentId} not found or is inactive.`
      );
    }
  });
});
