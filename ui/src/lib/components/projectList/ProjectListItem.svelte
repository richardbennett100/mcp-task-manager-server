<script lang="ts">
  import type { ProjectListItem as ProjectListItemType } from '$types'; // Renamed to avoid conflict with component name

  export let project: ProjectListItemType;
  export let isSelected: boolean = false;
</script>

<li
  class="project-list-item fixed-width-font"
  class:selected={isSelected}
  on:click
  on:keydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); // Prevent space from scrolling page
      e.currentTarget.dispatchEvent(new CustomEvent('select'));
    }
  }}
  tabindex="0"
  aria-selected={isSelected}
  role="option"
  title={project.name}
>
  <span>{project.name}</span>
</li>

<style>
  .project-list-item {
    padding: 0.7rem 1rem;
    margin-bottom: 0.4rem;
    border-radius: 5px;
    cursor: pointer;
    transition:
      background-color 0.15s ease,
      border-color 0.15s ease,
      color 0.15s ease;
    border: 1px solid transparent;
    font-size: 0.9rem;
    line-height: 1.4;
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .project-list-item:hover,
  .project-list-item:focus {
    background-color: var(--color-accent, #b58900);
    color: #002b36;
    border-color: var(--color-primary);
    outline: 2px solid var(--color-primary); /* Clearer focus indicator */
    outline-offset: -1px; /* Adjust focus outline to be inset or outset nicely */
  }

  .project-list-item.selected {
    background-color: var(--color-primary, #268bd2);
    color: #fdf6e3;
    font-weight: 600;
    border-color: var(--color-primary);
  }
</style>
