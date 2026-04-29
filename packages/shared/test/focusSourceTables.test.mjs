import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCOUNT_PRICES_DEFAULT,
  focusSourceTables,
  parseThreePartTableName,
} from '../dist/sql/focusView.sql.js';

test('focusSourceTables includes FOCUS system table dependencies once', () => {
  const tables = focusSourceTables(ACCOUNT_PRICES_DEFAULT).map((t) => t.fqn);
  assert.deepEqual(tables, [
    'system.billing.usage',
    'system.billing.list_prices',
    'system.access.workspaces_latest',
    'system.lakeflow.pipelines',
    'system.compute.clusters',
    'system.compute.warehouses',
  ]);
});

test('focusSourceTables appends a custom account prices table', () => {
  const tables = focusSourceTables('finops.silver.account_prices').map((t) => t.fqn);
  assert.equal(tables.at(-1), 'finops.silver.account_prices');
  assert.equal(new Set(tables).size, tables.length);
});

test('parseThreePartTableName rejects incomplete source table names', () => {
  assert.throws(() => parseThreePartTableName('list_prices'), /three-part table name/);
});
