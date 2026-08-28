import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAiValueStatement,
  buildAiValueAvailabilityStatement,
  buildCoverageSql,
  buildOverviewDailyStatement,
  buildOverviewServicesStatement,
  buildOverviewSkusStatement,
  buildDailySql,
  rangeParams,
  rollupRowsSql,
} from '@finlake/shared';

test('AI value statement joins daily aggregates and preserves missing billed AI cost', () => {
  const statement = buildAiValueStatement(
    { catalog_name: 'finops', silver_schema_name: 'focus', gold_schema_name: 'analytics' },
    { start: '2026-08-01T00:00:00Z', end: '2026-09-01T00:00:00Z' },
  );

  assert.match(statement.query, /FROM `finops`\.`analytics`\.`usage_daily`/);
  assert.match(statement.query, /FROM `finops`\.`focus`\.`databricks_usage`/);
  assert.match(statement.query, /FROM `finops`\.`analytics`\.`business_kpi_daily`/);
  assert.match(statement.query, /ResourceType = 'AI Gateway Model Service'/);
  assert.match(statement.query, /ResourceName = 'finops\.analytics\.support_copilot'/);
  assert.equal(statement.query.match(/BillingCurrency = 'USD'/g)?.length, 2);
  assert.match(statement.query, /business_daily AS \([\s\S]*GROUP BY 1, 2/);
  assert.match(
    statement.query,
    /date_spine AS \([\s\S]*SELECT usage_date FROM cloud_daily[\s\S]*UNION[\s\S]*SELECT usage_date FROM ai_daily[\s\S]*UNION[\s\S]*SELECT usage_date FROM business_daily/,
  );
  assert.match(statement.query, /FROM date_spine d/);
  assert.match(statement.query, /LEFT JOIN business_daily b USING \(usage_date\)/);
  assert.match(statement.query, /LEFT JOIN ai_daily a USING \(usage_date\)/);
  assert.match(statement.query, /a\.ai_cost_usd IS NULL OR c\.cloud_cost_usd <= 0 THEN NULL/);
  assert.match(statement.query, /a\.ai_cost_usd IS NULL OR b\.headcount <= 0 THEN NULL/);
  assert.match(statement.query, /a\.ai_cost_usd IS NULL OR b\.tickets_resolved <= 0 THEN NULL/);
  assert.match(statement.query, /WHEN b\.headcount <= 0 THEN NULL/);
  assert.doesNotMatch(statement.query, /system\.ai_gateway\.usage/);
  assert.deepEqual(
    statement.params.map((param) => param.name),
    ['start_ts', 'end_ts'],
  );
});

test('AI value availability checks both opt-in Databricks demo tables', () => {
  const statement = buildAiValueAvailabilityStatement({
    catalog_name: 'finops',
    silver_schema_name: 'focus',
    gold_schema_name: 'analytics',
  });

  assert.match(statement.query, /FROM system\.information_schema\.tables/);
  assert.match(statement.query, /table_name = :focus_table/);
  assert.match(statement.query, /table_name = 'business_kpi_daily'/);
  assert.deepEqual(
    statement.params.map((param) => [param.name, param.value]),
    [
      ['catalog', 'finops'],
      ['focus_schema', 'focus'],
      ['focus_table', 'databricks_usage'],
      ['analytics_schema', 'analytics'],
    ],
  );
});

test('rangeParams includes only the time range', () => {
  const range = { start: '2025-01-01T00:00:00Z', end: '2025-02-01T00:00:00Z' };
  const params = rangeParams(range);

  const names = params.map((p) => p.name);
  assert.deepEqual(names, ['start_ts', 'end_ts']);
});

test('rollupRowsSql reads the rollup table directly without requested source filtering', () => {
  const sql = rollupRowsSql('`catalog`.`gold`.`usage_daily`');

  assert.ok(sql.includes('matched AS'));
  assert.ok(sql.includes('`catalog`.`gold`.`usage_daily`'));
  assert.ok(sql.includes('AS data_source_id'));
  assert.ok(sql.includes('AS source_provider_name'));
  assert.ok(!sql.includes('requested AS'));
  assert.ok(!sql.includes('JOIN requested'));
});

test('buildOverviewDailyStatement reads usage_daily even without configured sources', () => {
  const statement = buildOverviewDailyStatement(
    { catalog_name: 'finops', gold_schema_name: 'gold' },
    { start: '2025-01-01T00:00:00Z', end: '2025-02-01T00:00:00Z' },
  );

  assert.deepEqual(
    statement.params.map((param) => param.name),
    ['start_ts', 'end_ts'],
  );
  assert.ok(!statement.query.includes('JOIN requested'));
});

test('overview service and SKU statements bind only range params', () => {
  const settings = { catalog_name: 'finops', gold_schema_name: 'gold' };
  const range = { start: '2025-01-01T00:00:00Z', end: '2025-02-01T00:00:00Z' };

  for (const buildStatement of [buildOverviewServicesStatement, buildOverviewSkusStatement]) {
    const statement = buildStatement(settings, range);

    assert.deepEqual(
      statement.params.map((param) => param.name),
      ['start_ts', 'end_ts'],
    );
    assert.ok(!statement.query.includes('JOIN requested'));
  }
});

test('buildDailySql preserves all months and groups by 5 dimensions', () => {
  const sql = buildDailySql('-- cte --');

  assert.ok(sql.includes('-- cte --'));
  assert.ok(sql.includes('service_category'));
  assert.ok(sql.includes('service_name'));
  assert.ok(sql.includes('GROUP BY 1, 2, 3, 4, 5'));
  assert.ok(sql.includes('ORDER BY 2'));
  assert.ok(
    !/LIMIT\s+\d+/i.test(sql),
    'queryDaily must not LIMIT — would silently drop older months',
  );
});

test('buildCoverageSql filters by per-source latest billing month', () => {
  const sql = buildCoverageSql('-- cte --');

  assert.ok(sql.includes('-- cte --'));
  assert.ok(sql.includes('resources AS'));
  assert.ok(sql.includes('latest_month_per_source AS'));
  assert.match(sql, /GROUP BY 1, 2, 3, 5, 6, 7\s*\)\s*, latest_month_per_source AS/);
  assert.ok(sql.includes('GROUP BY data_source_id'));
  assert.ok(sql.includes('JOIN latest_month_per_source'));
  assert.ok(sql.includes('r.data_source_id = lm.data_source_id'));
  assert.ok(sql.includes('r.x_BillingMonth = lm.max_month'));
  assert.ok(
    !sql.includes('WHERE r.x_BillingMonth = (SELECT MAX(x_BillingMonth) FROM resources)'),
    'cross-source MAX would drop data sources whose latest month lags behind',
  );
});
