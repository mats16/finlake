import { Router } from 'express';
import type { Env } from '@finlake/shared';
import {
  CatalogServiceError,
  listAccessibleCatalogs,
  listAccessibleSchemas,
  listAccessibleTables,
} from '../services/catalogs.js';

export function catalogsRouter(env: Env): Router {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const catalogs = await listAccessibleCatalogs(env, req.user?.accessToken);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ catalogs });
    } catch (err) {
      if (err instanceof CatalogServiceError) {
        res.status(err.statusCode).json({ error: { message: err.message } });
        return;
      }
      next(err);
    }
  });

  router.get('/:catalogName/schemas', async (req, res, next) => {
    try {
      const catalogName = req.params.catalogName;
      if (!catalogName) {
        res.status(400).json({ error: { message: 'catalogName is required' } });
        return;
      }
      const schemas = await listAccessibleSchemas(env, req.user?.accessToken, catalogName);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ schemas });
    } catch (err) {
      if (err instanceof CatalogServiceError) {
        res.status(err.statusCode).json({ error: { message: err.message } });
        return;
      }
      next(err);
    }
  });

  router.get('/:catalogName/schemas/:schemaName/tables', async (req, res, next) => {
    try {
      const { catalogName, schemaName } = req.params;
      if (!catalogName || !schemaName) {
        res.status(400).json({ error: { message: 'catalogName and schemaName are required' } });
        return;
      }
      const tables = await listAccessibleTables(
        env,
        req.user?.accessToken,
        catalogName,
        schemaName,
      );
      res.setHeader('Cache-Control', 'no-store');
      res.json({ tables });
    } catch (err) {
      if (err instanceof CatalogServiceError) {
        res.status(err.statusCode).json({ error: { message: err.message } });
        return;
      }
      next(err);
    }
  });

  return router;
}
