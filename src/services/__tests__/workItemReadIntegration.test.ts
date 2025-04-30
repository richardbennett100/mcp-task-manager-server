// src/services/__tests__/workItemReadIntegration.test.ts
import { setupTestEnvironment, cleanDatabase } from './integrationSetup.js';
import { WorkItemData } from '../../repositories/WorkItemRepository.js';

describe('WorkItemService - List and Read Operations Integration Tests', () => {
  let testEnvironment: Awaited<ReturnType<typeof setupTestEnvironment>>;
  let rootProject1: WorkItemData, 
      rootProject2: WorkItemData, 
      childTask1: WorkItemData, 
      childTask2: WorkItemData;

  beforeAll(async () => {
    testEnvironment = await setupTestEnvironment();
  });

  beforeEach(async () => {
    await cleanDatabase(testEnvironment.pool);

    // Setup a hierarchy of work items with different statuses
    rootProject1 = await testEnvironment.workItemService.addWorkItem({ 
      name: 'Root Project 1', 
      priority: 'high' 
    });
    
    rootProject2 = await testEnvironment.workItemService.addWorkItem({ 
      name: 'Root Project 2', 
      priority: 'low' 
    });
    
    childTask1 = await testEnvironment.workItemService.addWorkItem({ 
      name: 'Child Task 1 (In Progress)', 
      parent_work_item_id: rootProject1.work_item_id,
      status: 'in-progress',
      priority: 'medium'
    });
    
    childTask2 = await testEnvironment.workItemService.addWorkItem({ 
      name: 'Child Task 2 (Todo)', 
      parent_work_item_id: rootProject1.work_item_id,
      status: 'todo',
      priority: 'high'
    });
  });

  afterAll(async () => {
    if (testEnvironment.pool) {
      await testEnvironment.pool.end();
    }
  });

  describe('getWorkItemById', () => {
    it('should retrieve a work item with full details', async () => {
      const depTarget = await testEnvironment.workItemService.addWorkItem({ 
        name: 'Dependency Target' 
      });
      
      // Add a dependency to child task 1
      await testEnvironment.workItemService.updateWorkItem(
        childTask1.work_item_id, 
        {}, 
        [{ 
          depends_on_work_item_id: depTarget.work_item_id 
        }]
      );

      const retrievedItem = await testEnvironment.workItemService.getWorkItemById(
        childTask1.work_item_id
      );
      
      expect(retrievedItem).toBeDefined();
      expect(retrievedItem?.work_item_id).toBe(childTask1.work_item_id);
      expect(retrievedItem?.parent_work_item_id).toBe(rootProject1.work_item_id);
      
      // Check dependencies
      expect(retrievedItem?.dependencies).toHaveLength(1);
      expect(retrievedItem?.dependencies[0].depends_on_work_item_id).toBe(depTarget.work_item_id);
    });

    it('should return null for non-existent work item', async () => {
      const nonExistentId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
      const result = await testEnvironment.workItemService.getWorkItemById(nonExistentId);
      
      expect(result).toBeNull();
    });
  });

  describe('listWorkItems', () => {
    it('should list all root projects', async () => {
      const rootProjects = await testEnvironment.workItemService.listWorkItems({ 
        rootsOnly: true 
      });
      
      expect(rootProjects.length).toBe(2);
      const rootProjectIds = rootProjects.map(p => p.work_item_id);
      expect(rootProjectIds).toContain(rootProject1.work_item_id);
      expect(rootProjectIds).toContain(rootProject2.work_item_id);
    });

    it('should list children of a specific parent', async () => {
      const childrenOfRootProject1 = await testEnvironment.workItemService.listWorkItems({ 
        parent_work_item_id: rootProject1.work_item_id 
      });
      
      expect(childrenOfRootProject1.length).toBe(2);
      const childIds = childrenOfRootProject1.map(c => c.work_item_id);
      expect(childIds).toContain(childTask1.work_item_id);
      expect(childIds).toContain(childTask2.work_item_id);
    });

    it('should filter work items by status', async () => {
      const todoItems = await testEnvironment.workItemService.listWorkItems({ 
        status: 'todo' 
      });
      
      expect(todoItems.length).toBe(1);
      expect(todoItems[0].work_item_id).toBe(childTask2.work_item_id);
      
      const inProgressItems = await testEnvironment.workItemService.listWorkItems({ 
        status: 'in-progress' 
      });
      
      expect(inProgressItems.length).toBe(1);
      expect(inProgressItems[0].work_item_id).toBe(childTask1.work_item_id);
    });

    it('should filter inactive items', async () => {
      // Soft delete one of the root projects
      await testEnvironment.workItemService.deleteWorkItem([rootProject2.work_item_id]);

      // Default (active only)
      const activeProjects = await testEnvironment.workItemService.listWorkItems({ 
        rootsOnly: true 
      });
      expect(activeProjects.length).toBe(1);
      expect(activeProjects[0].work_item_id).toBe(rootProject1.work_item_id);

      // Explicitly list inactive
      const inactiveProjects = await testEnvironment.workItemService.listWorkItems({ 
        rootsOnly: true, 
        isActive: false 
      });
      expect(inactiveProjects.length).toBe(1);
      expect(inactiveProjects[0].work_item_id).toBe(rootProject2.work_item_id);
    });
  });
});