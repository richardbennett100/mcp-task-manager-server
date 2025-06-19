<script lang="ts">
  import type { UiWorkItemTreeNode } from '$types';
  import Expander from '$components/common/Expander.svelte';
  import { getStatusClass as getNodeStatusBgClass } from '$utils/colorUtils';

  export let node: UiWorkItemTreeNode;
  export let level: number = 0;

  const MAX_DESC_LENGTH = 120;

  function formatDate(dateString: string | null): string {
    if (!dateString) return 'N/A';
    try {
      return new Date(dateString).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch (e) {
      return dateString;
    }
  }

  // Helper to get the text class for status indicators
  function getStatusIndicatorClass(status: string): string {
    if (!status) return '';
    return `status-${status.toLowerCase().replace(/\\s+/g, '-')}`;
  }
</script>

<div class="work-item-node" style="--level: {level}; margin-left: calc(var(--level) * 25px);">
  <div class="node-content node-status-bg {getNodeStatusBgClass(node.status)}">
    <div class="node-header">
      <span class="node-name fixed-width-font">{node.name}</span>
      <span class="node-id fixed-width-font"> (ID: {node.work_item_id.substring(0, 8)})</span>
    </div>
    <div class="node-details fixed-width-font">
      <p>
        <strong>Status:</strong>
        <span class="status-indicator {getStatusIndicatorClass(node.status)}"
          >{node.status || 'N/A'}</span
        >
      </p>
      <p><strong>Priority:</strong> {node.priority || 'N/A'}</p>
      {#if node.description}
        <p class="description-field">
          <strong>Desc:</strong>
          <Expander text={node.description} maxLength={MAX_DESC_LENGTH} />
        </p>
      {/if}
      <p><strong>Due:</strong> {formatDate(node.due_date)}</p>
      {#if node.tags && node.tags.length > 0}
        <p><strong>Tags:</strong> <span class="tags">{node.tags.join(', ')}</span></p>
      {/if}
      <p class="timestamps">
        <span>Created: {formatDate(node.created_at)}</span>
        <span>Updated: {formatDate(node.updated_at)}</span>
      </p>

      {#if node.dependencies_info && node.dependencies_info.length > 0}
        <div class="dependencies">
          <strong>Depends on:</strong>
          <ul>
            {#each node.dependencies_info as depInfo (depInfo.depends_on_id)}
              <li>
                {depInfo.depends_on_name || 'Task'} (ID: {depInfo.depends_on_id.substring(0, 8)})
                {#if depInfo.type}
                  <span class="dep-type">[{depInfo.type}]</span>{/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  </div>

  {#if node.children && node.children.length > 0}
    <div class="node-children">
      {#each node.children as childNode (childNode.work_item_id)}
        <svelte:self node={childNode} level={level + 1} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .work-item-node {
    padding: 0.6rem 0.8rem; /* Adjusted padding */
    margin-bottom: 0.6rem;
    border-radius: 6px; /* More rounded */
    background-color: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
    /* border-left will be handled by node-status-bg */
  }

  .node-content {
    padding: 0.8rem 1rem; /* Inner padding */
    border-radius: 4px; /* Inner radius for the background color */
  }

  .node-header {
    display: flex;
    /* justify-content: space-between; */
    align-items: baseline; /* Align baselines of name and ID */
    margin-bottom: 0.6rem;
    flex-wrap: wrap; /* Allow wrapping if name is too long */
  }
  .node-name {
    font-weight: 600;
    font-size: 1.05em; /* Slightly adjusted */
    color: var(--color-text);
    margin-right: 0.5em;
  }
  .node-id {
    font-size: 0.75em; /* Smaller ID */
    color: #899ca1; /* Softer ID color */
    font-family: var(--font-mono);
  }
  .node-details p {
    margin: 0.3rem 0;
    font-size: 0.85em;
    color: var(--color-text);
    line-height: 1.5;
  }
  .node-details p strong {
    color: var(--color-primary);
    font-weight: 500;
  }
  .description-field {
    white-space: pre-wrap; /* Respect newlines in description */
  }
  .tags {
    background-color: var(--color-sidebar-bg);
    padding: 0.1em 0.4em;
    border-radius: 3px;
    font-size: 0.9em;
  }
  .timestamps {
    font-size: 0.7em; /* Smaller timestamps */
    color: #9db2b9;
    display: flex;
    justify-content: space-between;
    margin-top: 0.5em;
    flex-wrap: wrap;
  }
  .timestamps span + span {
    margin-left: 1em;
  }

  .dependencies {
    margin-top: 0.6em;
    font-size: 0.8em;
  }
  .dependencies ul {
    list-style-type: none; /* No bullets for deps */
    padding-left: 0.5em;
    margin: 0.25em 0;
  }
  .dependencies li {
    color: #5a7279;
    padding: 0.1em 0;
  }
  .dep-type {
    font-style: italic;
    color: #78909c;
    font-size: 0.9em;
  }

  .node-children {
    /* padding-left: 25px; /* Handled by margin-left on child .work-item-node */
    /* border-left: 2px solid var(--color-accent); */ /* Visual cue for hierarchy if margin isn't enough */
    margin-top: 0.6rem;
  }

  .status-indicator {
    padding: 0.2em 0.5em;
    border-radius: 10px; /* Pill shape */
    font-size: 0.8em; /* Smaller status */
    font-weight: 500;
    text-transform: capitalize;
  }
</style>
