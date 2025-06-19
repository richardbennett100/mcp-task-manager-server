<script lang="ts">
  // Placeholder for future functionality (e.g., user profile, search)
</script>

<header class="top-bar">
  <div class="logo fixed-width-font">Task Manager UI - POC</div>
</header>

<style>
  .top-bar {
    background-color: var(--color-topbar-bg, #e8e2ca); /* Updated pastel */
    color: var(--color-text, #3d405b);
    padding: 0.75rem 1.5rem; /* Increased padding */
    display: flex;
    align-items: center;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08); /* Softer shadow */
    height: 55px;
    flex-shrink: 0;
    z-index: 100; /* Ensure it's above other content */
  }
  .logo {
    font-weight: 600; /* Slightly bolder */
    font-size: 1.25rem;
  }
</style>
