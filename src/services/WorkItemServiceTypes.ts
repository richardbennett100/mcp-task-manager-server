// src/services/WorkItemServiceTypes.ts
// Corrected imports: Use index.js
import { WorkItemData, WorkItemDependencyData } from '../repositories/index.js';

export interface AddWorkItemInput {
  parent_work_item_id?: string | null;
  name: string;
  description?: string | null;
  priority?: 'high' | 'medium' | 'low';
  status?: 'todo' | 'in-progress' | 'review' | 'done';
  due_date?: string | null; // ISO string
  order_key?: string | null;
  shortname?: string | null;
  dependencies?: {
    depends_on_work_item_id: string;
    dependency_type?: 'finish-to-start' | 'linked';
  }[];
}

export interface UpdateWorkItemInput {
  parent_work_item_id?: string | null;
  name?: string;
  description?: string | null;
  priority?: 'high' | 'medium' | 'low';
  status?: 'todo' | 'in-progress' | 'review' | 'done';
  due_date?: string | null; // ISO string
  order_key?: string | null;
  shortname?: string | null;
  // is_active cannot be updated directly via this input
}

export interface ListWorkItemsFilter {
  parent_work_item_id?: string | null; // Specific parent or null/undefined for roots/all
  rootsOnly?: boolean; // Convenience flag for roots
  status?: WorkItemData['status'];
  isActive?: boolean; // Filter by active status (defaults to true)
}

// Represents the full data for a single work item, including relations
export interface FullWorkItemData extends WorkItemData {
  dependencies: WorkItemDependencyData[]; // Outgoing dependencies (item -> depends_on)
  dependents: WorkItemDependencyData[]; // Incoming dependencies (dependent -> item)
  children: WorkItemData[]; // Direct children
}
