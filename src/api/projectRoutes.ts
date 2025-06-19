// Modified: src/api/projectRoutes.ts
import { Router, Request, Response, NextFunction } from 'express';
import { WorkItemService } from '../services/index.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../utils/index.js';
import { validate as uuidValidate } from 'uuid';

export const projectRoutes = (workItemService: WorkItemService): Router => {
  const router = Router();

  router.get('/projects', async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info('[API] GET /api/projects called');
      const projects = await workItemService.listWorkItems({ rootsOnly: true, isActive: true });
      res.json(projects);
    } catch (error) {
      logger.error('[API] Error in GET /api/projects:', error);
      if (error instanceof McpError) return next(error);
      next(new McpError(ErrorCode.InternalError, 'Failed to list projects'));
    }
  });

  router.get('/projects/:projectId/tree', async (req: Request, res: Response, next: NextFunction) => {
    const { projectId } = req.params;
    try {
      logger.info(`[API] GET /api/projects/${projectId}/tree called`);
      if (!projectId || !uuidValidate(projectId)) {
        throw new McpError(ErrorCode.InvalidParams, `Invalid Project ID format: ${projectId}`);
      }

      const projectTree = await workItemService.getFullTree(projectId, {
        //includeDependencies: true,
        //includeDoneStatus: true,
        //includeInactive: false,
      });

      if (!projectTree) {
        const projectExists = await workItemService.getWorkItemById(projectId);
        if (!projectExists) {
          throw new McpError(ErrorCode.MethodNotFound, `Project with ID ${projectId} not found.`);
        }
      }
      res.json(projectTree);
    } catch (error) {
      logger.error(`[API] Error in GET /api/projects/${projectId}/tree:`, error);
      if (error instanceof McpError) return next(error);
      if ((error as Error).message?.toLowerCase().includes('not found')) {
        next(new McpError(ErrorCode.MethodNotFound, (error as Error).message));
      } else {
        next(new McpError(ErrorCode.InternalError, `Failed to get project tree for ${projectId}`));
      }
    }
  });

  return router;
};
