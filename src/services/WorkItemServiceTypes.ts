// src/services/WorkItemServiceTypes.ts
import { WorkItemData, WorkItemDependencyData } from '../repositories/WorkItemRepository.js';

export interface AddWorkItemInput {
  parent_work_item_id?: string | null;
  name: string;
  description?: string | null;
  priority?: 'high' | 'medium' | 'low';
  status?: 'todo' | 'in-progress' | 'review' | 'done';
  due_date?: string | null;
  order_key?: string | null;
  shortname?: string | null;
  dependencies?: { depends_on_work_item_id: string; dependency_type?: 'finish-to-start' | 'linked' }[];
  userId?: string;
}

export interface UpdateWorkItemInput {
  parent_work_item_id?: string | null;
  name?: string;
  description?: string | null;
  priority?: 'high' | 'medium' | 'low';
  status?: 'todo' | 'in-progress' | 'review' | 'done';
  due_date?: string | null;
  order_key?: string | null;
  shortname?: string | null;
  userId?: string;
}

export interface ListWorkItemsFilter {
  parent_work_item_id?: string | null;
  rootsOnly?: boolean;
  status?: WorkItemData['status'];
  isActive?: boolean;
}

export interface FullWorkItemData extends WorkItemData {
  dependencies: WorkItemDependencyData[];
  dependents: WorkItemDependencyData[];
  children: WorkItemData[];
}