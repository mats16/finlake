import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { DatabaseClient } from '@lakecost/db';
import {
  DataSourceTableNameSchema,
  UsageRangeSchema,
  quoteIdent,
  type DataSource,
  type Env,
  type UsageRange,
} from '@lakecost/shared';
import {
  buildUserExecutor,
  type SqlParam,
  type StatementExecutor,
} from '../services/statementExecution.js';

const FocusDailyRowSchema = z.object({
  dataSourceId: z.number(),
  usageDate: z.string(),
  providerName: z.string(),
  costUsd: z.number(),
});

const FocusServiceRowSchema = z.object({
  dataSourceId: z.number(),
  providerName: z.string(),
  serviceName: z.string(),
  costUsd: z.number(),
});

const FocusSkuRowSchema = z.object({
  dataSourceId: z.number(),
  providerName: z.string(),
  skuName: z.string(),
  costUsd: z.number(),
});

const FocusCoverageRowSchema = z.object({
  dataSourceId: z.number(),
  providerName: z.string(),
  rowCount: z.number(),
  taggedRows: z.number(),
  tagCoveragePct: z.number(),
  lastChargeAt: z.string().nullable(),
});

type FocusDailyRow = z.infer<typeof FocusDailyRowSchema>;
type FocusServiceRow = z.infer<typeof FocusServiceRowSchema>;
type FocusSkuRow = z.infer<typeof FocusSkuRowSchema>;
type FocusCoverageRow = z.infer<typeof FocusCoverageRowSchema>;

export function overviewRouter(db: DatabaseClient, env: Env): Router {
  const router = Router();
  router.get('/focus', focusOverviewHandler(db, env));
  return router;
}

function focusOverviewHandler(db: DatabaseClient, env: Env): RequestHandler {
  return async (req, res, next) => {
    try {
      const token = req.user?.accessToken;
      if (!token) {
        res.status(401).json({ error: { message: 'Missing OBO access token' } });
        return;
      }
      const executor = buildUserExecutor(env, token);
      if (!executor) {
        res
          .status(500)
          .json({ error: { message: 'DATABRICKS_HOST or SQL_WAREHOUSE_ID not configured' } });
        return;
      }

      const range = parseRange(req.query);
      const sources = (await db.repos.dataSources.list()).filter((source) => source.enabled);
      const daily: FocusDailyRow[] = [];
      const services: FocusServiceRow[] = [];
      const skus: FocusSkuRow[] = [];
      const coverage: FocusCoverageRow[] = [];
      const errors: Array<{
        dataSourceId: number;
        name: string;
        tableName: string;
        message: string;
      }> = [];

      await Promise.all(
        sources.map(async (source) => {
          try {
            const [d, svc, sk, cov] = await Promise.all([
              queryDaily(executor, source, range),
              queryServices(executor, source, range),
              querySkus(executor, source, range),
              queryCoverage(executor, source, range),
            ]);
            daily.push(...d);
            services.push(...svc);
            skus.push(...sk);
            coverage.push(...cov);
          } catch (err) {
            errors.push({
              dataSourceId: source.id,
              name: source.name,
              tableName: source.tableName,
              message: (err as Error).message,
            });
          }
        }),
      );

      res.json({
        sources: sources.map(sourceSummary),
        daily,
        services,
        skus,
        coverage,
        errors,
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  };
}

function parseRange(query: unknown): UsageRange {
  const parsed = UsageRangeSchema.safeParse(query);
  if (parsed.success) return parsed.data;
  const now = new Date();
  const start = new Date(now.getFullYear() - 1, now.getMonth(), 1);
  return { start: start.toISOString(), end: now.toISOString() };
}

function quoteTableName(value: string): string {
  const parsed = DataSourceTableNameSchema.parse(value);
  return parsed
    .split('.')
    .map((part) => quoteIdent(part))
    .join('.');
}

function baseParams(source: DataSource, range: UsageRange): SqlParam[] {
  return [
    { name: 'data_source_id', value: source.id, type: 'INT' },
    { name: 'provider_name', value: source.providerName, type: 'STRING' },
    { name: 'start_ts', value: range.start, type: 'TIMESTAMP' },
    { name: 'end_ts', value: range.end, type: 'TIMESTAMP' },
  ];
}

async function queryDaily(
  executor: StatementExecutor,
  source: DataSource,
  range: UsageRange,
): Promise<FocusDailyRow[]> {
  const table = quoteTableName(source.tableName);
  return executor.run(
    /* sql */ `
SELECT
  :data_source_id AS data_source_id,
  date_format(CAST(ChargePeriodStart AS DATE), 'yyyy-MM-dd') AS usage_date,
  COALESCE(ProviderName, :provider_name) AS provider_name,
  CAST(SUM(COALESCE(EffectiveCost, 0)) AS DOUBLE) AS cost_usd
FROM ${table}
WHERE ChargePeriodStart >= :start_ts
  AND ChargePeriodStart <  :end_ts
GROUP BY 1, 2, 3
ORDER BY 2
`,
    baseParams(source, range),
    FocusDailyRowSchema,
  );
}

async function queryServices(
  executor: StatementExecutor,
  source: DataSource,
  range: UsageRange,
): Promise<FocusServiceRow[]> {
  const table = quoteTableName(source.tableName);
  return executor.run(
    /* sql */ `
SELECT
  :data_source_id AS data_source_id,
  COALESCE(ProviderName, :provider_name) AS provider_name,
  COALESCE(ServiceName, ServiceCategory, ChargeDescription, 'Unknown') AS service_name,
  CAST(SUM(COALESCE(EffectiveCost, 0)) AS DOUBLE) AS cost_usd
FROM ${table}
WHERE ChargePeriodStart >= :start_ts
  AND ChargePeriodStart <  :end_ts
GROUP BY 1, 2, 3
ORDER BY 4 DESC
LIMIT 20
`,
    baseParams(source, range),
    FocusServiceRowSchema,
  );
}

async function querySkus(
  executor: StatementExecutor,
  source: DataSource,
  range: UsageRange,
): Promise<FocusSkuRow[]> {
  const table = quoteTableName(source.tableName);
  return executor.run(
    /* sql */ `
SELECT
  :data_source_id AS data_source_id,
  COALESCE(ProviderName, :provider_name) AS provider_name,
  COALESCE(SkuId, SkuMeter, ChargeDescription, ServiceName, 'Unknown') AS sku_name,
  CAST(SUM(COALESCE(EffectiveCost, 0)) AS DOUBLE) AS cost_usd
FROM ${table}
WHERE ChargePeriodStart >= :start_ts
  AND ChargePeriodStart <  :end_ts
GROUP BY 1, 2, 3
ORDER BY 4 DESC
LIMIT 50
`,
    baseParams(source, range),
    FocusSkuRowSchema,
  );
}

async function queryCoverage(
  executor: StatementExecutor,
  source: DataSource,
  range: UsageRange,
): Promise<FocusCoverageRow[]> {
  const table = quoteTableName(source.tableName);
  return executor.run(
    /* sql */ `
SELECT
  :data_source_id AS data_source_id,
  COALESCE(ProviderName, :provider_name) AS provider_name,
  CAST(COUNT(*) AS DOUBLE) AS row_count,
  CAST(SUM(CASE WHEN Tags IS NOT NULL AND size(Tags) > 0 THEN 1 ELSE 0 END) AS DOUBLE) AS tagged_rows,
  CAST(
    CASE
      WHEN COUNT(*) = 0 THEN 0
      ELSE SUM(CASE WHEN Tags IS NOT NULL AND size(Tags) > 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*)
    END AS DOUBLE
  ) AS tag_coverage_pct,
  CAST(MAX(ChargePeriodEnd) AS STRING) AS last_charge_at
FROM ${table}
WHERE ChargePeriodStart >= :start_ts
  AND ChargePeriodStart <  :end_ts
GROUP BY 1, 2
`,
    baseParams(source, range),
    FocusCoverageRowSchema,
  );
}

function sourceSummary(source: DataSource) {
  return {
    id: source.id,
    templateId: source.templateId,
    name: source.name,
    providerName: source.providerName,
    tableName: source.tableName,
    focusVersion: source.focusVersion,
    updatedAt: source.updatedAt,
  };
}
