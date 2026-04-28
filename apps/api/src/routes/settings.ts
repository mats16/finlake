import { Router } from 'express';
import { z } from 'zod';
import type { DatabaseClient } from '@lakecost/db';
import { CATALOG_SETTING_KEY, type Env, type ProvisionResult } from '@lakecost/shared';
import { CatalogServiceError, provisionCatalog } from '../services/catalogs.js';
import { logger } from '../config/logger.js';

const PrefsBodySchema = z.object({
  currency: z.string().min(3).max(8).optional(),
  defaultWorkspaceId: z.string().nullable().optional(),
  theme: z.enum(['system', 'light', 'dark']).optional(),
  prefs: z.record(z.string(), z.unknown()).optional(),
});

const AppSettingKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.\-]+$/, 'invalid key');

const AppSettingValueSchema = z.string().max(4096);

const AppSettingsBulkBodySchema = z.object({
  settings: z.record(AppSettingKeySchema, AppSettingValueSchema),
  provision: z
    .object({
      createIfMissing: z.boolean().optional(),
    })
    .optional(),
});

const AppSettingSingleBodySchema = z.object({
  value: AppSettingValueSchema,
});

export function settingsRouter(db: DatabaseClient, env: Env): Router {
  const router = Router();

  router.get('/app', async (_req, res, next) => {
    try {
      const rows = await db.repos.appSettings.list();
      const settings: Record<string, string> = {};
      for (const row of rows) settings[row.key] = row.value;
      res.json({ settings });
    } catch (err) {
      next(err);
    }
  });

  router.put('/app', async (req, res, next) => {
    try {
      const parsed = AppSettingsBulkBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { message: 'Invalid input', issues: parsed.error.issues } });
        return;
      }

      const previous = await db.repos.appSettings.list();
      const previousByKey = new Map(previous.map((r) => [r.key, r.value]));
      for (const [key, value] of Object.entries(parsed.data.settings)) {
        await db.repos.appSettings.upsert(key, value);
      }
      const rows = await db.repos.appSettings.list();
      const settings: Record<string, string> = {};
      for (const row of rows) settings[row.key] = row.value;

      let provision: ProvisionResult | undefined;
      const newCatalog = parsed.data.settings[CATALOG_SETTING_KEY]?.trim();
      const catalogChanged =
        newCatalog !== undefined &&
        newCatalog.length > 0 &&
        newCatalog !== (previousByKey.get(CATALOG_SETTING_KEY)?.trim() ?? '');
      if (catalogChanged) {
        try {
          provision = await provisionCatalog(env, req.user?.accessToken, newCatalog, {
            createIfMissing: parsed.data.provision?.createIfMissing,
          });
        } catch (err) {
          if (err instanceof CatalogServiceError) {
            logger.warn(
              { err, catalog: newCatalog, status: err.status },
              'provisionCatalog failed; settings persisted without provisioning',
            );
            provision = {
              catalog: newCatalog,
              catalogCreated: false,
              schemasEnsured: { bronze: 'error', silver: 'error', gold: 'error' },
              grants: {
                catalog: `error:${err.message}`,
                bronze: `error:${err.message}`,
                silver: `error:${err.message}`,
                gold: `error:${err.message}`,
              },
              servicePrincipalId: env.DATABRICKS_CLIENT_ID?.trim() || null,
              warnings: [err.message],
            };
          } else {
            logger.error({ err, catalog: newCatalog }, 'provisionCatalog threw unexpectedly');
            throw err;
          }
        }
      }

      res.json(provision ? { settings, provision } : { settings });
    } catch (err) {
      next(err);
    }
  });

  router.get('/app/:key', async (req, res, next) => {
    try {
      const keyParse = AppSettingKeySchema.safeParse(req.params.key);
      if (!keyParse.success) {
        res.status(400).json({ error: { message: 'Invalid key' } });
        return;
      }
      const row = await db.repos.appSettings.get(keyParse.data);
      if (!row) {
        res.status(404).json({ error: { message: 'Not found' } });
        return;
      }
      res.json(row);
    } catch (err) {
      next(err);
    }
  });

  router.put('/app/:key', async (req, res, next) => {
    try {
      const keyParse = AppSettingKeySchema.safeParse(req.params.key);
      if (!keyParse.success) {
        res.status(400).json({ error: { message: 'Invalid key' } });
        return;
      }
      const parsed = AppSettingSingleBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { message: 'Invalid input', issues: parsed.error.issues } });
        return;
      }
      const row = await db.repos.appSettings.upsert(keyParse.data, parsed.data.value);
      res.json(row);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/app/:key', async (req, res, next) => {
    try {
      const keyParse = AppSettingKeySchema.safeParse(req.params.key);
      if (!keyParse.success) {
        res.status(400).json({ error: { message: 'Invalid key' } });
        return;
      }
      await db.repos.appSettings.delete(keyParse.data);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.get('/me', async (req, res, next) => {
    try {
      const userId = req.user?.email ?? 'anonymous';
      const value = (await db.repos.userPreferences.get(userId)) ?? {
        userId,
        currency: 'USD',
        defaultWorkspaceId: null,
        theme: 'system',
        prefs: {},
        updatedAt: new Date().toISOString(),
      };
      res.json(value);
    } catch (err) {
      next(err);
    }
  });

  router.put('/me', async (req, res, next) => {
    try {
      const userId = req.user?.email ?? 'anonymous';
      const parsed = PrefsBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { message: 'Invalid input', issues: parsed.error.issues } });
        return;
      }
      const existing = (await db.repos.userPreferences.get(userId)) ?? {
        userId,
        currency: 'USD',
        defaultWorkspaceId: null,
        theme: 'system',
        prefs: {},
        updatedAt: new Date().toISOString(),
      };
      const next = await db.repos.userPreferences.upsert({
        ...existing,
        ...parsed.data,
        prefs: parsed.data.prefs ?? existing.prefs,
        defaultWorkspaceId:
          parsed.data.defaultWorkspaceId === undefined
            ? existing.defaultWorkspaceId
            : parsed.data.defaultWorkspaceId,
        userId,
        updatedAt: new Date().toISOString(),
      });
      res.json(next);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
