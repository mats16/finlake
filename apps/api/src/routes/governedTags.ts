import { Router } from 'express';
import { GovernedTagSyncBodySchema, type Env } from '@finlake/shared';
import type { DatabaseClient } from '@finlake/db';
import {
  GovernedTagsServiceError,
  listGovernedTags,
  syncGovernedTags,
} from '../services/governedTags.js';

export function governedTagsRouter(db: DatabaseClient, env: Env): Router {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await listGovernedTags(env, db));
    } catch (err) {
      if (err instanceof GovernedTagsServiceError) {
        res.status(err.statusCode).json({ error: { message: err.message } });
        return;
      }
      next(err);
    }
  });

  router.post('/sync', async (req, res, next) => {
    try {
      const parsed = GovernedTagSyncBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: { message: 'Invalid input', issues: parsed.error.issues } });
        return;
      }
      res.json(await syncGovernedTags(env, db, parsed.data));
    } catch (err) {
      if (err instanceof GovernedTagsServiceError) {
        res.status(err.statusCode).json({ error: { message: err.message } });
        return;
      }
      next(err);
    }
  });

  return router;
}
