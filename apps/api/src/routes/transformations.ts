import { Router } from 'express';
import type { DatabaseClient } from '@finlake/db';
import { TransformationResourceRunBodySchema, type Env } from '@finlake/shared';
import {
  listTransformationPipelines,
  TransformationPipelineAuthError,
  TransformationPipelineRunError,
  runTransformationResource,
} from '../services/transformationPipelines.js';
import { DataSourceSetupError } from '../services/dataSourceErrors.js';
import { runSharedFocusJob } from '../services/dataSourceSetup.js';

export function transformationsRouter(db: DatabaseClient, env: Env): Router {
  const router = Router();

  router.get('/pipelines', async (req, res, next) => {
    try {
      res.json(await listTransformationPipelines(db, env, req.user?.accessToken));
    } catch (err) {
      if (err instanceof TransformationPipelineAuthError) {
        res.status(err.statusCode).json({ error: { message: err.message } });
        return;
      }
      next(err);
    }
  });

  router.post('/shared-run', async (_req, res, next) => {
    try {
      res.json(await runSharedFocusJob(env, db));
    } catch (err) {
      if (err instanceof DataSourceSetupError) {
        res.status(err.statusCode).json({ error: { message: err.message } });
        return;
      }
      next(err);
    }
  });

  router.post('/run', async (req, res, next) => {
    try {
      const parsed = TransformationResourceRunBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: { message: 'Invalid input', issues: parsed.error.issues } });
        return;
      }
      res.json(await runTransformationResource(db, env, parsed.data));
    } catch (err) {
      if (err instanceof TransformationPipelineRunError) {
        res.status(err.statusCode).json({ error: { message: err.message } });
        return;
      }
      next(err);
    }
  });

  return router;
}
