<script lang="ts">
  import { onMount } from 'svelte';
  import { projectStore } from '$stores/projectStore';
  import { uiStateStore } from '$stores/uiStateStore';
  import ProjectListItem from '$components/projectList/ProjectListItem.svelte';
  import LoadingSpinner from '$components/common/LoadingSpinner.svelte';

  // Reactive statements for Svelte store values
  $: projects = $projectStore.projects;
  $: isLoading = $projectStore.isLoadingProjects;
  $: error = $projectStore.error;
  $: selectedProjectId = $projectStore.selectedProjectId;
  $: isCollapsed = $uiStateStore.isSidebarCollapsed;

  onMount(() => {
    // Load projects only if not already loaded or loading
    if (!$projectStore.projects.length && !$projectStore.isLoadingProjects) {
      projectStore.loadProjects();
    }
  });

  function handleProjectSelect(projectId: string) {
    projectStore.selectProject(projectId);
  }

  function toggleSidebar() {
    uiStateStore.toggleSidebar();
  }
</script>

<aside class="sidebar" class:collapsed={isCollapsed}>
  <button
    class="toggle-button fixed-width-font"
    on:click={toggleSidebar}
    title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
  >
    {isCollapsed ? '☰' : '❮'}
  </button>
  <div class="sidebar-content" class:hidden={isCollapsed}>
    <h2 class="fixed-width-font">Projects</h2>
    {#if isLoading}
      <LoadingSpinner message="Loading projects..." />
    {:else if error}
      <p class="error-message fixed-width-font">Error: {error}</p>
    {:else if projects.length === 0}
      <p class="fixed-width-font">No projects found.</p>
    {:else}
      <ul>
        {#each projects as project (project.work_item_id)}
          <ProjectListItem
            {project}
            isSelected={selectedProjectId === project.work_item_id}
            on:select={() => handleProjectSelect(project.work_item_id)}
          />
        {/each}
      </ul>
    {/if}
  </div>
</aside>

<style>
  .sidebar {
    background-color: var(--color-sidebar-bg, #f4f1de);
    padding: 1rem;
    width: 280px;
    transition:
      width 0.3s ease-in-out,
      padding 0.3s ease-in-out;
    height: 100%;
    overflow-y: auto;
    box-shadow: 1px 0 4px rgba(0, 0, 0, 0.07);
    position: relative;
    flex-shrink: 0;
    border-right: 1px solid var(--color-border);
  }

  .sidebar.collapsed {
    width: 60px;
    padding: 1rem 0.5rem;
  }

  .sidebar.collapsed .sidebar-content.hidden {
    /* More specific selector */
    display: none;
  }
  .sidebar.collapsed .toggle-button {
    /* Keep toggle button visible and centered */
    right: auto;
    left: 50%;
    transform: translateX(-50%);
    top: 10px;
  }
  .sidebar:not(.collapsed) .toggle-button {
    top: 12px;
    right: 12px;
  }

  .toggle-button {
    position: absolute;
    background: var(--color-accent);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    border-radius: 5px; /* Rounded rectangle */
    width: 32px;
    height: 32px;
    cursor: pointer;
    font-size: 1.1rem; /* Adjusted size */
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
    transition: background-color 0.2s;
  }
  .toggle-button:hover {
    background: var(--color-primary);
    color: white;
  }

  .sidebar-content h2 {
    margin-top: 0;
    padding-top: 35px; /* Ensure space if toggle button is at top right */
    margin-bottom: 1rem;
    font-size: 1.15rem;
    color: var(--color-text);
    font-weight: 600;
  }
  .sidebar.collapsed .sidebar-content h2 {
    display: none;
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .error-message {
    color: var(--color-highlight); /* Use highlight for errors */
    padding: 0.5rem;
    background-color: #ffebee; /* Light red background for error */
    border-radius: 4px;
  }
</style>
