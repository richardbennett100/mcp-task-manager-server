// src/api/sseRoutes.ts
import { Router, Request, Response } from 'express';
// import sseNotificationService from '../services/SseNotificationService.js';
import { logger } from '../utils/index.js'; // Added .js

export const sseRoutes = (): Router => {
  const router = Router();

  router.get('/events', (req: Request, res: Response) => {
    logger.info('[SSE] Client attempting to connect to /api/events');

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    //const clientId = sseNotificationService.addClient(res);

    // req.on('close', () => {
    //   logger.info(`[SSE] Client connection closed for /api/events (ID: ${clientId})`);
    //   sseNotificationService.removeClient(clientId);
    // });
  });

  return router;
};
