<script lang="ts">
  // The main content is rendered by AppLayout and its children (Sidebar, MainPanel).
  // No specific page logic needed here for this POC structure.
  // Removed unused import of 'browser' and the commented-out onMount.
</script>

<svelte:head>
  <title>Task Manager UI - POC</title>
  <meta name="description" content="Svelte POC for Task Management UI with Real-Time Updates" />
</svelte:head>

<div class="page-content-wrapper"></div>

<style>
  .page-content-wrapper {
    width: 100%;
    height: 100%;
  }
</style>
