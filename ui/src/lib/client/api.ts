// ui/src/lib/client/api.ts
import type { UiWorkItemTreeNode, ProjectListItem } from '$types';

// In a real app, this would come from an environment variable or config
// For dev, Vite proxy handles this if UI runs on different port.
// For prod, Nginx will proxy /api to the backend.
const API_BASE_URL = '/api'; // Use relative path for proxying

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorData;
    try {
      errorData = await response.json();
    } catch (e) {
      errorData = { error: { message: response.statusText } };
    }
    // Try to extract message from backend's McpError structure or generic error
    const message =
      errorData?.error?.message || errorData?.message || `HTTP error! status: ${response.status}`;
    console.error('API Error Response:', errorData);
    throw new Error(message);
  }
  // Handle cases where response might be empty (e.g., 204 No Content)
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return response.json() as Promise<T>;
  }
  return undefined as T; // Or handle non-JSON responses appropriately
}

// Backend returns WorkItemData[] for projects, which should be compatible with ProjectListItem
export async function fetchProjects(): Promise<ProjectListItem[]> {
  const response = await fetch(`${API_BASE_URL}/projects`);
  return handleResponse<ProjectListItem[]>(response);
}

export async function fetchProjectTree(projectId: string): Promise<UiWorkItemTreeNode | null> {
  const response = await fetch(`${API_BASE_URL}/projects/${projectId}/tree`);
  // A 404 from backend for tree might return a non-JSON error page if not handled by McpError handler.
  // Or it might return JSON with an error. handleResponse should try to parse JSON.
  // If the project exists but has no displayable tree (e.g. it's "done" and filtered), backend might return null.
  if (response.status === 404) {
    // Check if it's a structured error or just plain 404
    try {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || `Project tree for ${projectId} not found.`);
    } catch (e) {
      // If not JSON, throw generic
      // console.warn(`Project tree for ${projectId} not found (404), returning null for UI.`);
      return null; // Or throw new Error(`Project tree for ${projectId} not found.`);
    }
  }
  return handleResponse<UiWorkItemTreeNode | null>(response);
}
