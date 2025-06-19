// ui/src/lib/client/sse.ts
import { writable } from 'svelte/store';
import type { SseEventMessage } from '$types'; // Use renamed type

// Use relative path for proxying
const SSE_URL = '/api/events';

function createSseStore() {
  const { subscribe, set } = writable<SseEventMessage | null>(null);
  let eventSource: EventSource | null = null;

  function connect() {
    if (typeof window === 'undefined') return; // Don't run on server

    if (
      eventSource &&
      (eventSource.readyState === EventSource.OPEN ||
        eventSource.readyState === EventSource.CONNECTING)
    ) {
      console.info('SSE: Already connected or connecting.');
      return;
    }

    console.info('SSE: Connecting to', SSE_URL);
    eventSource = new EventSource(SSE_URL);

    eventSource.onopen = () => {
      console.info('SSE: Connection opened.');
      // Backend now sends a 'connected' event
    };

    eventSource.onerror = (error) => {
      console.error('SSE: Error:', error);
      // Don't set an error event here that might be misinterpreted by UI as data error
      // The UI should handle connection status separately if needed.
      // For POC, just log. Consider retry logic for production.
      // eventSource?.close(); // Optionally close on error to prevent flood of retries
    };

    // Specific event handlers based on `event: <type>` in SSE message
    const eventTypes: SseEventMessage['type'][] = [
      'connected',
      'projectListUpdated',
      'projectTreeUpdated',
      'workItemCreated', // Add if backend sends these granularly
      'workItemUpdated',
      'workItemDeleted',
    ];

    eventTypes.forEach((eventType) => {
      if (eventSource) {
        // Ensure eventSource is not null
        eventSource.addEventListener(eventType, (event: MessageEvent) => {
          try {
            const payload = JSON.parse(event.data);
            console.log(`SSE: Event "${eventType}" received:`, payload);
            set({ type: eventType, payload });
          } catch (e) {
            console.error(`SSE: Failed to parse data for event ${eventType}:`, event.data, e);
          }
        });
      }
    });
  }

  function disconnect() {
    if (eventSource) {
      eventSource.close();
      console.info('SSE: Connection closed by client.');
      eventSource = null;
    }
  }

  return {
    subscribe,
    connect,
    disconnect,
  };
}

export const sseStore = createSseStore();
