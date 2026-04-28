import { Router } from 'express';
import { z } from 'zod';
import type { DatabaseClient } from '@lakecost/db';
import { DataSourceUpdateBodySchema } from '@lakecost/shared';

const IdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.\-]+$/, 'invalid id');

export function dataSourcesRouter(db: DatabaseClient): Router {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try {
      const items = await db.repos.dataSources.list();
      res.json({ items });
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
      const updated = await db.repos.dataSources.upsert({
        ...existing,
        ...parsed.data,
        config: parsed.data.config ?? existing.config,
        description:
          parsed.data.description === undefined ? existing.description : parsed.data.description,
        id: existing.id,
        updatedAt: new Date().toISOString(),
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
