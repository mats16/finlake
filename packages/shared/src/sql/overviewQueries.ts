import {
  CATALOG_SETTING_KEY,
  GOLD_USAGE_TABLES,
  MEDALLION_SCHEMA_DEFAULTS,
  medallionSchemaNamesFromSettings,
} from '../schemas/dataSource.js';
import type { SqlParam } from '../schemas/sql.js';
import type { UsageRange } from '../schemas/usage.js';
import { FOCUS_VIEW_TABLE_DEFAULT, quoteIdent } from './focusView.sql.js';

export interface FocusOverviewDailyRow {
  dataSourceId: string;
  usageDate: string;
  providerName: string;
  serviceCategory: string;
  serviceName: string;
  costUsd: number;
}

export interface FocusOverviewServiceRow {
  dataSourceId: string;
  providerName: string;
  serviceName: string;
  costUsd: number;
}

export interface FocusOverviewSkuRow {
  dataSourceId: string;
  providerName: string;
  skuName: string;
  costUsd: number;
}

export interface FocusOverviewCoverageRow {
  dataSourceId: string;
  providerName: string;
  subAccountId: string | null;
  subAccountName: string | null;
  rowCount: number;
  taggedRows: number;
  tagCoveragePct: number;
  lastChargeAt: string | null;
}

export interface AiValueDailyRow {
  usageDate: string;
  teamId: string;
  cloudCostUsd: number | null;
  aiCostUsd: number | null;
  headcount: number | null;
  ticketsResolved: number | null;
  avgResolutionMinutes: number | null;
  csat: number | null;
  activeCustomers: number | null;
  aiCostShare: number | null;
  aiCostPerEmployee: number | null;
  aiCostPerThousandTickets: number | null;
  ticketsPerEmployee: number | null;
}

export interface AiValueAvailabilityRow {
  requiredTableCount: number;
}

export interface SqlStatementInput {
  query: string;
  params: SqlParam[];
}

export function buildOverviewDailyStatement(
  settings: Record<string, string | undefined>,
  range: UsageRange,
): SqlStatementInput {
  const cte = rollupRowsSql(usageTableName('daily', settings).sql);
  return { query: buildDailySql(cte), params: rangeParams(range) };
}

export function buildOverviewServicesStatement(
  settings: Record<string, string | undefined>,
  range: UsageRange,
): SqlStatementInput {
  const cte = rollupRowsSql(usageTableName('daily', settings).sql);
  return {
    query: /* sql */ `
${cte}
SELECT
  data_source_id,
  source_provider_name AS provider_name,
  COALESCE(ServiceName, ServiceCategory, 'Unknown') AS service_name,
  CAST(SUM(COALESCE(EffectiveCost, 0)) AS DOUBLE) AS cost_usd
FROM matched
WHERE CAST(x_ChargeDate AS TIMESTAMP) >= :start_ts
  AND CAST(x_ChargeDate AS TIMESTAMP) <  :end_ts
GROUP BY 1, 2, 3
ORDER BY 4 DESC
LIMIT 20
`,
    params: rangeParams(range),
  };
}

export function buildOverviewSkusStatement(
  settings: Record<string, string | undefined>,
  range: UsageRange,
): SqlStatementInput {
  const cte = rollupRowsSql(usageTableName('daily', settings).sql);
  return {
    query: /* sql */ `
${cte}
SELECT
  data_source_id,
  source_provider_name AS provider_name,
  COALESCE(SkuId, SkuMeter, ServiceName, 'Unknown') AS sku_name,
  CAST(SUM(COALESCE(EffectiveCost, 0)) AS DOUBLE) AS cost_usd
FROM matched
WHERE CAST(x_ChargeDate AS TIMESTAMP) >= :start_ts
  AND CAST(x_ChargeDate AS TIMESTAMP) <  :end_ts
GROUP BY 1, 2, 3
ORDER BY 4 DESC
LIMIT 50
`,
    params: rangeParams(range),
  };
}

export function buildOverviewCoverageStatement(
  settings: Record<string, string | undefined>,
): SqlStatementInput {
  const cte = rollupRowsSql(usageTableName('monthly', settings).sql);
  return { query: buildCoverageSql(cte), params: [] };
}

export function buildAiValueStatement(
  settings: Record<string, string | undefined>,
  range: UsageRange,
): SqlStatementInput {
  const catalog = (settings[CATALOG_SETTING_KEY] ?? '').trim();
  const schemas = medallionSchemaNamesFromSettings(settings);
  const cloudTable = usageTableName('daily', settings).sql;
  const aiTable = qualifiedTable(catalog, schemas.silver, FOCUS_VIEW_TABLE_DEFAULT);
  const businessTable = qualifiedTable(catalog, schemas.gold, 'business_kpi_daily');

  return {
    query: /* sql */ `
WITH cloud_daily AS (
  SELECT
    CAST(x_ChargeDate AS DATE) AS usage_date,
    CAST(SUM(COALESCE(EffectiveCost, 0)) AS DOUBLE) AS cloud_cost_usd
  FROM ${cloudTable}
  WHERE CAST(x_ChargeDate AS TIMESTAMP) >= :start_ts
    AND CAST(x_ChargeDate AS TIMESTAMP) <  :end_ts
    AND BillingCurrency = 'USD'
  GROUP BY 1
),
ai_daily AS (
  SELECT
    CAST(ChargePeriodStart AS DATE) AS usage_date,
    CAST(SUM(COALESCE(EffectiveCost, 0)) AS DOUBLE) AS ai_cost_usd
  FROM ${aiTable}
  WHERE ResourceType = 'AI Gateway Model Service'
    AND ResourceName = 'finops.analytics.support_copilot'
    AND CAST(ChargePeriodStart AS TIMESTAMP) >= :start_ts
    AND CAST(ChargePeriodStart AS TIMESTAMP) <  :end_ts
    AND BillingCurrency = 'USD'
  GROUP BY 1
),
business_daily AS (
  SELECT
    CAST(date AS DATE) AS usage_date,
    team_id,
    CAST(MAX(headcount) AS DOUBLE) AS headcount,
    CAST(SUM(tickets_resolved) AS DOUBLE) AS tickets_resolved,
    CAST(AVG(avg_resolution_minutes) AS DOUBLE) AS avg_resolution_minutes,
    CAST(AVG(csat) AS DOUBLE) AS csat,
    CAST(MAX(active_customers) AS DOUBLE) AS active_customers
  FROM ${businessTable}
  WHERE team_id = 'support'
    AND is_demo = true
    AND CAST(date AS TIMESTAMP) >= :start_ts
    AND CAST(date AS TIMESTAMP) <  :end_ts
  GROUP BY 1, 2
),
date_spine AS (
  SELECT usage_date FROM cloud_daily
  UNION
  SELECT usage_date FROM ai_daily
  UNION
  SELECT usage_date FROM business_daily
)
SELECT
  CAST(d.usage_date AS STRING) AS usage_date,
  COALESCE(b.team_id, 'support') AS team_id,
  c.cloud_cost_usd,
  a.ai_cost_usd,
  b.headcount,
  b.tickets_resolved,
  b.avg_resolution_minutes,
  b.csat,
  b.active_customers,
  CASE WHEN a.ai_cost_usd IS NULL OR c.cloud_cost_usd <= 0 THEN NULL
    ELSE a.ai_cost_usd / c.cloud_cost_usd END AS ai_cost_share,
  CASE WHEN a.ai_cost_usd IS NULL OR b.headcount <= 0 THEN NULL
    ELSE a.ai_cost_usd / b.headcount END AS ai_cost_per_employee,
  CASE WHEN a.ai_cost_usd IS NULL OR b.tickets_resolved <= 0 THEN NULL
    ELSE a.ai_cost_usd * 1000.0 / b.tickets_resolved END AS ai_cost_per_thousand_tickets,
  CASE WHEN b.headcount <= 0 THEN NULL
    ELSE b.tickets_resolved / b.headcount END AS tickets_per_employee
FROM date_spine d
LEFT JOIN business_daily b USING (usage_date)
LEFT JOIN cloud_daily c USING (usage_date)
LEFT JOIN ai_daily a USING (usage_date)
ORDER BY d.usage_date
`,
    params: rangeParams(range),
  };
}

export function buildAiValueAvailabilityStatement(
  settings: Record<string, string | undefined>,
): SqlStatementInput {
  const catalog = (settings[CATALOG_SETTING_KEY] ?? '').trim();
  const schemas = medallionSchemaNamesFromSettings(settings);
  return {
    query: /* sql */ `
SELECT CAST(COUNT(*) AS DOUBLE) AS required_table_count
FROM system.information_schema.tables
WHERE table_catalog = :catalog
  AND (
    (table_schema = :focus_schema AND table_name = :focus_table)
    OR (table_schema = :analytics_schema AND table_name = 'business_kpi_daily')
  )
`,
    params: [
      { name: 'catalog', value: catalog, type: 'STRING' },
      { name: 'focus_schema', value: schemas.silver, type: 'STRING' },
      { name: 'focus_table', value: FOCUS_VIEW_TABLE_DEFAULT, type: 'STRING' },
      { name: 'analytics_schema', value: schemas.gold, type: 'STRING' },
    ],
  };
}

export function rangeParams(range: UsageRange): SqlParam[] {
  return [
    { name: 'start_ts', value: range.start, type: 'TIMESTAMP' },
    { name: 'end_ts', value: range.end, type: 'TIMESTAMP' },
  ];
}

export function providerNameSql(fallback = "'Unknown'"): string {
  return `COALESCE(NULLIF(TRIM(ProviderName), ''), ${fallback}, 'Unknown')`;
}

export function rollupRowsSql(table: string): string {
  const providerSql = providerNameSql();
  return /* sql */ `
WITH matched AS (
  SELECT
    CONCAT(
      LOWER(${providerSql}),
      ':',
      COALESCE(NULLIF(TRIM(BillingAccountId), ''), 'unknown')
    ) AS data_source_id,
    ${providerSql} AS source_provider_name,
    b.*
  FROM ${table} b
)
`;
}

export function buildDailySql(cte: string): string {
  return /* sql */ `
${cte}
SELECT
  data_source_id,
  date_format(x_ChargeDate, 'yyyy-MM-dd') AS usage_date,
  source_provider_name AS provider_name,
  COALESCE(NULLIF(TRIM(ServiceCategory), ''), 'Unknown') AS service_category,
  COALESCE(NULLIF(TRIM(ServiceName), ''), 'Unknown') AS service_name,
  CAST(SUM(COALESCE(EffectiveCost, 0)) AS DOUBLE) AS cost_usd
FROM matched
WHERE CAST(x_ChargeDate AS TIMESTAMP) >= :start_ts
  AND CAST(x_ChargeDate AS TIMESTAMP) <  :end_ts
GROUP BY 1, 2, 3, 4, 5
ORDER BY 2
`;
}

export function buildCoverageSql(cte: string): string {
  return /* sql */ `
${cte}
, resources AS (
  SELECT
    data_source_id,
    source_provider_name AS provider_name,
    SubAccountId,
    MAX(SubAccountName) AS SubAccountName,
    x_BillingMonth,
    ResourceType,
    ResourceId,
    MAX(CASE WHEN Tags IS NOT NULL AND size(Tags) > 0 THEN 1 ELSE 0 END) AS has_tags
  FROM matched
  WHERE ResourceId IS NOT NULL
    AND TRIM(ResourceId) <> ''
  GROUP BY 1, 2, 3, 5, 6, 7
)
, latest_month_per_source AS (
  SELECT
    data_source_id,
    MAX(x_BillingMonth) AS max_month
  FROM resources
  GROUP BY data_source_id
)
SELECT
  r.data_source_id,
  r.provider_name,
  r.SubAccountId AS sub_account_id,
  r.SubAccountName AS sub_account_name,
  CAST(COUNT(*) AS DOUBLE) AS row_count,
  CAST(SUM(r.has_tags) AS DOUBLE) AS tagged_rows,
  CASE
    WHEN COUNT(*) > 0
      THEN CAST(SUM(r.has_tags) * 100.0 / COUNT(*) AS DOUBLE)
    ELSE CAST(0 AS DOUBLE)
  END AS tag_coverage_pct,
  CAST(MAX(r.x_BillingMonth) AS STRING) AS last_charge_at
FROM resources r
JOIN latest_month_per_source lm
  ON r.data_source_id = lm.data_source_id
  AND r.x_BillingMonth = lm.max_month
GROUP BY 1, 2, 3, 4
ORDER BY tag_coverage_pct DESC, row_count DESC
`;
}

export function usageTableName(
  kind: keyof typeof GOLD_USAGE_TABLES,
  settings: Record<string, string | undefined>,
): { display: string; sql: string } {
  const catalog = (settings[CATALOG_SETTING_KEY] ?? '').trim();
  const goldSchema =
    medallionSchemaNamesFromSettings(settings).gold || MEDALLION_SCHEMA_DEFAULTS.gold;
  const table = GOLD_USAGE_TABLES[kind];
  const parts = catalog ? [catalog, goldSchema, table] : [goldSchema, table];
  return {
    display: parts.join('.'),
    sql: parts.map((part) => quoteIdent(part)).join('.'),
  };
}

function qualifiedTable(catalog: string, schema: string, table: string): string {
  const parts = catalog ? [catalog, schema, table] : [schema, table];
  return parts.map(quoteIdent).join('.');
}
