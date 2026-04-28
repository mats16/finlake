import { Router } from 'express';
import { z } from 'zod';
import type { DatabaseClient } from '@lakecost/db';
import {
  DATABRICKS_FOCUS_VERSION,
  DataSourceCreateBodySchema,
  DataSourceSetupBodySchema,
  DataSourceUpdateBodySchema,
  buildDataSourceId,
  type Env,
} from '@lakecost/shared';
import {
  runDataSourceJob,
  setupFocusDataSource,
  teardownFocusDataSource,
  DataSourceSetupError,
} from '../services/dataSourceSetup.js';

const IdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.\-]+$/, 'invalid id');

export function dataSourcesRouter(db: DatabaseClient, env: Env): Router {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try {
      const items = await db.repos.dataSources.list();
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const parsed = DataSourceCreateBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { message: 'Invalid input', issues: parsed.error.issues } });
        return;
      }
      const id = buildDataSourceId(parsed.data.providerName, parsed.data.billingAccountId);
      const created = await db.repos.dataSources.create({
        id,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        providerName: parsed.data.providerName,
        billingAccountId: parsed.data.billingAccountId ?? null,
        tableName: parsed.data.tableName,
        focusVersion: parsed.data.providerName === 'Databricks' ? DATABRICKS_FOCUS_VERSION : null,
        enabled: parsed.data.enabled ?? false,
        config: parsed.data.config ?? {},
      });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const idParse = IdSchema.safeParse(req.params.id);
      if (!idParse.success) {
        res.status(400).json({ error: { message: 'Invalid id' } });
        return;
      }
      const row = await db.repos.dataSources.get(idParse.data);
      if (!row) {
        res.status(404).json({ error: { message: 'Not found' } });
        return;
      }
      res.json(row);
    } catch (err) {
      next(err);
    }
  });

  router.put('/:id', async (req, res, next) => {
    try {
      const idParse = IdSchema.safeParse(req.params.id);
      if (!idParse.success) {
        res.status(400).json({ error: { message: 'Invalid id' } });
        return;
      }
      const parsed = DataSourceUpdateBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { message: 'Invalid input', issues: parsed.error.issues } });
        return;
      }
      const existing = await db.repos.dataSources.get(idParse.data);
      if (!existing) {
        res.status(404).json({ error: { message: 'Not found' } });
        return;
      }
      const updated = await db.repos.dataSources.update(idParse.data, parsed.data);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const idParse = IdSchema.safeParse(req.params.id);
      if (!idParse.success) {
        res.status(400).json({ error: { message: 'Invalid id' } });
        return;
      }
      const existing = await db.repos.dataSources.get(idParse.data);
      if (!existing) {
        res.status(404).json({ error: { message: 'Not found' } });
        return;
      }
      const { skippedTeardown } = await teardownFocusDataSource(
        env,
        req.user?.accessToken,
        existing,
      );
      await db.repos.dataSources.delete(idParse.data);
      if (skippedTeardown) {
        console.warn(
          `[dataSources] Deleted DB row ${idParse.data} but skipped Databricks resource teardown (missing OBO token or DATABRICKS_HOST). ` +
            `jobId=${existing.jobId}, pipelineId=${existing.pipelineId}`,
        );
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/setup', async (req, res, next) => {
    try {
      const idParse = IdSchema.safeParse(req.params.id);
      if (!idParse.success) {
        res.status(400).json({ error: { message: 'Invalid id' } });
        return;
      }
      const parsed = DataSourceSetupBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: { message: 'Invalid input', issues: parsed.error.issues } });
        return;
      }
      const result = await setupFocusDataSource(
        env,
        db,
        req.user?.accessToken,
        req.user?.email,
        idParse.data,
        parsed.data,
      );
      res.json(result);
    } catch (err) {
      if (err instanceof DataSourceSetupError) {
        res.status(err.status).json({ error: { message: err.message } });
        return;
      }
      next(err);
    }
  });

  router.post('/:id/run', async (req, res, next) => {
    try {
      const idParse = IdSchema.safeParse(req.params.id);
      if (!idParse.success) {
        res.status(400).json({ error: { message: 'Invalid id' } });
        return;
      }
      const result = await runDataSourceJob(env, db, req.user?.accessToken, idParse.data);
      res.json(result);
    } catch (err) {
      if (err instanceof DataSourceSetupError) {
        res.status(err.status).json({ error: { message: err.message } });
        return;
      }
      next(err);
    }
  });

  return router;
}
