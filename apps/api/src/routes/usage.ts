import { Router } from 'express';
import { createHash } from 'node:crypto';
import type { DatabaseClient } from '@lakecost/db';
import type { Env, UsageRange } from '@lakecost/shared';
import { UsageRangeSchema } from '@lakecost/shared';
import { StatementExecutor } from '../services/statementExecution.js';
import { UsageQueries } from '../services/usageQueries.js';
import { AppServicePrincipalTokenProvider } from '../auth/appServicePrincipal.js';
import { logger } from '../config/logger.js';

const CACHE_TTL_SEC = 5 * 60;

export function usageRouter(db: DatabaseClient, env: Env): Router {
  const router = Router();

  const queries = buildQueries(env);

  router.get('/daily', async (req, res, next) => {
    try {
      const range = parseRange(req.query);
      const data = await cached(db, 'usage:daily', range, () =>
        queries ? queries.daily(range) : Promise.resolve([]),
      );
      res.json({
        rows: data,
        totalUsd: data.reduce((sum, r) => sum + r.costUsd, 0),
        cachedAt: null,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/by-sku', async (req, res, next) => {
    try {
      const range = parseRange(req.query);
      const data = await cached(db, 'usage:bySku', range, () =>
        queries ? queries.bySku(range) : Promise.resolve([]),
      );
      res.json({ rows: data });
    } catch (err) {
      next(err);
    }
  });

  router.get('/top-workloads', async (req, res, next) => {
    try {
      const range = parseRange(req.query);
      const data = await cached(db, 'usage:topWorkloads', range, () =>
        queries ? queries.topWorkloads(range) : Promise.resolve([]),
      );
      res.json({ rows: data });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function buildQueries(env: Env): UsageQueries | undefined {
  if (!env.DATABRICKS_HOST || !env.SQL_WAREHOUSE_ID) {
    logger.warn('DATABRICKS_HOST or SQL_WAREHOUSE_ID not set; /api/usage will return empty rows');
    return undefined;
  }
  const tokenProvider = new AppServicePrincipalTokenProvider(env);
  const executor = new StatementExecutor({
    host: env.DATABRICKS_HOST,
    warehouseId: env.SQL_WAREHOUSE_ID,
    tokenProvider: () => tokenProvider.getToken(),
  });
  return new UsageQueries(executor);
}

function parseRange(query: unknown): UsageRange {
  const parsed = UsageRangeSchema.safeParse(query);
  if (!parsed.success) {
    const now = new Date();
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { start: start.toISOString(), end: now.toISOString() };
  }
  return parsed.data;
}

async function cached<T>(
  db: DatabaseClient,
  prefix: string,
  range: UsageRange,
  compute: () => Promise<T>,
): Promise<T> {
  const key = `${prefix}:${hashKey(range)}`;
  const hit = await db.repos.cachedAggregations.get(key);
  if (hit) return hit.payload as T;

  const data = await compute();
  const now = new Date();
  await db.repos.cachedAggregations.set({
    cacheKey: key,
    queryHash: hashKey(range),
    payload: data,
    computedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CACHE_TTL_SEC * 1000).toISOString(),
  });
  return data;
}

function hashKey(range: UsageRange): string {
  return createHash('sha256').update(JSON.stringify(range)).digest('hex').slice(0, 16);
}
