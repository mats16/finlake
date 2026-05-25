import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCoverageSql,
  buildOverviewDailyStatement,
  buildOverviewServicesStatement,
  buildOverviewSkusStatement,
  buildDailySql,
  joinedBillingRowsSql,
  rangeParams,
  sourceJoinParams,
  type DataSource,
} from '@finlake/shared';

function fakeSource(overrides: Partial<DataSource> = {}): DataSource {
  const accountId = overrides.accountId ?? 'default';
  return {
    name: `source-${accountId}`,
    providerName: 'databricks',
    accountId,
    tableName: 'usage',
    focusVersion: null,
    pipelineId: null,
    enabled: true,
    config: {},
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

test('rangeParams includes only the time range', () => {
  const range = { start: '2025-01-01T00:00:00Z', end: '2025-02-01T00:00:00Z' };
  const params = rangeParams(range);

  const names = params.map((p) => p.name);
  assert.deepEqual(names, ['start_ts', 'end_ts']);
});

test('sourceJoinParams binds source keys and billing accounts', () => {
  const params = sourceJoinParams([
    fakeSource({ providerName: 'aws', accountId: '123456789012' }),
    fakeSource({ providerName: 'gcp', accountId: 'ABCDEF_123456_ABCDEF' }),
  ]);

  assert.equal(params.find((p) => p.name === 'data_source_id_0')?.value, 'aws:123456789012');
  assert.equal(params.find((p) => p.name === 'account_id_0')?.value, '123456789012');
  assert.equal(params.find((p) => p.name === 'account_id_1')?.value, 'ABCDEF-123456-ABCDEF');
});

test('joinedBillingRowsSql joins requested enabled sources to the rollup table', () => {
  const sql = joinedBillingRowsSql([fakeSource()], '`catalog`.`gold`.`usage_daily`');

  assert.ok(sql.includes('matched AS'));
  assert.ok(sql.includes('requested AS'));
  assert.ok(sql.includes('`catalog`.`gold`.`usage_daily`'));
  assert.ok(sql.includes(':data_source_id_0 AS data_source_id'));
  assert.ok(sql.includes('JOIN requested'));
  assert.ok(sql.includes('BillingAccountId = r.account_id'));
});

test('buildOverviewDailyStatement returns null without enabled sources', () => {
  const statement = buildOverviewDailyStatement(
    [],
    { catalog_name: 'finops', gold_schema_name: 'gold' },
    { start: '2025-01-01T00:00:00Z', end: '2025-02-01T00:00:00Z' },
  );

  assert.equal(statement, null);
});

test('overview service and SKU statements bind source join params', () => {
  const sources = [fakeSource({ providerName: 'aws', accountId: '123456789012' })];
  const settings = { catalog_name: 'finops', gold_schema_name: 'gold' };
  const range = { start: '2025-01-01T00:00:00Z', end: '2025-02-01T00:00:00Z' };

  for (const buildStatement of [buildOverviewServicesStatement, buildOverviewSkusStatement]) {
    const statement = buildStatement(sources, settings, range);

    assert.ok(statement);
    assert.deepEqual(
      statement.params.map((param) => param.name),
      ['start_ts', 'end_ts', 'data_source_id_0', 'provider_name_0', 'account_id_0'],
    );
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
