<script lang="ts">
  export let message: string = 'Loading...';
  export let size: string = '30px'; // Allow configurable size
</script>

<div class="loading-spinner-container fixed-width-font" role="status" aria-live="polite">
  <div class="spinner" style="width: {size}; height: {size};"></div>
  <p>{message}</p>
</div>

<style>
  .loading-spinner-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    color: var(--color-text);
    text-align: center;
  }
  .spinner {
    border: 4px solid var(--color-background, #f3f3f3);
    border-top: 4px solid var(--color-primary, #268bd2); /* Use primary color */
    border-radius: 50%;
    /* width and height are set by prop */
    animation: spin 0.8s linear infinite; /* Slightly faster spin */
    margin-bottom: 1rem;
  }

  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }
</style>
