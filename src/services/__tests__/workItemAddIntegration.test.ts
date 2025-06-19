// src/services/__tests__/workItemAddIntegration.test.ts
import { setupTestEnvironment, cleanDatabase } from './integrationSetup.js';
import { AppError } from '../../utils/errors.js';

describe('WorkItemService - Add Work Item Integration Tests', () => {
  let testEnvironment: Awaited<ReturnType<typeof setupTestEnvironment>>;

  beforeEach(async () => {
    testEnvironment = await setupTestEnvironment();
    await cleanDatabase(testEnvironment.pool);
  });

  afterAll(async () => {
    if (testEnvironment && testEnvironment.pool) {
      await testEnvironment.pool.end();
    }
  });

  describe('addWorkItem', () => {
    it('should add a root work item without dependencies', async () => {
      const input = {
        name: 'Root Task',
        description: 'A root-level task.',
      };
      const result = await testEnvironment.workItemService.addWorkItem(input);

      expect(result).toBeDefined();
      expect(result.name).toBe(input.name);
      expect(result.parent_work_item_id).toBeNull();

      const fetched = await testEnvironment.workItemService.getWorkItemById(result.work_item_id);
      expect(fetched).toBeDefined();
      expect(fetched?.name).toBe(input.name);
    });

    it('should add a child work item with a parent', async () => {
      const parentInput = { name: 'Parent Task' };
      const parent = await testEnvironment.workItemService.addWorkItem(parentInput);

      const childInput = {
        name: 'Child Task',
        parent_work_item_id: parent.work_item_id,
      };
      const child = await testEnvironment.workItemService.addWorkItem(childInput);

      expect(child.parent_work_item_id).toBe(parent.work_item_id);

      const fetchedParent = await testEnvironment.workItemService.getWorkItemById(parent.work_item_id);
      expect(fetchedParent?.children).toHaveLength(1);
      expect(fetchedParent?.children[0].work_item_id).toBe(child.work_item_id);
    });

    it('should add a work item with dependencies', async () => {
      const dep1 = await testEnvironment.workItemService.addWorkItem({ name: 'Dependency 1' });
      const dep2 = await testEnvironment.workItemService.addWorkItem({ name: 'Dependency 2' });

      const input = {
        name: 'Task with Deps',
        dependencies: [
          { depends_on_work_item_id: dep1.work_item_id },
          { depends_on_work_item_id: dep2.work_item_id, dependency_type: 'linked' as const },
        ],
      };
      const result = await testEnvironment.workItemService.addWorkItem(input);

      const fetched = await testEnvironment.workItemService.getWorkItemById(result.work_item_id);
      expect(fetched?.dependencies).toHaveLength(2);
      const depIds = fetched?.dependencies.map((d) => d.depends_on_work_item_id);
      expect(depIds).toContain(dep1.work_item_id);
      expect(depIds).toContain(dep2.work_item_id);
    });

    it('should clear the redo stack when adding a new item', async () => {
      const itemToUndo = await testEnvironment.workItemService.addWorkItem({ name: 'Undo Me' });
      await testEnvironment.workItemService.deleteWorkItem([itemToUndo.work_item_id]);
      const undoneAction = await testEnvironment.workItemService.undoLastAction();
      expect(undoneAction).toBeDefined();
      expect(undoneAction?.is_undone).toBe(true);

      await testEnvironment.workItemService.addWorkItem({ name: 'New Action' });

      const redoResult = await testEnvironment.workItemService.redoLastUndo();
      expect(redoResult).toBeNull();
    });

    it('should validate parent work item is active', async () => {
      const parent = await testEnvironment.workItemService.addWorkItem({ name: 'Parent to delete' });
      await testEnvironment.workItemService.deleteWorkItem([parent.work_item_id]);

      const childInput = {
        name: 'I should fail',
        parent_work_item_id: parent.work_item_id,
      };

      try {
        await testEnvironment.workItemService.addWorkItem(childInput);
        fail('Expected addWorkItem to throw an error for inactive parent, but it did not.');
      } catch (error: any) {
        expect(error).toBeInstanceOf(AppError);
        expect(error.errorCode).toBe('ValidationError');
        expect(error.message).toContain('is not active');
      }
    });

    it('should throw validation error for non-existent parent', async () => {
      const nonExistentId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
      const childInput = {
        name: 'I should also fail',
        parent_work_item_id: nonExistentId,
      };

      try {
        await testEnvironment.workItemService.addWorkItem(childInput);
        fail('Expected addWorkItem to throw for non-existent parent');
      } catch (error: any) {
        expect(error).toBeInstanceOf(AppError);
        expect(error.errorCode).toBe('ValidationError');
        expect(error.message).toContain('not found');
      }
    });

    it('should not allow adding children to a "done" work item', async () => {
      const parent = await testEnvironment.workItemService.addWorkItem({ name: 'Completed Project' });
      await testEnvironment.workItemService.setStatus(parent.work_item_id, 'done');

      const childInput = {
        name: 'Late addition',
        parent_work_item_id: parent.work_item_id,
      };

      try {
        await testEnvironment.workItemService.addWorkItem(childInput);
        fail('Expected addWorkItem to throw for "done" parent');
      } catch (error: any) {
        expect(error).toBeInstanceOf(AppError);
        expect(error.errorCode).toBe('ValidationError');
        expect(error.message).toContain('is "done"');
      }
    });
  });
});
