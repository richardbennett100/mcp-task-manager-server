// src/services/WorkItemService.spec.ts
import { WorkItemService } from '../../WorkItemService.js';
import { WorkItemRepository } from '../../../repositories/WorkItemRepository.js';
import { ActionHistoryRepository } from '../../../repositories/ActionHistoryRepository.js';
import { jest } from '@jest/globals';

// --- Mock the repository classes ---
// Use jest.mock to automatically mock the classes and their methods
// This avoids issues with private members and complex types in manual mocks.
jest.mock('../repositories/WorkItemRepository.js');
jest.mock('../repositories/ActionHistoryRepository.js');


describe('WorkItemService', () => {
  let workItemService: WorkItemService;
  // Declare variables to hold the mocked instances
  let MockedWorkItemRepository: jest.Mocked<WorkItemRepository>;
  let MockedActionHistoryRepository: jest.Mocked<ActionHistoryRepository>;

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();

    // Create new instances of the mocked classes
    // Cast to the mocked type.
    MockedWorkItemRepository = new WorkItemRepository({} as any) as jest.Mocked<WorkItemRepository>;
    MockedActionHistoryRepository = new ActionHistoryRepository({} as any) as jest.Mocked<ActionHistoryRepository>;

    // Instantiate the service with the mocked instances
    workItemService = new WorkItemService(
      MockedWorkItemRepository,
      MockedActionHistoryRepository
    );
  });

  // Basic test to ensure the service can be instantiated
  it('should instantiate correctly', () => {
    expect(workItemService).toBeInstanceOf(WorkItemService);
  });

  // --- REMOVED Data-Dependent Test ---
  // The test 'should add a new work item and return the created item'
  // has been removed from this unit test file. It will be implemented
  // as an integration test in WorkItemService.integration.spec.ts
  // to verify the interaction with the database and history recording.
  // --- End REMOVED Data-Dependent Test ---


  // TODO: Add unit tests for any WorkItemService methods that *don't*
  // primarily rely on repository interactions or complex data states.
  // Examples (if applicable):
  // - Input validation logic before calling repositories.
  // - Pure helper functions within the service.
  // - Basic checks that the correct repository methods are called (without deep data verification).

});