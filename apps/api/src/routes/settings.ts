import { Router } from 'express';
import { z } from 'zod';
import type { DatabaseClient } from '@lakecost/db';

const PrefsBodySchema = z.object({
  currency: z.string().min(3).max(8).optional(),
  defaultWorkspaceId: z.string().nullable().optional(),
  theme: z.enum(['system', 'light', 'dark']).optional(),
  prefs: z.record(z.string(), z.unknown()).optional(),
});

export function settingsRouter(db: DatabaseClient): Router {
  const router = Router();

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
