// src/services/WorkItemServiceTypes.ts
import { WorkItemData, WorkItemDependencyData } from '../repositories/index.js';
import { z } from 'zod';

// Define and EXPORT Zod enums
export const WorkItemStatusEnum = z.enum(['todo', 'in-progress', 'review', 'done']);
export const WorkItemPriorityEnum = z.enum(['high', 'medium', 'low']);
export const DependencyTypeEnum = z.enum(['finish-to-start', 'linked']);
export const PositionEnum = z.enum(['start', 'end']);

// --- AddWorkItemInput ---
export interface AddWorkItemInput {
  parent_work_item_id?: string | null;
  name: string;
  description?: string | null;
  priority?: z.infer<typeof WorkItemPriorityEnum>;
  status?: z.infer<typeof WorkItemStatusEnum>;
  due_date?: string | null;
  dependencies?: {
    depends_on_work_item_id: string;
    dependency_type?: z.infer<typeof DependencyTypeEnum>;
  }[];
  insertAt?: z.infer<typeof PositionEnum>;
  insertAfter_work_item_id?: string;
  insertBefore_work_item_id?: string;
}

// --- UpdateWorkItemInput ---
export interface UpdateWorkItemInput {
  parent_work_item_id?: string | null;
  name?: string;
  description?: string | null;
  priority?: z.infer<typeof WorkItemPriorityEnum>;
  status?: z.infer<typeof WorkItemStatusEnum>;
  due_date?: string | null;
  moveTo?: z.infer<typeof PositionEnum>;
  moveAfter_work_item_id?: string;
  moveBefore_work_item_id?: string;
}

// --- Other types ---
export interface ListWorkItemsFilter {
  parent_work_item_id?: string | null;
  rootsOnly?: boolean;
  status?: z.infer<typeof WorkItemStatusEnum>;
  isActive?: boolean;
}

export interface FullWorkItemData extends WorkItemData {
  dependencies: WorkItemDependencyData[];
  dependents: WorkItemDependencyData[];
  children: WorkItemData[];
}

export interface WorkItemTreeNode extends WorkItemData {
  dependencies: WorkItemDependencyData[];
  dependents: WorkItemDependencyData[];
  children?: WorkItemTreeNode[];
}

export interface GetFullTreeOptions {
  include_inactive_items?: boolean;
  include_inactive_dependencies?: boolean;
  max_depth?: number;
}
