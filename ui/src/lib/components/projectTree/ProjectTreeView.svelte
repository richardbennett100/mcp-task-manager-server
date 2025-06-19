<script lang="ts">
  import type { UiWorkItemTreeNode } from '$types';
  import WorkItemNode from './WorkItemNode.svelte';

  export let project: UiWorkItemTreeNode | null; // Allow null if project might not be found
</script>

<div class="project-tree-view">
  {#if project}
    <WorkItemNode node={project} level={0} />
  {:else}
    <p class="fixed-width-font no-project-data">
      No project data to display, or project not found.
    </p>
  {/if}
</div>

<style>
  .project-tree-view {
    font-family: var(--font-mono);
  }
  .no-project-data {
    color: #777;
    font-style: italic;
    padding: 1rem;
  }
</style>
