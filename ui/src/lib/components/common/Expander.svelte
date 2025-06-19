<script lang="ts">
  export let text: string | null | undefined = '';
  export let maxLength: number = 100;

  let isExpanded = false;
  let needsExpansion: boolean;
  let currentText: string;

  $: {
    const safeText = text || '';
    needsExpansion = safeText.length > maxLength;
    currentText =
      isExpanded || !needsExpansion ? safeText : safeText.substring(0, maxLength) + '...';
  }

  function toggleExpansion(event: MouseEvent) {
    event.stopPropagation();
    isExpanded = !isExpanded;
  }
</script>

<div class="text-expander">
  <span class="expandable-text">{@html currentText.replace(/\\n/g, '<br>')}</span>
  {#if needsExpansion}
    <button
      on:click={toggleExpansion}
      class="expander-button fixed-width-font"
      aria-expanded={isExpanded}
    >
      {isExpanded ? 'Show Less' : 'Show More'}
    </button>
  {/if}
</div>

<style>
  .text-expander {
    display: inline;
    line-height: 1.5;
  }
  .expandable-text {
    /* Styles for the text itself if needed */
    white-space: pre-wrap; /* Respect newlines from description */
  }
  .expander-button {
    background: none;
    border: none;
    color: var(--color-primary);
    cursor: pointer;
    padding: 0 0 0 0.3em; /* Space before button */
    margin-left: 0.2em; /* Small margin */
    font-size: 0.8em; /* Smaller button text */
    text-decoration: underline;
    display: inline; /* Keep it inline with text */
    vertical-align: baseline;
  }
  .expander-button:hover {
    color: var(--color-highlight);
  }
</style>
