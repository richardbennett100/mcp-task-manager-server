// ui/src/lib/utils/colorUtils.ts

/**
 * Returns a CSS class name for background based on the work item status.
 * These classes should be defined in a global CSS file (e.g., app.postcss)
 * e.g., .status-todo-bg, .status-in-progress-bg
 */
export function getStatusClass(status: string | null | undefined): string {
  if (!status) return 'status-unknown-bg';
  const normalizedStatus = status
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  switch (normalizedStatus) {
    case 'todo':
      return 'status-todo-bg';
    case 'in-progress':
    case 'inprogress':
      return 'status-in-progress-bg';
    case 'done':
      return 'status-done-bg';
    case 'blocked':
      return 'status-blocked-bg';
    default:
      // For any other status, generate a generic class.
      // This allows some flexibility but relies on CSS defining these.
      // For POC, we might only have specific styles for the main ones.
      return `status-${normalizedStatus}-bg`;
  }
}

// Utility for status indicator text classes (if different from background)
// e.g. .status-text-todo, .status-text-done
export function getStatusIndicatorClass(status: string | null | undefined): string {
  if (!status) return 'status-text-unknown';
  const normalizedStatus = status
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  switch (normalizedStatus) {
    case 'todo':
      return 'status-todo';
    case 'in-progress':
    case 'inprogress':
      return 'status-inprogress'; // Match CSS class
    case 'done':
      return 'status-done';
    case 'blocked':
      return 'status-blocked';
    default:
      return `status-${normalizedStatus}`;
  }
}

export function getPriorityClass(priority: string | null | undefined): string {
  if (!priority) return '';
  return `priority-${priority.toLowerCase().replace(/\s+/g, '-')}`;
}
