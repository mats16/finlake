import assert from 'node:assert/strict';
import test from 'node:test';

import type { Env } from '@finlake/shared';
import {
  filterSelectableCatalogs,
  isTaggableDeltaTable,
  provisionCatalogWithDeps,
} from '../src/services/catalogs.js';
import type { StatementExecutor } from '../src/services/statementExecution.js';
import { isNotFound, isPermissionDenied } from '../src/services/workspaceClientErrors.js';

class FakeExecutor {
  readonly sql: string[] = [];

  async run(sqlText: string): Promise<unknown[]> {
    this.sql.push(sqlText);
    return [];
  }
}

const env = {
  DATABRICKS_CLIENT_ID: 'sp-123',
} as Env;

test('filterSelectableCatalogs keeps foreign catalog entries for source pickers', () => {
  const catalogs = filterSelectableCatalogs([
    {
      name: 'gcp_bigquery_catalog',
      catalog_type: 'FOREIGN_CATALOG',
      comment: 'Google Cloud BigQuery',
    },
    { name: 'system', catalog_type: 'SYSTEM_CATALOG' },
  ]);

  assert.deepEqual(catalogs, [
    {
      name: 'gcp_bigquery_catalog',
      catalogType: 'FOREIGN_CATALOG',
      comment: 'Google Cloud BigQuery',
    },
  ]);
});

test('tag lookup candidates are Delta tables, not views or non-Delta tables', () => {
  const table = {
    name: 'gcp_billing_demo',
    fullName: 'finops.ingest.gcp_billing_demo',
    catalogName: 'finops',
    schemaName: 'ingest',
    tableType: 'STREAMING_TABLE',
    dataSourceFormat: 'DELTA',
    comment: null,
    tags: {},
  };
  assert.equal(isTaggableDeltaTable(table), true);
  assert.equal(isTaggableDeltaTable({ ...table, tableType: 'VIEW' }), false);
  assert.equal(isTaggableDeltaTable({ ...table, dataSourceFormat: 'JSON' }), false);
});

test('missing entity tag assignment is treated as tag absence', () => {
  assert.equal(isNotFound({ errorCode: 'NOT_FOUND' }), true);
  assert.equal(isNotFound({ errorCode: 'PERMISSION_DENIED' }), false);
  assert.equal(isPermissionDenied({ statusCode: 403 }), true);
  assert.equal(isPermissionDenied({ errorCode: 'INSUFFICIENT_PERMISSIONS' }), true);
  assert.equal(
    isPermissionDenied(new Error('[INSUFFICIENT_PERMISSIONS] Insufficient privileges. SQLSTATE: 42501')),
    true,
  );
  assert.equal(isPermissionDenied({ errorCode: 'NOT_FOUND' }), false);
});

test('provisionCatalog creates pricing schema, downloads volume, and grants', async () => {
  const executor = new FakeExecutor();
  const result = await provisionCatalogWithDeps(
    env,
    'finops',
    {},
    {
      executor: executor as unknown as StatementExecutor,
    },
  );

  assert.equal(result.pricingSchemaEnsured, 'ensured');
  assert.equal(result.downloadsVolumeEnsured, 'ensured');
  assert.equal(result.grants.pricingSchema, 'granted');
  assert.equal(result.grants.downloadsVolume, 'granted');
  assert.equal(result.grants.usersDownloadsVolume, 'granted');

  assert.ok(executor.sql.includes('CREATE SCHEMA IF NOT EXISTS `finops`.`pricing`'));
  assert.ok(executor.sql.includes('CREATE VOLUME IF NOT EXISTS `finops`.`ingest`.`downloads`'));
  assert.ok(
    executor.sql.includes(
      'GRANT USE SCHEMA, SELECT, CREATE TABLE ON SCHEMA `finops`.`pricing` TO `sp-123`',
    ),
  );
  assert.ok(
    executor.sql.includes(
      'GRANT USE SCHEMA, SELECT, CREATE TABLE, CREATE VOLUME, READ VOLUME, WRITE VOLUME ON SCHEMA `finops`.`ingest` TO `sp-123`',
    ),
  );
  assert.ok(
    executor.sql.includes(
      'GRANT READ VOLUME, WRITE VOLUME ON VOLUME `finops`.`ingest`.`downloads` TO `sp-123`',
    ),
  );
  assert.ok(
    executor.sql.includes(
      'GRANT READ VOLUME ON VOLUME `finops`.`ingest`.`downloads` TO `account users`',
    ),
  );
});
