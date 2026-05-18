import { Router } from 'express';
import type { DatabaseClient } from '@finlake/db';
import { WorkspaceIdSchema, WorkspaceMappingUpsertBodySchema } from '@finlake/shared';

export function workspacesRouter(db: DatabaseClient): Router {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try {
      const workspaces = await db.repos.workspaces.list();
      res.json({ workspaces });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const parsedId = WorkspaceIdSchema.safeParse(req.params.id);
      if (!parsedId.success) {
        res.status(400).json({ error: { message: 'Invalid workspace id' } });
        return;
      }
      const row = await db.repos.workspaces.get(parsedId.data);
      if (!row) {
        res.status(404).json({ error: { message: 'Workspace mapping not found' } });
        return;
      }
      res.json(row);
    } catch (err) {
      next(err);
    }
  });

  router.put('/:id', async (req, res, next) => {
    try {
      const parsedId = WorkspaceIdSchema.safeParse(req.params.id);
      if (!parsedId.success) {
        res.status(400).json({ error: { message: 'Invalid workspace id' } });
        return;
      }
      const parsedBody = WorkspaceMappingUpsertBodySchema.safeParse(req.body ?? {});
      if (!parsedBody.success) {
        res
          .status(400)
          .json({ error: { message: 'Invalid input', issues: parsedBody.error.issues } });
        return;
      }
      const row = await db.repos.workspaces.upsert(parsedId.data, parsedBody.data.domain);
      res.json(row);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const parsedId = WorkspaceIdSchema.safeParse(req.params.id);
      if (!parsedId.success) {
        res.status(400).json({ error: { message: 'Invalid workspace id' } });
        return;
      }
      await db.repos.workspaces.delete(parsedId.data);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
