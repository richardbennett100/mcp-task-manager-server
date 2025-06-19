// src/services/SseNotificationService.ts
import { Response } from 'express';
import { WorkItemData } from '../repositories/index.js'; // Added .js
import { logger } from '../utils/index.js'; // Added .js

interface Client {
  id: string;
  res: Response;
}

export type SseEventType =
  | 'workItemCreated'
  | 'workItemUpdated'
  | 'workItemDeleted'
  | 'projectListUpdated'
  | 'projectTreeUpdated';

export interface SseEvent {
  type: SseEventType;
  payload: any;
}

class SseNotificationService {
  public clients: Client[] = [];

  constructor() {
    logger.info('[SseNotificationService] Initialized');
  }

  addClient(res: Response): string {
    const clientId = Date.now().toString();
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const newClient = { id: clientId, res };
    this.clients.push(newClient);
    logger.info(`[SseNotificationService] Client connected: ${clientId}, Total clients: ${this.clients.length}`);

    res.write(`event: connected\ndata: ${JSON.stringify({ clientId })}\n\n`);

    res.on('close', () => {
      this.removeClient(clientId);
    });

    return clientId;
  }

  removeClient(clientId: string): void {
    this.clients = this.clients.filter((client) => client.id !== clientId);
    logger.info(`[SseNotificationService] Client disconnected: ${clientId}, Total clients: ${this.clients.length}`);
  }

  public broadcast(event: SseEvent): void {
    if (this.clients.length === 0) {
      return;
    }
    const message = `event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`;
    logger.info(`[SseNotificationService] Broadcasting event: ${event.type} to ${this.clients.length} client(s)`);
    this.clients.forEach((client) => client.res.write(message));
  }

  notifyWorkItemCreated(workItem: WorkItemData, parentWorkItemId: string | null): void {
    if (parentWorkItemId) {
      this.broadcast({
        type: 'projectTreeUpdated',
        payload: { projectId: parentWorkItemId, reason: 'child_created', newItemId: workItem.work_item_id },
      });
    } else {
      this.broadcast({
        type: 'projectListUpdated',
        payload: { reason: 'project_created', newItemId: workItem.work_item_id },
      });
    }
  }

  notifyWorkItemUpdated(workItem: WorkItemData, parentWorkItemId: string | null): void {
    if (parentWorkItemId) {
      this.broadcast({
        type: 'projectTreeUpdated',
        payload: { projectId: parentWorkItemId, reason: 'item_updated', updatedItemId: workItem.work_item_id },
      });
      if (this.isProject(workItem)) {
        this.broadcast({
          type: 'projectTreeUpdated',
          payload: { projectId: workItem.work_item_id, reason: 'item_updated', updatedItemId: workItem.work_item_id },
        });
      }
    } else {
      this.broadcast({
        type: 'projectListUpdated',
        payload: { reason: 'project_updated', updatedItemId: workItem.work_item_id },
      });
      this.broadcast({
        type: 'projectTreeUpdated',
        payload: { projectId: workItem.work_item_id, reason: 'item_updated', updatedItemId: workItem.work_item_id },
      });
    }
  }

  notifyWorkItemDeleted(workItemId: string, parentWorkItemId: string | null, isProject: boolean): void {
    if (parentWorkItemId) {
      this.broadcast({
        type: 'projectTreeUpdated',
        payload: { projectId: parentWorkItemId, reason: 'item_deleted', deletedItemId: workItemId },
      });
    } else if (isProject) {
      this.broadcast({ type: 'projectListUpdated', payload: { reason: 'project_deleted', deletedItemId: workItemId } });
    }
    this.broadcast({
      type: 'projectTreeUpdated',
      payload: { projectId: workItemId, reason: 'project_deleted_itself', deletedItemId: workItemId },
    });
  }

  private isProject(item: WorkItemData): boolean {
    return !item.parent_work_item_id;
  }

  notifyDependencyChanged(workItemId: string, parentWorkItemId: string | null): void {
    logger.info(`[SseNotificationService] Dependency changed for: ${workItemId}`);
    if (parentWorkItemId) {
      this.broadcast({
        type: 'projectTreeUpdated',
        payload: { projectId: parentWorkItemId, reason: 'dependency_changed', itemId: workItemId },
      });
    }
    this.broadcast({
      type: 'projectTreeUpdated',
      payload: { projectId: workItemId, reason: 'dependency_changed', itemId: workItemId },
    });
  }
}

const sseNotificationService = new SseNotificationService();
export default sseNotificationService;
