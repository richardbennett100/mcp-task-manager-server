<script lang="ts">
  import TopBar from './TopBar.svelte';
  import Sidebar from './Sidebar.svelte';
  import MainPanel from './MainPanel.svelte';
  import { uiStateStore } from '$stores/uiStateStore';
  import { onDestroy, onMount } from 'svelte';
  import { sseStore } from '$client/sse';
  import { browser } from '$app/environment'; // To ensure SSE connection only happens client-side

  let isSidebarCollapsed: boolean;
  const unsubscribeUiState = uiStateStore.subscribe((value) => {
    isSidebarCollapsed = value.isSidebarCollapsed;
  });

  onMount(() => {
    if (browser) {
      // Only connect to SSE on the client
      sseStore.connect();
    }
  });

  onDestroy(() => {
    unsubscribeUiState();
    if (browser) {
      // Only disconnect on the client
      sseStore.disconnect();
    }
  });
</script>

<div class="app-layout">
  <TopBar />
  <div class="content-area" class:sidebar-collapsed={isSidebarCollapsed}>
    <Sidebar />
    <MainPanel />
  </div>
</div>

<style>
  .app-layout {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
  }

  .content-area {
    display: flex;
    flex-grow: 1;
    overflow: hidden;
    /* transition: grid-template-columns 0.3s ease-in-out; No grid here, direct flex */
  }
  /* .sidebar-collapsed class on content-area might not be needed if Sidebar handles its own width */
</style>
