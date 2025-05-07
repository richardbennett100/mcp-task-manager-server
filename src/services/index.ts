// src/services/index.ts
export * from './WorkItemService.js';
export * from './WorkItemServiceTypes.js';
export * from './WorkItemAddingService.js';
export * from './WorkItemReadingService.js';
export * from './WorkItemUpdateService.js'; // Still export for deprecated method if direct use happens
export * from './WorkItemFieldUpdateService.js';
export * from './WorkItemDependencyUpdateService.js';
export * from './WorkItemPositionUpdateService.js';
export * from './WorkItemDeleteService.js';
export * from './WorkItemHistoryService.js';
export * from './WorkItemUtilsService.js';
export * from './WorkItemPromoteService.js'; // New export
