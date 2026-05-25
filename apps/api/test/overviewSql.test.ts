import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCoverageSql, buildDailySql, rangeParams, usageRollupRowsSql } from '@finlake/shared';

test('rangeParams includes only the time range', () => {
  const range = { start: '2025-01-01T00:00:00Z', end: '2025-02-01T00:00:00Z' };
  const params = rangeParams(range);

  const names = params.map((p) => p.name);
  assert.deepEqual(names, ['start_ts', 'end_ts']);
});

test('usageRollupRowsSql directly reads the rollup table', () => {
  const sql = usageRollupRowsSql('`catalog`.`gold`.`usage_daily`', 'usage_daily');

  assert.ok(sql.includes('matched AS'));
  assert.ok(sql.includes('`catalog`.`gold`.`usage_daily`'));
  assert.ok(sql.includes("'usage_daily' AS data_source_id"));
  assert.ok(!sql.includes('JOIN requested'));
  assert.ok(!sql.includes('BillingAccountId = r.account_id'));
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

test('buildCoverageSql filters by per-provider latest billing month', () => {
  const sql = buildCoverageSql('-- cte --');

  assert.ok(sql.includes('-- cte --'));
  assert.ok(sql.includes('resources AS'));
  assert.ok(sql.includes('latest_month_per_provider AS'));
  assert.match(sql, /GROUP BY 1, 2, 3, 5, 6, 7\s*\)\s*, latest_month_per_provider AS/);
  assert.ok(sql.includes('GROUP BY provider_name'));
  assert.ok(sql.includes('JOIN latest_month_per_provider'));
  assert.ok(sql.includes('r.provider_name = lm.provider_name'));
  assert.ok(sql.includes('r.x_BillingMonth = lm.max_month'));
  assert.ok(
    !sql.includes('WHERE r.x_BillingMonth = (SELECT MAX(x_BillingMonth) FROM resources)'),
    'cross-provider MAX would drop providers whose latest month lags behind',
  );
});
