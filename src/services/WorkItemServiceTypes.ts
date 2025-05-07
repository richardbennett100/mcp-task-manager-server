// src/services/WorkItemServiceTypes.ts
import { WorkItemData, WorkItemDependencyData } from '../repositories/index.js';
import { z } from 'zod';

// Define enums consistently
const WorkItemStatusEnum = z.enum(['todo', 'in-progress', 'review', 'done']);
const WorkItemPriorityEnum = z.enum(['high', 'medium', 'low']);
const DependencyTypeEnum = z.enum(['finish-to-start', 'linked']);
const PositionEnum = z.enum(['start', 'end']); // Used for insertAt/moveTo

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
  // Positioning Parameters
  insertAt?: z.infer<typeof PositionEnum>;
  insertAfter_work_item_id?: string;
  insertBefore_work_item_id?: string;
}

// --- UpdateWorkItemInput - Add move parameters ---
export interface UpdateWorkItemInput {
  // Fields that can be updated
  parent_work_item_id?: string | null; // Changing parent implies reordering
  name?: string;
  description?: string | null;
  priority?: z.infer<typeof WorkItemPriorityEnum>;
  status?: z.infer<typeof WorkItemStatusEnum>;
  due_date?: string | null;

  // Positioning Parameters (Mutually exclusive with each other)
  moveTo?: z.infer<typeof PositionEnum>;
  moveAfter_work_item_id?: string;
  moveBefore_work_item_id?: string;

  // order_key and shortname are handled internally by the service now
}

// --- Other types ---
export interface ListWorkItemsFilter {
  parent_work_item_id?: string | null;
  rootsOnly?: boolean;
  status?: WorkItemData['status'];
  isActive?: boolean; // Can be true, false, or undefined (to fetch both)
}

export interface FullWorkItemData extends WorkItemData {
  dependencies: WorkItemDependencyData[];
  dependents: WorkItemDependencyData[];
  children: WorkItemData[]; // Direct children only
}

// --- NEW Recursive Tree Node Type ---
export interface WorkItemTreeNode extends WorkItemData {
  dependencies: WorkItemDependencyData[];
  dependents: WorkItemDependencyData[];
  children?: WorkItemTreeNode[]; // Recursive definition for children
}

// --- GetFullTree Options Type (matches params but used internally) ---
export interface GetFullTreeOptions {
  include_inactive_items?: boolean;
  include_inactive_dependencies?: boolean;
  max_depth?: number;
}
