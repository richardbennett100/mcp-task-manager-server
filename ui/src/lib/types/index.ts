// ui/src/lib/types/index.ts

// From backend WorkItemServiceTypes.ts WorkItemTreeNode (or similar)
// Ensure this matches the structure provided by your backend's /api/projects/:projectId/tree
export interface UiWorkItemDependency {
  work_item_id: string;
  depends_on_work_item_id: string;
  dependency_type: string;
  is_active: boolean;
}

export interface UiWorkItemTreeNode {
  work_item_id: string;
  name: string;
  description: string | null;
  parent_work_item_id: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  order_key: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  tags: string[] | null;
  children: UiWorkItemTreeNode[];
  // Populated by frontend or backend for display, based on `dependencies`
  dependencies_info?: { depends_on_id: string; depends_on_name?: string; type: string }[];
  dependencies?: UiWorkItemDependency[] | null; // Raw dependencies from backend
}

// For the project list in the sidebar
export interface ProjectListItem {
  work_item_id: string;
  name: string;
  // Add other fields if needed by the UI, e.g., status, simple counts
  // status?: string;
  // children_count?: number;
}

// For SSE events
export type SseEventPayload = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface SseEventMessage {
  // Renamed to avoid conflict if SseEvent is used elsewhere
  type:
    | 'workItemCreated'
    | 'workItemUpdated'
    | 'workItemDeleted'
    | 'projectListUpdated'
    | 'projectTreeUpdated'
    | 'connected'
    | 'error';
  payload: SseEventPayload;
}
