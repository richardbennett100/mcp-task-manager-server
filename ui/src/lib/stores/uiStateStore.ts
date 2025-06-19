// ui/src/lib/stores/uiStateStore.ts
import { writable } from 'svelte/store';

interface UiState {
  isSidebarCollapsed: boolean;
}

function createUiStateStore() {
  const { subscribe, update, set } = writable<UiState>({
    isSidebarCollapsed: false, // Default to not collapsed
  });

  return {
    subscribe,
    toggleSidebar: () =>
      update((state) => ({ ...state, isSidebarCollapsed: !state.isSidebarCollapsed })),
    setSidebarCollapsed: (collapsed: boolean) => set({ isSidebarCollapsed: collapsed }),
  };
}

export const uiStateStore = createUiStateStore();
