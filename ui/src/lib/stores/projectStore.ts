// ui/src/lib/stores/projectStore.ts
import { writable, get } from 'svelte/store';
import type { ProjectListItem, UiWorkItemTreeNode, SseEventMessage } from '$types';
import { fetchProjects, fetchProjectTree } from '$client/api';
import { sseStore } from '$client/sse';

interface ProjectState {
  projects: ProjectListItem[];
  selectedProjectId: string | null;
  currentProjectTree: UiWorkItemTreeNode | null;
  isLoadingProjects: boolean;
  isLoadingTree: boolean;
  error: string | null;
}

function createProjectStore() {
  // Removed 'set' as it's not used
  const { subscribe, update } = writable<ProjectState>({
    projects: [],
    selectedProjectId: null,
    currentProjectTree: null,
    isLoadingProjects: false,
    isLoadingTree: false,
    error: null,
  });

  async function loadProjects(selectIdAfterLoad?: string | null) {
    update((state) => ({ ...state, isLoadingProjects: true, error: null }));
    try {
      const projectsData = await fetchProjects();
      update((state) => ({ ...state, projects: projectsData, isLoadingProjects: false }));
      if (selectIdAfterLoad && projectsData.some((p) => p.work_item_id === selectIdAfterLoad)) {
        await selectProject(selectIdAfterLoad);
      } else if (selectIdAfterLoad) {
        update((s) => ({ ...s, selectedProjectId: null, currentProjectTree: null }));
      }
    } catch (err) {
      console.error('Error loading projects:', err);
      update((state) => ({ ...state, error: (err as Error).message, isLoadingProjects: false }));
    }
  }

  async function selectProject(projectId: string | null) {
    const currentSelectedId = get(subscribe).selectedProjectId;
    if (!projectId) {
      update((state) => ({
        ...state,
        selectedProjectId: null,
        currentProjectTree: null,
        error: null,
      }));
      return;
    }

    if (
      currentSelectedId === projectId &&
      get(subscribe).currentProjectTree &&
      !get(subscribe).isLoadingTree
    ) {
      return;
    }

    update((state) => ({
      ...state,
      selectedProjectId: projectId,
      isLoadingTree: true,
      error: null,
      currentProjectTree: null,
    }));
    try {
      const tree = await fetchProjectTree(projectId);
      update((state) => ({
        ...state,
        currentProjectTree: tree,
        isLoadingTree: false,
      }));
    } catch (err) {
      console.error(`Error loading project tree for ${projectId}:`, err);
      update((state) => ({
        ...state,
        error: (err as Error).message,
        isLoadingTree: false,
        currentProjectTree: null,
      }));
    }
  }

  sseStore.subscribe((event: SseEventMessage | null) => {
    if (!event) return;

    const currentState = get(subscribe);

    if (event.type === 'projectListUpdated') {
      console.log('SSE: projectListUpdated, reloading projects...', event.payload);
      loadProjects(currentState.selectedProjectId);
    }

    if (event.type === 'projectTreeUpdated') {
      const { projectId, reason /* other potential payload like itemId */ } = event.payload;
      if (currentState.selectedProjectId && projectId === currentState.selectedProjectId) {
        console.log(
          `SSE: projectTreeUpdated for current project ${projectId}, reason: ${reason}. Reloading tree...`,
          event.payload
        );
        selectProject(currentState.selectedProjectId);
      } else if (
        reason === 'project_deleted_itself' &&
        event.payload.deletedItemId === currentState.selectedProjectId
      ) {
        console.log('SSE: current project was deleted, clearing view and reloading project list');
        update((s) => ({ ...s, selectedProjectId: null, currentProjectTree: null }));
        loadProjects();
      }
    }
  });

  return {
    subscribe,
    loadProjects,
    selectProject,
  };
}

export const projectStore = createProjectStore();
