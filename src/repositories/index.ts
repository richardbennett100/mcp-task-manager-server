// src/repositories/index.ts

// Export the main composed classes
export * from './WorkItemRepository.js';
export * from './ActionHistoryRepository.js';

// Export shared types/interfaces directly (re-export from base)
export type { WorkItemData, WorkItemDependencyData } from './WorkItemRepositoryBase.js';

export type {
  ActionHistoryData,
  UndoStepData,
  CreateActionHistoryInput,
  CreateUndoStepInput,
} from './ActionHistoryRepositoryBase.js';
