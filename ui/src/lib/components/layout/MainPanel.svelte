<script lang="ts">
  import { projectStore } from '$stores/projectStore';
  import ProjectTreeView from '$components/projectTree/ProjectTreeView.svelte';
  import LoadingSpinner from '$components/common/LoadingSpinner.svelte';

  $: currentTree = $projectStore.currentProjectTree;
  $: isLoading = $projectStore.isLoadingTree;
  $: error = $projectStore.error;
  $: selectedProjectId = $projectStore.selectedProjectId;
</script>

<main class="main-panel">
  {#if isLoading && selectedProjectId}
    <LoadingSpinner message="Loading project details..." />
  {:else if error && selectedProjectId}
    <p class="error-message fixed-width-font">Error loading project: {error}</p>
  {:else if currentTree}
    <ProjectTreeView project={currentTree} />
  {:else if selectedProjectId}
    <p class="placeholder-text fixed-width-font">
      Project details are not available or the project is empty.
    </p>
  {:else}
    <p class="placeholder-text fixed-width-font">
      Select a project from the sidebar to view its details here.
    </p>
  {/if}
</main>

<style>
  .main-panel {
    flex-grow: 1;
    padding: 1.5rem 2rem; /* More padding */
    background-color: var(--color-background, #fdf6e3);
    height: 100%;
    overflow-y: auto;
  }
  .error-message {
    color: var(--color-highlight);
    padding: 1rem;
    background-color: #ffebee;
    border: 1px solid var(--color-highlight);
    border-radius: 4px;
  }
  .placeholder-text {
    color: #888; /* Softer placeholder text */
    font-size: 1.2rem; /* Slightly larger */
    text-align: center;
    margin-top: 4rem;
    font-style: italic;
  }
</style>
