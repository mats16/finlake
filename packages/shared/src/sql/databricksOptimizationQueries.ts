import type { DataSource } from '../schemas/dataSource.js';
import {
  CATALOG_SETTING_KEY,
  DEFAULT_DATABRICKS_ACCOUNT_ID,
  DATABRICKS_LIST_PRICES_TABLE_DEFAULT,
  isDatabricksProvider,
  PROVIDER_DATABRICKS,
  isDatabricksDefaultAccount,
  MEDALLION_SCHEMA_DEFAULTS,
  medallionSchemaNamesFromSettings,
  PRICING_SCHEMA_DEFAULT,
} from '../schemas/dataSource.js';
import type { DatabricksOptimizationRange } from '../schemas/optimization.js';
import type { SqlParam } from '../schemas/sql.js';
import { quoteIdent } from './focusView.sql.js';
import type { SqlStatementInput } from './overviewQueries.js';

const DEFAULT_DATABRICKS_TABLE = 'databricks_usage';
const KNOWN_COST_DENOMINATOR = '(serverless_cost_usd + non_serverless_cost_usd)';
const AWS_EC2_PRICING_TABLE_SQL = '`finops`.`pricing`.`aws_ec2`';
const EC2_REFERENCE_INSTANCE_TYPE = 'r6i.xlarge';
const DEFAULT_DATABRICKS_LIST_PRICES_TABLE_SQL = [
  PRICING_SCHEMA_DEFAULT,
  DATABRICKS_LIST_PRICES_TABLE_DEFAULT,
]
  .map((part) => quoteIdent(part))
  .join('.');

export type DatabricksTrendGrain = 'day' | 'month';

export interface DatabricksOptimizeSource {
  tableDisplay: string;
  tableSql: string;
  databricksListPricesTableSql: string;
  billingAccountId: string | null;
}

export function resolveDatabricksOptimizeSources(
  dataSources: DataSource[],
  settings: Record<string, string | undefined>,
): DatabricksOptimizeSource[] {
  const catalog = (settings[CATALOG_SETTING_KEY] ?? '').trim();
  const silverSchema =
    medallionSchemaNamesFromSettings(settings).silver || MEDALLION_SCHEMA_DEFAULTS.silver;
  const configured = dataSources
    .filter((source) => source.enabled && isDatabricksProvider(source.providerName))
    .map((source) => databricksOptimizeSource(catalog, silverSchema, source));
  return configured.length > 0
    ? configured
    : [
        databricksOptimizeSource(catalog, silverSchema, {
          tableName: DEFAULT_DATABRICKS_TABLE,
          providerName: PROVIDER_DATABRICKS,
          accountId: DEFAULT_DATABRICKS_ACCOUNT_ID,
        }),
      ];
}

export function databricksOptimizeParams(
  sources: DatabricksOptimizeSource[],
  range: DatabricksOptimizationRange,
): SqlParam[] {
  return [
    { name: 'start_ts', value: range.start, type: 'TIMESTAMP' },
    { name: 'end_ts', value: range.end, type: 'TIMESTAMP' },
    { name: 'workspace_id', value: range.workspaceId ?? null, type: 'STRING' },
    ...sources.map((source, index) => ({
      name: `billing_account_id_${index}`,
      value: source.billingAccountId,
      type: 'STRING' as const,
    })),
  ];
}

export function buildDatabricksSummaryStatement(
  sources: DatabricksOptimizeSource[],
  range: DatabricksOptimizationRange,
): SqlStatementInput {
  const cte = buildDatabricksOptimizeCte(sources);
  return {
    query: buildDatabricksSummarySql(cte),
    params: databricksOptimizeParams(sources, range),
  };
}

export function buildDatabricksWorkspacesStatement(
  sources: DatabricksOptimizeSource[],
  range: DatabricksOptimizationRange,
): SqlStatementInput {
  const cte = buildDatabricksOptimizeCte(sources);
  return {
    query: buildDatabricksWorkspacesSql(cte),
    params: databricksOptimizeParams(sources, range),
  };
}

export function buildDatabricksTrendStatement(
  sources: DatabricksOptimizeSource[],
  range: DatabricksOptimizationRange,
  grain: DatabricksTrendGrain,
): SqlStatementInput {
  const cte = buildDatabricksOptimizeCte(sources);
  return {
    query: buildDatabricksTrendSql(cte, grain),
    params: databricksOptimizeParams(sources, range),
  };
}

export function buildDatabricksServicesStatement(
  sources: DatabricksOptimizeSource[],
  range: DatabricksOptimizationRange,
): SqlStatementInput {
  const cte = buildDatabricksOptimizeCte(sources);
  return {
    query: buildDatabricksServicesSql(cte),
    params: databricksOptimizeParams(sources, range),
  };
}

export function buildDatabricksRecommendationsStatement(
  sources: DatabricksOptimizeSource[],
  range: DatabricksOptimizationRange,
): SqlStatementInput {
  const cte = buildDatabricksOptimizeCte(sources);
  const pricingTableSql =
    sources[0]?.databricksListPricesTableSql ?? DEFAULT_DATABRICKS_LIST_PRICES_TABLE_SQL;
  return {
    query: buildDatabricksRecommendationsSql(cte, pricingTableSql),
    params: databricksOptimizeParams(sources, range),
  };
}

export function buildDatabricksClusterUtilizationStatement(
  range: DatabricksOptimizationRange,
): SqlStatementInput {
  return {
    query: buildDatabricksClusterUtilizationSql(),
    params: databricksClusterUtilizationParams(range),
  };
}

export function buildDatabricksQueryWarehouseTrendStatement(
  sources: DatabricksOptimizeSource[],
  range: DatabricksOptimizationRange,
  grain: DatabricksTrendGrain,
): SqlStatementInput {
  const cte = buildDatabricksOptimizeCte(sources);
  return {
    query: buildDatabricksQueryWarehouseTrendSql(cte, grain),
    params: databricksOptimizeParams(sources, range),
  };
}

export function buildDatabricksQueryAttributionStatement(
  sources: DatabricksOptimizeSource[],
  range: DatabricksOptimizationRange,
): SqlStatementInput {
  const cte = buildDatabricksOptimizeCte(sources);
  return {
    query: buildDatabricksQueryAttributionSql(cte),
    params: databricksOptimizeParams(sources, range),
  };
}

export function buildDatabricksOptimizeCte(sources: DatabricksOptimizeSource[]): string {
  const selects = sources
    .map(
      (source, index) => /* sql */ `
  SELECT
    CAST(ChargePeriodStart AS TIMESTAMP) AS charge_period_start,
    BillingAccountId AS billing_account_id,
    BillingAccountName AS billing_account_name,
    SubAccountId AS workspace_id,
    SubAccountName AS workspace_name,
    RegionId AS region_id,
    COALESCE(NULLIF(TRIM(ServiceCategory), ''), 'Unknown') AS service_category,
    COALESCE(NULLIF(TRIM(ServiceName), ''), 'Unknown') AS service_name,
    COALESCE(NULLIF(TRIM(ResourceType), ''), 'Unknown') AS resource_type,
    ResourceId AS resource_id,
    ResourceName AS resource_name,
    NULLIF(TRIM(SkuId), '') AS sku_id,
    NULLIF(TRIM(SkuPriceDetails['InstanceType']), '') AS instance_type,
    CAST(ConsumedQuantity AS DOUBLE) AS consumed_quantity,
    CAST(ListCost AS DOUBLE) AS list_cost_usd,
    CAST(ListUnitPrice AS DOUBLE) AS list_unit_price_usd,
    NULLIF(TRIM(PricingUnit), '') AS pricing_unit,
    CAST(COALESCE(EffectiveCost, 0) AS DOUBLE) AS cost_usd,
    CAST(${quoteIdent('x_Serverless')} AS BOOLEAN) AS x_serverless,
    CAST(${quoteIdent('x_Photon')} AS BOOLEAN) AS x_photon
  FROM ${source.tableSql}
  WHERE ProviderName = 'Databricks'
    AND CAST(ChargePeriodStart AS TIMESTAMP) >= :start_ts
    AND CAST(ChargePeriodStart AS TIMESTAMP) < :end_ts
    AND (:billing_account_id_${index} IS NULL OR BillingAccountId = :billing_account_id_${index})`,
    )
    .join('\n  UNION ALL\n');

  return /* sql */ `
WITH usage_rows AS (
${selects}
),
filtered AS (
  SELECT *
  FROM usage_rows
  WHERE charge_period_start >= :start_ts
    AND charge_period_start < :end_ts
    AND (:workspace_id IS NULL OR workspace_id = :workspace_id)
)
`;
}

export function databricksClusterUtilizationParams(range: DatabricksOptimizationRange): SqlParam[] {
  return [
    { name: 'start_ts', value: range.start, type: 'TIMESTAMP' },
    { name: 'end_ts', value: range.end, type: 'TIMESTAMP' },
    { name: 'workspace_id', value: range.workspaceId ?? null, type: 'STRING' },
  ];
}

export function buildDatabricksClusterUtilizationSql(): string {
  return /* sql */ `
WITH overlapped_node_timeline AS (
  SELECT
    CAST(workspace_id AS STRING) AS workspace_id,
    cluster_id,
    CAST(
      GREATEST(
        TIMESTAMPDIFF(
          SECOND,
          GREATEST(start_time, :start_ts),
          LEAST(end_time, :end_ts)
        ),
        0
      ) AS DOUBLE
    ) AS overlap_seconds,
    CAST(COALESCE(cpu_user_percent, 0) + COALESCE(cpu_system_percent, 0) AS DOUBLE) AS cpu_percent
  FROM system.compute.node_timeline
  WHERE start_time < :end_ts
    AND end_time > :start_ts
    AND (:workspace_id IS NULL OR CAST(workspace_id AS STRING) = :workspace_id)
    AND cluster_id IS NOT NULL
    AND TRIM(cluster_id) <> ''
),
cluster_metrics AS (
  SELECT
    workspace_id,
    cluster_id,
    CAST(SUM(cpu_percent * overlap_seconds) AS DOUBLE) AS weighted_cpu_seconds,
    CAST(SUM(overlap_seconds) AS DOUBLE) AS observed_node_seconds
  FROM overlapped_node_timeline
  WHERE overlap_seconds > 0
  GROUP BY workspace_id, cluster_id
)
SELECT
  workspace_id,
  cluster_id,
  CASE
    WHEN observed_node_seconds > 0
      THEN CAST(weighted_cpu_seconds / observed_node_seconds AS DOUBLE)
    ELSE CAST(NULL AS DOUBLE)
  END AS cpu_utilization_percent
FROM cluster_metrics
`;
}

export function buildDatabricksQueryWarehouseTrendSql(
  cte: string,
  grain: DatabricksTrendGrain,
): string {
  const unit = grain === 'day' ? 'DAY' : 'MONTH';
  const format = grain === 'day' ? 'yyyy-MM-dd' : 'yyyy-MM';
  const periodExpression = `date_format(date_trunc('${unit}', charge_period_start), '${format}')`;
  return /* sql */ `
${cte}
, warehouse_cost AS (
  SELECT
    ${periodExpression} AS period,
    workspace_id,
    MAX(workspace_name) AS workspace_name,
    resource_id AS warehouse_id,
    MAX_BY(resource_name, charge_period_start) AS warehouse_name,
    CAST(SUM(cost_usd) AS DOUBLE) AS cost_usd
  FROM filtered
  WHERE service_name = 'SQL'
    AND resource_id IS NOT NULL
    AND TRIM(resource_id) <> ''
  GROUP BY ${periodExpression}, workspace_id, resource_id
)
SELECT
  period,
  workspace_id,
  workspace_name,
  warehouse_id,
  warehouse_name,
  cost_usd
FROM warehouse_cost
ORDER BY period, cost_usd DESC
`;
}

export function buildDatabricksQueryAttributionSql(cte: string): string {
  return /* sql */ `
${cte}
, warehouse_cost AS (
  SELECT
    workspace_id,
    MAX(workspace_name) AS workspace_name,
    resource_id AS warehouse_id,
    MAX_BY(resource_name, charge_period_start) AS warehouse_name,
    CAST(SUM(cost_usd) AS DOUBLE) AS warehouse_cost_usd
  FROM filtered
  WHERE service_name = 'SQL'
    AND resource_id IS NOT NULL
    AND TRIM(resource_id) <> ''
  GROUP BY workspace_id, resource_id
),
query_history AS (
  SELECT
    CAST(workspace_id AS STRING) AS workspace_id,
    compute.warehouse_id AS warehouse_id,
    statement_id,
    execution_status,
    CAST(start_time AS TIMESTAMP) AS start_time,
    CAST(end_time AS TIMESTAMP) AS end_time,
    CASE
      WHEN statement_text IS NULL OR TRIM(statement_text) = '' THEN NULL
      ELSE REGEXP_REPLACE(TRIM(statement_text), '\\\\s+', ' ')
    END AS normalized_statement_text,
    NULLIF(TRIM(statement_type), '') AS statement_type,
    NULLIF(TRIM(executed_by), '') AS executed_by,
    NULLIF(TRIM(client_application), '') AS client_application,
    CAST(COALESCE(execution_duration_ms, total_duration_ms, 0) AS DOUBLE) AS execution_ms,
    CAST(read_bytes AS DOUBLE) AS read_bytes,
    CAST(read_rows AS DOUBLE) AS read_rows,
    CAST(produced_rows AS DOUBLE) AS produced_rows,
    CAST(spilled_local_bytes AS DOUBLE) AS spilled_local_bytes
  FROM system.query.history
  WHERE start_time >= :start_ts
    AND start_time < :end_ts
    AND compute.type = 'WAREHOUSE'
    AND compute.warehouse_id IS NOT NULL
    AND TRIM(compute.warehouse_id) <> ''
    AND (:workspace_id IS NULL OR CAST(workspace_id AS STRING) = :workspace_id)
),
query_rows AS (
  SELECT
    workspace_id,
    warehouse_id,
    statement_id,
    execution_status,
    start_time,
    end_time,
    COALESCE(normalized_statement_text, CONCAT('[statement text unavailable] ', statement_id)) AS statement_text,
    CASE
      WHEN normalized_statement_text IS NULL THEN CONCAT('statement:', statement_id)
      ELSE SHA2(normalized_statement_text, 256)
    END AS query_hash,
    statement_type,
    executed_by,
    client_application,
    execution_ms,
    read_bytes,
    read_rows,
    produced_rows,
    spilled_local_bytes
  FROM query_history
  WHERE execution_ms > 0
),
warehouse_query_totals AS (
  SELECT
    workspace_id,
    warehouse_id,
    CAST(SUM(execution_ms) AS DOUBLE) AS warehouse_query_execution_ms
  FROM query_rows
  GROUP BY workspace_id, warehouse_id
),
query_metrics AS (
  SELECT
    workspace_id,
    warehouse_id,
    query_hash,
    MAX_BY(statement_id, start_time) AS latest_statement_id,
    MAX_BY(statement_text, start_time) AS statement_text,
    MAX_BY(statement_type, start_time) AS statement_type,
    MAX_BY(executed_by, start_time) AS executed_by,
    MAX_BY(client_application, start_time) AS client_application,
    MAX_BY(execution_status, start_time) AS execution_status,
    CAST(COUNT(*) AS DOUBLE) AS execution_count,
    CAST(COUNT_IF(execution_status = 'FAILED') AS DOUBLE) AS failed_count,
    CAST(COUNT_IF(execution_status = 'CANCELED') AS DOUBLE) AS canceled_count,
    CAST(SUM(execution_ms) AS DOUBLE) AS query_execution_ms,
    CAST(AVG(execution_ms) AS DOUBLE) AS avg_execution_ms,
    CAST(MAX(execution_ms) AS DOUBLE) AS max_execution_ms,
    CAST(SUM(read_bytes) AS DOUBLE) AS read_bytes,
    CAST(SUM(read_rows) AS DOUBLE) AS read_rows,
    CAST(SUM(produced_rows) AS DOUBLE) AS produced_rows,
    CAST(SUM(spilled_local_bytes) AS DOUBLE) AS spilled_local_bytes,
    CAST(MIN(start_time) AS STRING) AS first_start_time,
    CAST(MAX(end_time) AS STRING) AS last_end_time
  FROM query_rows
  GROUP BY workspace_id, warehouse_id, query_hash
)
SELECT
  qm.workspace_id,
  wc.workspace_name,
  qm.warehouse_id,
  wc.warehouse_name,
  qm.query_hash,
  qm.latest_statement_id,
  SUBSTR(qm.statement_text, 1, 1000) AS statement_text,
  qm.statement_type,
  qm.executed_by,
  qm.client_application,
  qm.execution_status,
  qm.execution_count,
  qm.failed_count,
  qm.canceled_count,
  qm.query_execution_ms,
  qm.avg_execution_ms,
  qm.max_execution_ms,
  wqt.warehouse_query_execution_ms,
  CAST(wc.warehouse_cost_usd AS DOUBLE) AS warehouse_cost_usd,
  CASE
    WHEN wqt.warehouse_query_execution_ms > 0 AND wc.warehouse_cost_usd IS NOT NULL
      THEN CAST(wc.warehouse_cost_usd * qm.query_execution_ms / wqt.warehouse_query_execution_ms AS DOUBLE)
    ELSE CAST(NULL AS DOUBLE)
  END AS allocated_cost_usd,
  qm.read_bytes,
  qm.read_rows,
  qm.produced_rows,
  qm.spilled_local_bytes,
  qm.first_start_time,
  qm.last_end_time
FROM query_metrics qm
  INNER JOIN warehouse_query_totals wqt
    ON qm.workspace_id = wqt.workspace_id
    AND qm.warehouse_id = wqt.warehouse_id
  LEFT JOIN warehouse_cost wc
    ON qm.workspace_id = wc.workspace_id
    AND qm.warehouse_id = wc.warehouse_id
ORDER BY allocated_cost_usd DESC NULLS LAST, query_execution_ms DESC
LIMIT 100
`;
}

export function buildDatabricksSummarySql(cte: string): string {
  return /* sql */ `
${cte}
, totals AS (
  SELECT
    CAST(COALESCE(SUM(cost_usd), 0) AS DOUBLE) AS total_cost_usd,
    CAST(COALESCE(SUM(CASE WHEN x_serverless = true THEN cost_usd ELSE 0 END), 0) AS DOUBLE) AS serverless_cost_usd,
    CAST(COALESCE(SUM(CASE WHEN x_serverless = false THEN cost_usd ELSE 0 END), 0) AS DOUBLE) AS non_serverless_cost_usd,
    CAST(COALESCE(SUM(CASE WHEN x_serverless IS NULL THEN cost_usd ELSE 0 END), 0) AS DOUBLE) AS unknown_cost_usd
  FROM filtered
),
candidate_resources AS (
  SELECT resource_id
  FROM filtered
  WHERE resource_id IS NOT NULL
    AND TRIM(resource_id) <> ''
  GROUP BY workspace_id, service_name, resource_type, resource_id
  HAVING SUM(CASE WHEN x_serverless = false THEN cost_usd ELSE 0 END) > 0
)
SELECT
  total_cost_usd,
  serverless_cost_usd,
  non_serverless_cost_usd,
  unknown_cost_usd,
  CASE
    WHEN ${KNOWN_COST_DENOMINATOR} > 0
      THEN CAST(serverless_cost_usd * 100.0 / ${KNOWN_COST_DENOMINATOR} AS DOUBLE)
    ELSE CAST(NULL AS DOUBLE)
  END AS serverless_ratio,
  CAST((SELECT COUNT(*) FROM candidate_resources) AS DOUBLE) AS candidate_resource_count
FROM totals
`;
}

export function buildDatabricksWorkspacesSql(cte: string): string {
  return /* sql */ `
${cte}
, metrics AS (
  SELECT
    workspace_id,
    MAX(workspace_name) AS workspace_name,
    CAST(SUM(cost_usd) AS DOUBLE) AS total_cost_usd,
    CAST(SUM(CASE WHEN x_serverless = true THEN cost_usd ELSE 0 END) AS DOUBLE) AS serverless_cost_usd,
    CAST(SUM(CASE WHEN x_serverless = false THEN cost_usd ELSE 0 END) AS DOUBLE) AS non_serverless_cost_usd
  FROM filtered
  GROUP BY workspace_id
)
SELECT
  workspace_id,
  workspace_name,
  total_cost_usd,
  serverless_cost_usd,
  non_serverless_cost_usd,
  CASE
    WHEN ${KNOWN_COST_DENOMINATOR} > 0
      THEN CAST(serverless_cost_usd * 100.0 / ${KNOWN_COST_DENOMINATOR} AS DOUBLE)
    ELSE CAST(NULL AS DOUBLE)
  END AS serverless_ratio
FROM metrics
ORDER BY total_cost_usd DESC
`;
}

export function buildDatabricksTrendSql(cte: string, grain: DatabricksTrendGrain): string {
  const unit = grain === 'day' ? 'DAY' : 'MONTH';
  const format = grain === 'day' ? 'yyyy-MM-dd' : 'yyyy-MM';
  const periodExpression = `date_format(date_trunc('${unit}', charge_period_start), '${format}')`;
  return /* sql */ `
${cte}
, metrics AS (
  SELECT
    ${periodExpression} AS period,
    CAST(SUM(cost_usd) AS DOUBLE) AS total_cost_usd,
    CAST(SUM(CASE WHEN x_serverless = true THEN cost_usd ELSE 0 END) AS DOUBLE) AS serverless_cost_usd,
    CAST(SUM(CASE WHEN x_serverless = false THEN cost_usd ELSE 0 END) AS DOUBLE) AS non_serverless_cost_usd,
    CAST(SUM(CASE WHEN x_serverless IS NULL THEN cost_usd ELSE 0 END) AS DOUBLE) AS unknown_cost_usd
  FROM filtered
  GROUP BY ${periodExpression}
)
SELECT
  period,
  total_cost_usd,
  serverless_cost_usd,
  non_serverless_cost_usd,
  unknown_cost_usd,
  CASE
    WHEN ${KNOWN_COST_DENOMINATOR} > 0
      THEN CAST(serverless_cost_usd * 100.0 / ${KNOWN_COST_DENOMINATOR} AS DOUBLE)
    ELSE CAST(NULL AS DOUBLE)
  END AS serverless_ratio
FROM metrics
ORDER BY period
`;
}

export function buildDatabricksServicesSql(cte: string): string {
  return /* sql */ `
${cte}
, service_rows AS (
  SELECT
    CASE
      WHEN service_name IN ('ALL_PURPOSE', 'INTERACTIVE') THEN 'Compute'
      ELSE service_category
    END AS service_category,
    CASE
      WHEN service_name IN ('ALL_PURPOSE', 'INTERACTIVE') THEN 'ALL_PURPOSE'
      ELSE service_name
    END AS service_name,
    cost_usd,
    x_serverless
  FROM filtered
),
metrics AS (
  SELECT
    service_category,
    service_name,
    CAST(SUM(cost_usd) AS DOUBLE) AS total_cost_usd,
    CAST(SUM(CASE WHEN x_serverless = true THEN cost_usd ELSE 0 END) AS DOUBLE) AS serverless_cost_usd,
    CAST(SUM(CASE WHEN x_serverless = false THEN cost_usd ELSE 0 END) AS DOUBLE) AS non_serverless_cost_usd
  FROM service_rows
  GROUP BY service_category, service_name
)
SELECT
  service_category,
  service_name,
  total_cost_usd,
  serverless_cost_usd,
  non_serverless_cost_usd,
  CASE
    WHEN ${KNOWN_COST_DENOMINATOR} > 0
      THEN CAST(serverless_cost_usd * 100.0 / ${KNOWN_COST_DENOMINATOR} AS DOUBLE)
    ELSE CAST(NULL AS DOUBLE)
  END AS serverless_ratio
FROM metrics
ORDER BY
  CASE service_name
    WHEN 'SQL' THEN 1
    WHEN 'ALL_PURPOSE' THEN 2
    WHEN 'DLT' THEN 3
    WHEN 'JOBS' THEN 4
    ELSE 99
  END,
  service_name
`;
}

export function buildDatabricksRecommendationsSql(
  cte: string,
  databricksListPricesTableSql = DEFAULT_DATABRICKS_LIST_PRICES_TABLE_SQL,
): string {
  return /* sql */ `
${cte}
, ec2_reference_prices AS (
  SELECT
    RegionId AS region_id,
    CAST(MIN(CAST(ListUnitPrice AS DOUBLE)) AS DOUBLE) AS ec2_hourly_price_usd
  FROM ${AWS_EC2_PRICING_TABLE_SQL}
  WHERE SkuPriceDetails['InstanceType'] = '${EC2_REFERENCE_INSTANCE_TYPE}'
    AND PricingCategory = 'Standard'
    AND SkuPriceDetails['OperatingSystem'] = 'Linux'
    AND CAST(ListUnitPrice AS DOUBLE) > 0
  GROUP BY RegionId
),
ec2_global_reference_price AS (
  SELECT CAST(MIN(ec2_hourly_price_usd) AS DOUBLE) AS ec2_hourly_price_usd
  FROM ec2_reference_prices
),
databricks_serverless_prices AS (
  SELECT
    x_SkuNameBase AS serverless_sku_name_base,
    RegionId AS region_id,
    PricingUnit AS pricing_unit,
    CAST(MIN(CAST(COALESCE(EffectiveListUnitPrice, ListUnitPrice) AS DOUBLE)) AS DOUBLE) AS serverless_unit_price_usd
  FROM ${databricksListPricesTableSql}
  WHERE COALESCE(EffectiveListUnitPrice, ListUnitPrice) IS NOT NULL
  GROUP BY x_SkuNameBase, RegionId, PricingUnit
),
filtered_with_dbu AS (
  SELECT *,
    CASE
      WHEN x_serverless = false THEN
        CASE
          WHEN consumed_quantity IS NOT NULL THEN consumed_quantity
          WHEN list_cost_usd IS NOT NULL AND list_unit_price_usd > 0
            THEN list_cost_usd / list_unit_price_usd
          ELSE NULL
        END
      ELSE NULL
    END AS base_dbu
  FROM filtered
  WHERE resource_id IS NOT NULL
    AND TRIM(resource_id) <> ''
),
filtered_with_serverless_target AS (
  SELECT *,
    CASE
      WHEN NULLIF(REGEXP_EXTRACT(sku_id, '^(STANDARD|PREMIUM|ENTERPRISE)_', 1), '') IS NULL THEN CAST(NULL AS STRING)
      WHEN service_name IN ('ALL_PURPOSE', 'INTERACTIVE')
        THEN CONCAT(REGEXP_EXTRACT(sku_id, '^(STANDARD|PREMIUM|ENTERPRISE)_', 1), '_ALL_PURPOSE_SERVERLESS_COMPUTE')
      WHEN service_name = 'SQL'
        THEN CONCAT(REGEXP_EXTRACT(sku_id, '^(STANDARD|PREMIUM|ENTERPRISE)_', 1), '_SERVERLESS_SQL_COMPUTE')
      WHEN service_name IN ('JOBS', 'DLT')
        THEN CONCAT(REGEXP_EXTRACT(sku_id, '^(STANDARD|PREMIUM|ENTERPRISE)_', 1), '_JOBS_SERVERLESS_COMPUTE')
      ELSE CAST(NULL AS STRING)
    END AS serverless_sku_name_base
  FROM filtered_with_dbu
),
filtered_with_serverless_price AS (
  SELECT
    target.*,
    price.serverless_unit_price_usd,
    CASE
      WHEN target.base_dbu IS NOT NULL
        AND price.serverless_unit_price_usd IS NOT NULL
        THEN CAST(target.base_dbu * price.serverless_unit_price_usd AS DOUBLE)
      ELSE CAST(NULL AS DOUBLE)
    END AS estimated_serverless_cost_usd
  FROM filtered_with_serverless_target target
    LEFT JOIN databricks_serverless_prices price
      ON target.serverless_sku_name_base = price.serverless_sku_name_base
      AND target.region_id = price.region_id
      AND target.pricing_unit = price.pricing_unit
),
resource_metrics AS (
  SELECT
    workspace_id,
    MAX(workspace_name) AS workspace_name,
    MAX_BY(region_id, charge_period_start) AS region_id,
    service_category,
    service_name,
    resource_type,
    resource_id,
    MAX_BY(resource_name, charge_period_start) AS resource_name,
    MAX_BY(sku_id, charge_period_start) AS sku_id,
    MAX_BY(instance_type, charge_period_start) AS instance_type,
    MAX_BY(serverless_sku_name_base, charge_period_start) AS serverless_sku_name_base,
    CAST(MAX_BY(serverless_unit_price_usd, charge_period_start) AS DOUBLE) AS serverless_unit_price_usd,
    CAST(SUM(cost_usd) AS DOUBLE) AS total_cost_usd,
    CAST(SUM(CASE WHEN x_serverless = true THEN cost_usd ELSE 0 END) AS DOUBLE) AS serverless_cost_usd,
    CAST(SUM(CASE WHEN x_serverless = false THEN cost_usd ELSE 0 END) AS DOUBLE) AS non_serverless_cost_usd,
    CAST(SUM(base_dbu) AS DOUBLE) AS dbu_quantity_estimate,
    CAST(SUM(estimated_serverless_cost_usd) AS DOUBLE) AS estimated_serverless_cost_usd,
    CAST(SUM(base_dbu / CASE WHEN x_photon = true THEN 2.0 ELSE 1.0 END) AS DOUBLE) AS ec2_dbu_quantity_estimate
  FROM filtered_with_serverless_price
  GROUP BY workspace_id, service_category, service_name, resource_type, resource_id
),
scored AS (
  SELECT
    *,
    CASE
      WHEN service_name IN ('SQL', 'JOBS', 'DLT') THEN 1.35
      WHEN service_name IN ('INTERACTIVE', 'NOTEBOOKS', 'ALL_PURPOSE') THEN 1.2
      WHEN service_category IN ('Analytics', 'Compute') THEN 1.1
      ELSE 1.0
    END AS eligibility_weight
  FROM resource_metrics
  WHERE non_serverless_cost_usd > 0
),
ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      ORDER BY non_serverless_cost_usd * eligibility_weight DESC, non_serverless_cost_usd DESC
    ) AS recommendation_rank
  FROM scored
),
priced AS (
  SELECT
    ranked.*,
    COALESCE(regional_ref.ec2_hourly_price_usd, global_ref.ec2_hourly_price_usd) AS ec2_hourly_price_usd
  FROM ranked
    CROSS JOIN ec2_global_reference_price global_ref
    LEFT JOIN ec2_reference_prices regional_ref
      ON ranked.region_id = regional_ref.region_id
)
SELECT
  CAST(recommendation_rank AS DOUBLE) AS rank,
  CASE
    WHEN non_serverless_cost_usd * eligibility_weight >= 1000 THEN 'high'
    WHEN non_serverless_cost_usd * eligibility_weight >= 250 THEN 'medium'
    ELSE 'low'
  END AS priority,
  workspace_id,
  workspace_name,
  service_category,
  service_name,
  resource_type,
  resource_id,
  resource_name,
  sku_id,
  instance_type,
  total_cost_usd,
  non_serverless_cost_usd,
  dbu_quantity_estimate,
  serverless_sku_name_base,
  CAST(serverless_unit_price_usd AS DOUBLE) AS serverless_unit_price_usd,
  estimated_serverless_cost_usd,
  CASE
    WHEN estimated_serverless_cost_usd IS NOT NULL
      THEN CAST(estimated_serverless_cost_usd - non_serverless_cost_usd AS DOUBLE)
    ELSE CAST(NULL AS DOUBLE)
  END AS estimated_serverless_delta_usd,
  CASE
    WHEN ec2_hourly_price_usd IS NOT NULL THEN '${EC2_REFERENCE_INSTANCE_TYPE}'
    ELSE CAST(NULL AS STRING)
  END AS ec2_reference_instance_type,
  CAST(ec2_hourly_price_usd AS DOUBLE) AS ec2_hourly_price_usd,
  CASE
    WHEN ec2_dbu_quantity_estimate IS NOT NULL AND ec2_hourly_price_usd IS NOT NULL
      THEN CAST(ec2_dbu_quantity_estimate * ec2_hourly_price_usd AS DOUBLE)
    ELSE CAST(NULL AS DOUBLE)
  END AS estimated_ec2_cost_usd,
  CASE
    WHEN ec2_dbu_quantity_estimate IS NOT NULL AND ec2_hourly_price_usd IS NOT NULL
      THEN CAST(non_serverless_cost_usd + ec2_dbu_quantity_estimate * ec2_hourly_price_usd AS DOUBLE)
    ELSE CAST(NULL AS DOUBLE)
  END AS estimated_current_total_cost_usd,
  CASE
    WHEN ${KNOWN_COST_DENOMINATOR} > 0
      THEN CAST(serverless_cost_usd * 100.0 / ${KNOWN_COST_DENOMINATOR} AS DOUBLE)
    ELSE CAST(NULL AS DOUBLE)
  END AS serverless_ratio
FROM priced
WHERE recommendation_rank <= 25
ORDER BY recommendation_rank
`;
}

function databricksOptimizeSource(
  catalog: string,
  silverSchema: string,
  source: Pick<DataSource, 'providerName' | 'tableName' | 'accountId'>,
): DatabricksOptimizeSource {
  const parts = catalog
    ? [catalog, silverSchema, source.tableName]
    : [silverSchema, source.tableName];
  const databricksListPricesTableParts = catalog
    ? [catalog, PRICING_SCHEMA_DEFAULT, DATABRICKS_LIST_PRICES_TABLE_DEFAULT]
    : [PRICING_SCHEMA_DEFAULT, DATABRICKS_LIST_PRICES_TABLE_DEFAULT];
  const tableDisplay = parts.join('.');
  return {
    tableDisplay,
    tableSql: parts.map((part) => quoteIdent(part)).join('.'),
    databricksListPricesTableSql: databricksListPricesTableParts
      .map((part) => quoteIdent(part))
      .join('.'),
    billingAccountId: isDatabricksDefaultAccount(source) ? null : source.accountId,
  };
}
