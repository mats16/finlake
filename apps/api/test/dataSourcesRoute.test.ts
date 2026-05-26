import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { SqliteClient } from '@finlake/db';
import {
  DEFAULT_DATABRICKS_ACCOUNT_ID,
  EnvSchema,
  PROVIDER_AWS,
  PROVIDER_CUSTOM,
  PROVIDER_DATABRICKS,
  PROVIDER_GCP,
  PROVIDER_SNOWFLAKE,
  snowflakeSourceIdFromParts,
  type DataSource,
  type Env,
} from '@finlake/shared';
import { errorHandler } from '../src/middlewares/error.js';
import { oboMiddleware } from '../src/middlewares/obo.js';
import { dataSourcesRouter, type DataSourcesRouterDeps } from '../src/routes/dataSources.js';
import { PipelineRunPermissionError } from '../src/services/pipelinePermissions.js';

interface Harness {
  db: SqliteClient;
  base: string;
  close: () => Promise<void>;
}

async function startServer(deps: DataSourcesRouterDeps = {}): Promise<Harness> {
  const db = await SqliteClient.create({ sqlitePath: ':memory:' });
  const env: Env = EnvSchema.parse({});
  const app = express();
  app.use(express.json());
  app.use(oboMiddleware);
  app.use(
    '/api/integrations',
    dataSourcesRouter(db, env, {
      assertPipelineCanRun: async (pipelineId) => {
        throw new Error(`Unexpected pipeline permission check in route test: ${pipelineId}`);
      },
      syncSharedPipeline: async () => {},
      ...deps,
    }),
  );
  app.use(errorHandler);
  const server: Server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    db,
    base: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await db.close();
    },
  };
}

async function getJson<T = unknown>(
  base: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${base}${path}`, { headers });
  const parsed = (await res.json().catch(() => null)) as T;
  return { status: res.status, body: parsed };
}

async function postJson<T = unknown>(
  base: string,
  path: string,
  body: unknown,
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json().catch(() => null)) as T;
  return { status: res.status, body: parsed };
}

async function patchJson<T = unknown>(
  base: string,
  path: string,
  body: unknown,
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${base}${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json().catch(() => null)) as T;
  return { status: res.status, body: parsed };
}

test('GET /custom-options requires app service principal credentials even with OBO token', async () => {
  const env = await startServer();
  try {
    const { status, body } = await getJson<{ error: { message: string } }>(
      env.base,
      '/api/integrations/custom-options',
      { 'x-forwarded-access-token': 'user-token' },
    );
    assert.equal(status, 401);
    assert.equal(
      body.error.message,
      'DATABRICKS_HOST and app service principal credentials are required to list custom data source resources. Grant the app service principal access to source tables and CAN_RUN on selected pipelines.',
    );
  } finally {
    await env.close();
  }
});

test('POST /configurations rejects AWS without accountId', async () => {
  const env = await startServer();
  try {
    const { status, body } = await postJson<{ error: { message: string } }>(
      env.base,
      '/api/integrations/configurations',
      {
        templateId: 'aws',
        name: 'AWS',
        providerName: 'AWS',
        tableName: 'aws_usage',
      },
    );
    assert.equal(status, 400);
    assert.equal(body.error.message, 'accountId is required');
  } finally {
    await env.close();
  }
});

test('POST /configurations defaults Databricks accountId to "default"', async () => {
  const env = await startServer();
  try {
    const { status, body } = await postJson<DataSource>(
      env.base,
      '/api/integrations/configurations',
      {
        templateId: 'databricks_focus13',
        name: 'Databricks',
        providerName: 'Databricks',
        tableName: 'databricks_usage',
      },
    );
    assert.equal(status, 201);
    assert.equal(body.providerName, PROVIDER_DATABRICKS);
    assert.equal(body.accountId, DEFAULT_DATABRICKS_ACCOUNT_ID);
  } finally {
    await env.close();
  }
});

test('POST /configurations creates AWS row with composite PK reflected', async () => {
  const env = await startServer();
  try {
    const { status, body } = await postJson<DataSource>(
      env.base,
      '/api/integrations/configurations',
      {
        templateId: 'aws',
        name: 'AWS prod',
        providerName: 'AWS',
        accountId: '123456789012',
        tableName: 'aws_usage',
      },
    );
    assert.equal(status, 201);
    assert.equal(body.providerName, PROVIDER_AWS);
    assert.equal(body.accountId, '123456789012');
    assert.equal(body.pipelineId, null);

    const stored = await env.db.repos.dataSources.get({
      providerName: PROVIDER_AWS,
      accountId: '123456789012',
    });
    assert.ok(stored, 'row should be retrievable via composite PK');
    assert.equal(stored.name, 'AWS prod');
    assert.equal(stored.pipelineId, null);
  } finally {
    await env.close();
  }
});

test('POST /configurations creates custom row with external pipeline id and qualified table', async () => {
  let syncCalls = 0;
  const env = await startServer({
    assertPipelineCanRun: async () => {},
    syncSharedPipeline: async () => {
      syncCalls += 1;
    },
  });
  try {
    const { status, body } = await postJson<DataSource>(
      env.base,
      '/api/integrations/configurations',
      {
        templateId: 'custom',
        name: 'Custom feed',
        providerName: 'custom',
        tableName: 'custom_schema.custom_usage',
        pipelineId: 'pipeline-123',
        enabled: true,
      },
    );
    assert.equal(status, 201);
    assert.equal(body.providerName, PROVIDER_CUSTOM);
    assert.match(body.accountId, /^custom_[0-9a-f-]{36}$/);
    assert.equal(body.tableName, 'custom_schema.custom_usage');
    assert.equal(body.pipelineId, 'pipeline-123');
    assert.equal(body.enabled, true);
    assert.equal(syncCalls, 1);
  } finally {
    await env.close();
  }
});

test('POST /configurations rejects custom row when app service principal cannot run the pipeline', async () => {
  const calls: string[] = [];
  const env = await startServer({
    assertPipelineCanRun: async (pipelineId) => {
      calls.push(pipelineId);
      throw new PipelineRunPermissionError('App service principal is missing CAN_RUN', 403);
    },
  });
  try {
    const { status, body } = await postJson<{ error: { message: string } }>(
      env.base,
      '/api/integrations/configurations',
      {
        templateId: 'custom',
        name: 'Custom feed',
        providerName: 'custom',
        tableName: 'custom_usage',
        pipelineId: 'pipeline-123',
        enabled: true,
      },
    );
    assert.equal(status, 403);
    assert.equal(body.error.message, 'App service principal is missing CAN_RUN');
    assert.deepEqual(calls, ['pipeline-123']);
    assert.deepEqual(await env.db.repos.dataSources.list(), []);
  } finally {
    await env.close();
  }
});

test('POST /configurations saves disabled custom draft without checking pipeline permission', async () => {
  const env = await startServer({
    assertPipelineCanRun: async () => {
      throw new PipelineRunPermissionError('App service principal is missing CAN_RUN', 403);
    },
  });
  try {
    const { status, body } = await postJson<DataSource>(
      env.base,
      '/api/integrations/configurations',
      {
        templateId: 'custom',
        name: 'Custom feed',
        providerName: 'custom',
        tableName: 'custom_usage',
        pipelineId: 'pipeline-123',
      },
    );
    assert.equal(status, 201);
    assert.equal(body.enabled, false);
    assert.equal(body.pipelineId, 'pipeline-123');
  } finally {
    await env.close();
  }
});

test('POST /configurations creates custom row without pipelineId', async () => {
  const env = await startServer();
  try {
    const { status, body } = await postJson<DataSource>(
      env.base,
      '/api/integrations/configurations',
      {
        templateId: 'custom',
        name: 'Custom feed',
        providerName: 'custom',
        tableName: 'custom_usage',
      },
    );
    assert.equal(status, 201);
    assert.equal(body.providerName, PROVIDER_CUSTOM);
    assert.match(body.accountId, /^custom_[0-9a-f-]{36}$/);
    assert.equal(body.pipelineId, null);
  } finally {
    await env.close();
  }
});

test('POST /configurations rejects enabled custom row without pipelineId', async () => {
  const env = await startServer();
  try {
    const { status, body } = await postJson<{ error: { message: string } }>(
      env.base,
      '/api/integrations/configurations',
      {
        templateId: 'custom',
        name: 'Custom feed',
        providerName: 'custom',
        tableName: 'custom_usage',
        enabled: true,
      },
    );
    assert.equal(status, 409);
    assert.match(body.error.message, /cannot be enabled without a pipelineId/);
    assert.deepEqual(await env.db.repos.dataSources.list(), []);
  } finally {
    await env.close();
  }
});

test('POST /configurations rejects whitespace-only custom pipelineId', async () => {
  const env = await startServer({ assertPipelineCanRun: async () => {} });
  try {
    const { status, body } = await postJson<{ error: { message: string } }>(
      env.base,
      '/api/integrations/configurations',
      {
        templateId: 'custom',
        name: 'Custom feed',
        providerName: 'custom',
        tableName: 'custom_usage',
        pipelineId: '   ',
      },
    );
    assert.equal(status, 400);
    assert.equal(body.error.message, 'Invalid input');
  } finally {
    await env.close();
  }
});

test('POST /configurations creates distinct custom rows for the same pipeline', async () => {
  const env = await startServer({ assertPipelineCanRun: async () => {} });
  try {
    const first = await postJson<DataSource>(env.base, '/api/integrations/configurations', {
      templateId: 'custom',
      name: 'Custom feed A',
      providerName: 'custom',
      accountId: 'pipeline-123',
      tableName: 'custom_usage',
      pipelineId: 'pipeline-123',
    });
    const second = await postJson<DataSource>(env.base, '/api/integrations/configurations', {
      templateId: 'custom',
      name: 'Custom feed B',
      providerName: 'custom',
      accountId: 'pipeline-123',
      tableName: 'custom_usage_2',
      pipelineId: 'pipeline-123',
    });

    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.notEqual(first.body.accountId, second.body.accountId);
    assert.equal(first.body.pipelineId, 'pipeline-123');
    assert.equal(second.body.pipelineId, 'pipeline-123');
  } finally {
    await env.close();
  }
});

test('PATCH /configurations saves disabled custom pipeline id without permission check', async () => {
  const env = await startServer({
    assertPipelineCanRun: async () => {
      throw new PipelineRunPermissionError('App service principal is missing CAN_RUN', 403);
    },
  });
  try {
    const created = await postJson<DataSource>(env.base, '/api/integrations/configurations', {
      templateId: 'custom',
      name: 'Custom feed',
      providerName: 'custom',
      tableName: 'custom_usage',
    });
    assert.equal(created.status, 201);

    const { status, body } = await patchJson<DataSource>(
      env.base,
      `/api/integrations/configurations/custom/${encodeURIComponent(created.body.accountId)}`,
      { pipelineId: 'pipeline-123' },
    );
    assert.equal(status, 200);
    assert.equal(body.pipelineId, 'pipeline-123');

    const stored = await env.db.repos.dataSources.get({
      providerName: PROVIDER_CUSTOM,
      accountId: created.body.accountId,
    });
    assert.equal(stored?.pipelineId, 'pipeline-123');
  } finally {
    await env.close();
  }
});

test('PATCH /configurations syncs the shared pipeline when enabling a custom data source', async () => {
  const permissionChecks: string[] = [];
  let syncCalls = 0;
  const env = await startServer({
    assertPipelineCanRun: async (pipelineId) => {
      permissionChecks.push(pipelineId);
    },
    syncSharedPipeline: async () => {
      syncCalls += 1;
    },
  });
  try {
    const created = await postJson<DataSource>(env.base, '/api/integrations/configurations', {
      templateId: 'custom',
      name: 'Custom feed',
      providerName: 'custom',
      tableName: 'custom_usage',
      pipelineId: 'pipeline-123',
    });
    assert.equal(created.status, 201);
    assert.equal(syncCalls, 0);

    const { status, body } = await patchJson<DataSource>(
      env.base,
      `/api/integrations/configurations/custom/${encodeURIComponent(created.body.accountId)}`,
      { enabled: true },
    );
    assert.equal(status, 200);
    assert.equal(body.enabled, true);
    assert.equal(syncCalls, 1);
    assert.deepEqual(permissionChecks, ['pipeline-123']);
  } finally {
    await env.close();
  }
});

test('PATCH /configurations rejects whitespace-only pipelineId', async () => {
  const env = await startServer({ assertPipelineCanRun: async () => {} });
  try {
    const created = await postJson<DataSource>(env.base, '/api/integrations/configurations', {
      templateId: 'custom',
      name: 'Custom feed',
      providerName: 'custom',
      tableName: 'custom_usage',
      pipelineId: 'pipeline-123',
    });
    assert.equal(created.status, 201);

    const { status, body } = await patchJson<{ error: { message: string } }>(
      env.base,
      `/api/integrations/configurations/custom/${encodeURIComponent(created.body.accountId)}`,
      { pipelineId: '   ' },
    );
    assert.equal(status, 400);
    assert.equal(body.error.message, 'Invalid input');

    const stored = await env.db.repos.dataSources.get({
      providerName: PROVIDER_CUSTOM,
      accountId: created.body.accountId,
    });
    assert.equal(stored?.pipelineId, 'pipeline-123');
  } finally {
    await env.close();
  }
});

test('PATCH /configurations rejects clearing pipelineId on an enabled custom source', async () => {
  const env = await startServer({ assertPipelineCanRun: async () => {} });
  try {
    const created = await postJson<DataSource>(env.base, '/api/integrations/configurations', {
      templateId: 'custom',
      name: 'Custom feed',
      providerName: 'custom',
      tableName: 'custom_usage',
      pipelineId: 'pipeline-123',
      enabled: true,
    });
    assert.equal(created.status, 201);

    const { status, body } = await patchJson<{ error: { message: string } }>(
      env.base,
      `/api/integrations/configurations/custom/${encodeURIComponent(created.body.accountId)}`,
      { pipelineId: '   ' },
    );
    assert.equal(status, 400);
    assert.equal(body.error.message, 'Invalid input');

    const stored = await env.db.repos.dataSources.get({
      providerName: PROVIDER_CUSTOM,
      accountId: created.body.accountId,
    });
    assert.equal(stored?.pipelineId, 'pipeline-123');
  } finally {
    await env.close();
  }
});

test('PATCH /configurations skips permission check and sync for unchanged custom pipeline id', async () => {
  const permissionChecks: string[] = [];
  let syncCalls = 0;
  const env = await startServer({
    assertPipelineCanRun: async (pipelineId) => {
      permissionChecks.push(pipelineId);
    },
    syncSharedPipeline: async () => {
      syncCalls += 1;
    },
  });
  try {
    const created = await postJson<DataSource>(env.base, '/api/integrations/configurations', {
      templateId: 'custom',
      name: 'Custom feed',
      providerName: 'custom',
      tableName: 'custom_usage',
      pipelineId: 'pipeline-123',
      enabled: true,
    });
    assert.equal(created.status, 201);
    assert.deepEqual(permissionChecks, ['pipeline-123']);
    assert.equal(syncCalls, 1);

    const { status, body } = await patchJson<DataSource>(
      env.base,
      `/api/integrations/configurations/custom/${encodeURIComponent(created.body.accountId)}`,
      { pipelineId: 'pipeline-123' },
    );
    assert.equal(status, 200);
    assert.equal(body.pipelineId, 'pipeline-123');
    assert.deepEqual(permissionChecks, ['pipeline-123']);
    assert.equal(syncCalls, 1);
  } finally {
    await env.close();
  }
});

test('PATCH /configurations does not revalidate enabled custom source pipeline on name edits', async () => {
  const calls: string[] = [];
  const env = await startServer({
    assertPipelineCanRun: async (pipelineId) => {
      calls.push(pipelineId);
      if (calls.length > 1) {
        throw new PipelineRunPermissionError('App service principal is missing CAN_RUN', 403);
      }
    },
  });
  try {
    const created = await postJson<DataSource>(env.base, '/api/integrations/configurations', {
      templateId: 'custom',
      name: 'Custom feed',
      providerName: 'custom',
      tableName: 'custom_usage',
      pipelineId: 'pipeline-123',
      enabled: true,
    });
    assert.equal(created.status, 201);

    const { status, body } = await patchJson<DataSource>(
      env.base,
      `/api/integrations/configurations/custom/${encodeURIComponent(created.body.accountId)}`,
      { name: 'Renamed feed' },
    );
    assert.equal(status, 200);
    assert.equal(body.name, 'Renamed feed');
    assert.deepEqual(calls, ['pipeline-123']);

    const stored = await env.db.repos.dataSources.get({
      providerName: PROVIDER_CUSTOM,
      accountId: created.body.accountId,
    });
    assert.equal(stored?.name, 'Renamed feed');
  } finally {
    await env.close();
  }
});

test('PATCH /configurations syncs enabled custom source table edits without revalidating pipeline', async () => {
  const calls: string[] = [];
  let syncCalls = 0;
  const env = await startServer({
    assertPipelineCanRun: async (pipelineId) => {
      calls.push(pipelineId);
      if (calls.length > 1) {
        throw new PipelineRunPermissionError('App service principal is missing CAN_RUN', 403);
      }
    },
    syncSharedPipeline: async () => {
      syncCalls += 1;
    },
  });
  try {
    const created = await postJson<DataSource>(env.base, '/api/integrations/configurations', {
      templateId: 'custom',
      name: 'Custom feed',
      providerName: 'custom',
      tableName: 'custom_usage',
      pipelineId: 'pipeline-123',
      enabled: true,
    });
    assert.equal(created.status, 201);

    assert.equal(syncCalls, 1);

    const { status, body } = await patchJson<DataSource>(
      env.base,
      `/api/integrations/configurations/custom/${encodeURIComponent(created.body.accountId)}`,
      { tableName: 'custom_usage_v2' },
    );
    assert.equal(status, 200);
    assert.equal(body.tableName, 'custom_usage_v2');
    assert.deepEqual(calls, ['pipeline-123']);
    assert.equal(syncCalls, 2);

    const stored = await env.db.repos.dataSources.get({
      providerName: PROVIDER_CUSTOM,
      accountId: created.body.accountId,
    });
    assert.equal(stored?.tableName, 'custom_usage_v2');
  } finally {
    await env.close();
  }
});

test('PATCH /configurations skips permission check and sync for custom config-only edits', async () => {
  const permissionChecks: string[] = [];
  let syncCalls = 0;
  const env = await startServer({
    assertPipelineCanRun: async (pipelineId) => {
      permissionChecks.push(pipelineId);
    },
    syncSharedPipeline: async () => {
      syncCalls += 1;
    },
  });
  try {
    const created = await postJson<DataSource>(env.base, '/api/integrations/configurations', {
      templateId: 'custom',
      name: 'Custom feed',
      providerName: 'custom',
      tableName: 'custom_usage',
      pipelineId: 'pipeline-123',
      enabled: true,
      config: { owner: 'finance' },
    });
    assert.equal(created.status, 201);
    assert.deepEqual(permissionChecks, ['pipeline-123']);
    assert.equal(syncCalls, 1);

    const { status, body } = await patchJson<DataSource>(
      env.base,
      `/api/integrations/configurations/custom/${encodeURIComponent(created.body.accountId)}`,
      { config: { owner: 'platform' } },
    );
    assert.equal(status, 200);
    assert.deepEqual(body.config, { owner: 'platform' });
    assert.deepEqual(permissionChecks, ['pipeline-123']);
    assert.equal(syncCalls, 1);
  } finally {
    await env.close();
  }
});

test('POST /configurations removes custom row when shared pipeline sync fails', async () => {
  const env = await startServer({
    assertPipelineCanRun: async () => {},
    syncSharedPipeline: async () => {
      throw new Error('sync failed');
    },
  });
  try {
    const { status, body } = await postJson<{ error: { message: string } }>(
      env.base,
      '/api/integrations/configurations',
      {
        templateId: 'custom',
        name: 'Custom feed',
        providerName: 'custom',
        tableName: 'custom_usage',
        pipelineId: 'pipeline-123',
        enabled: true,
      },
    );
    assert.equal(status, 500);
    assert.equal(body.error.message, 'sync failed');
    assert.deepEqual(await env.db.repos.dataSources.list(), []);
  } finally {
    await env.close();
  }
});

test('PATCH /configurations restores previous row when shared pipeline sync fails', async () => {
  const env = await startServer({
    assertPipelineCanRun: async () => {},
    syncSharedPipeline: async () => {
      throw new Error('sync failed');
    },
  });
  try {
    const created = await postJson<DataSource>(env.base, '/api/integrations/configurations', {
      templateId: 'custom',
      name: 'Custom feed',
      providerName: 'custom',
      tableName: 'custom_usage',
      pipelineId: 'pipeline-123',
    });
    assert.equal(created.status, 201);

    const { status, body } = await patchJson<{ error: { message: string } }>(
      env.base,
      `/api/integrations/configurations/custom/${encodeURIComponent(created.body.accountId)}`,
      { enabled: true },
    );
    assert.equal(status, 500);
    assert.equal(body.error.message, 'sync failed');

    const stored = await env.db.repos.dataSources.get({
      providerName: PROVIDER_CUSTOM,
      accountId: created.body.accountId,
    });
    assert.equal(stored?.enabled, false);
  } finally {
    await env.close();
  }
});

test('PATCH /configurations does not partially restore over concurrent updates', async () => {
  let db: SqliteClient | null = null;
  let accountId = '';
  const env = await startServer({
    assertPipelineCanRun: async () => {},
    syncSharedPipeline: async () => {
      if (!db) throw new Error('missing db');
      await db.repos.dataSources.update(
        { providerName: PROVIDER_CUSTOM, accountId },
        { tableName: 'custom_usage_concurrent' },
      );
      throw new Error('sync failed');
    },
  });
  db = env.db;
  try {
    const created = await postJson<DataSource>(env.base, '/api/integrations/configurations', {
      templateId: 'custom',
      name: 'Custom feed',
      providerName: 'custom',
      tableName: 'custom_usage',
      pipelineId: 'pipeline-123',
    });
    assert.equal(created.status, 201);
    accountId = created.body.accountId;

    const { status, body } = await patchJson<{ error: { message: string } }>(
      env.base,
      `/api/integrations/configurations/custom/${encodeURIComponent(accountId)}`,
      { enabled: true, tableName: 'custom_usage_v2' },
    );
    assert.equal(status, 500);
    assert.equal(body.error.message, 'sync failed');

    const stored = await env.db.repos.dataSources.get({
      providerName: PROVIDER_CUSTOM,
      accountId,
    });
    assert.equal(stored?.enabled, true);
    assert.equal(stored?.tableName, 'custom_usage_concurrent');
  } finally {
    await env.close();
  }
});

test('PATCH /configurations syncs managed source disable while another source remains enabled', async () => {
  let syncCalls = 0;
  const env = await startServer({
    syncSharedPipeline: async () => {
      syncCalls += 1;
    },
  });
  try {
    const databricks = await postJson<DataSource>(env.base, '/api/integrations/configurations', {
      templateId: 'databricks_focus13',
      name: 'Databricks',
      providerName: 'databricks',
      tableName: 'databricks_usage',
      enabled: true,
    });
    const aws = await postJson<DataSource>(env.base, '/api/integrations/configurations', {
      templateId: 'aws',
      name: 'AWS',
      providerName: 'aws',
      accountId: '123456789012',
      tableName: 'aws_usage',
      enabled: true,
    });
    assert.equal(databricks.status, 201);
    assert.equal(aws.status, 201);
    assert.equal(syncCalls, 2);

    const { status, body } = await patchJson<DataSource>(
      env.base,
      '/api/integrations/configurations/aws/123456789012',
      { enabled: false },
    );
    assert.equal(status, 200);
    assert.equal(body.enabled, false);
    assert.equal(syncCalls, 3);
  } finally {
    await env.close();
  }
});

test('PATCH /configurations cleans up shared pipeline when disabling the last enabled source', async () => {
  let syncCalls = 0;
  let cleanupCalls = 0;
  const env = await startServer({
    syncSharedPipeline: async () => {
      syncCalls += 1;
    },
    cleanupSharedPipeline: async () => {
      cleanupCalls += 1;
    },
  });
  try {
    const created = await postJson<DataSource>(env.base, '/api/integrations/configurations', {
      templateId: 'databricks_focus13',
      name: 'Databricks',
      providerName: 'databricks',
      tableName: 'databricks_usage',
      enabled: true,
    });
    assert.equal(created.status, 201);
    assert.equal(syncCalls, 1);

    const { status, body } = await patchJson<DataSource>(
      env.base,
      '/api/integrations/configurations/databricks/default',
      { enabled: false },
    );
    assert.equal(status, 200);
    assert.equal(body.enabled, false);
    assert.equal(syncCalls, 1);
    assert.equal(cleanupCalls, 1);
  } finally {
    await env.close();
  }
});

test('PATCH /configurations syncs enabled managed source pipeline id changes', async () => {
  let syncCalls = 0;
  const env = await startServer({
    syncSharedPipeline: async () => {
      syncCalls += 1;
    },
  });
  try {
    const created = await postJson<DataSource>(env.base, '/api/integrations/configurations', {
      templateId: 'aws',
      name: 'AWS',
      providerName: 'aws',
      accountId: '123456789012',
      tableName: 'aws_usage',
      pipelineId: 'pipeline-old',
      enabled: true,
    });
    assert.equal(created.status, 201);
    assert.equal(syncCalls, 1);

    const { status, body } = await patchJson<DataSource>(
      env.base,
      '/api/integrations/configurations/aws/123456789012',
      { pipelineId: 'pipeline-new' },
    );
    assert.equal(status, 200);
    assert.equal(body.pipelineId, 'pipeline-new');
    assert.equal(syncCalls, 2);
  } finally {
    await env.close();
  }
});

test('PATCH /configurations accepts registered AWS config with equivalent object values', async () => {
  const env = await startServer();
  try {
    const created = await postJson<DataSource>(env.base, '/api/integrations/configurations', {
      templateId: 'aws',
      name: 'AWS',
      providerName: 'aws',
      accountId: '123456789012',
      tableName: 'aws_usage',
      config: {
        awsAccountId: '123456789012',
        externalLocationName: 'aws_ext_loc',
        externalLocationUrl: 's3://billing/export',
        exportName: 'cur2',
        s3Prefix: 'cur/',
        storageCredentialName: { b: 2, a: 1 },
      },
    });
    assert.equal(created.status, 201);

    const { status, body } = await patchJson<DataSource>(
      env.base,
      '/api/integrations/configurations/aws/123456789012',
      {
        config: {
          awsAccountId: '123456789012',
          externalLocationName: 'aws_ext_loc',
          externalLocationUrl: 's3://billing/export',
          exportName: 'cur2',
          s3Prefix: 'cur/',
          storageCredentialName: { a: 1, b: 2 },
        },
      },
    );
    assert.equal(status, 200);
    assert.deepEqual(body.config.storageCredentialName, { a: 1, b: 2 });
  } finally {
    await env.close();
  }
});

test('PATCH /configurations accepts registered AWS partial config without clearing locked keys', async () => {
  const env = await startServer();
  try {
    const created = await postJson<DataSource>(env.base, '/api/integrations/configurations', {
      templateId: 'aws',
      name: 'AWS',
      providerName: 'aws',
      accountId: '123456789012',
      tableName: 'aws_usage',
      config: {
        awsAccountId: '123456789012',
        externalLocationName: 'aws_ext_loc',
        externalLocationUrl: 's3://billing/export',
        exportName: 'cur2',
        s3Prefix: 'cur/',
        owner: 'finance',
      },
    });
    assert.equal(created.status, 201);

    const { status, body } = await patchJson<DataSource>(
      env.base,
      '/api/integrations/configurations/aws/123456789012',
      { config: { owner: 'platform' } },
    );
    assert.equal(status, 200);
    assert.equal(body.config.awsAccountId, '123456789012');
    assert.equal(body.config.externalLocationName, 'aws_ext_loc');
    assert.equal(body.config.owner, 'platform');
  } finally {
    await env.close();
  }
});

test('DELETE /configurations uses injected shared pipeline sync dependency', async () => {
  let syncCalls = 0;
  const env = await startServer({
    syncSharedPipeline: async () => {
      syncCalls += 1;
    },
  });
  try {
    await postJson<DataSource>(env.base, '/api/integrations/configurations', {
      templateId: 'databricks_focus13',
      name: 'Databricks',
      providerName: 'databricks',
      tableName: 'databricks_usage',
      enabled: true,
    });
    await postJson<DataSource>(env.base, '/api/integrations/configurations', {
      templateId: 'aws',
      name: 'AWS',
      providerName: 'aws',
      accountId: '123456789012',
      tableName: 'aws_usage',
      enabled: true,
    });
    assert.equal(syncCalls, 2);

    const res = await fetch(`${env.base}/api/integrations/configurations/aws/123456789012`, {
      method: 'DELETE',
    });
    assert.equal(res.status, 204);
    assert.equal(syncCalls, 3);
  } finally {
    await env.close();
  }
});

test('DELETE /configurations cleans up shared pipeline when deleting the last enabled source', async () => {
  let syncCalls = 0;
  let cleanupCalls = 0;
  const env = await startServer({
    syncSharedPipeline: async () => {
      syncCalls += 1;
    },
    cleanupSharedPipeline: async () => {
      cleanupCalls += 1;
    },
  });
  try {
    await postJson<DataSource>(env.base, '/api/integrations/configurations', {
      templateId: 'databricks_focus13',
      name: 'Databricks',
      providerName: 'databricks',
      tableName: 'databricks_usage',
      enabled: true,
    });
    assert.equal(syncCalls, 1);

    const res = await fetch(`${env.base}/api/integrations/configurations/databricks/default`, {
      method: 'DELETE',
    });
    assert.equal(res.status, 204);
    assert.equal(syncCalls, 1);
    assert.equal(cleanupCalls, 1);
  } finally {
    await env.close();
  }
});

test('POST /configurations rejects duplicate custom table registrations', async () => {
  const env = await startServer();
  try {
    const first = await postJson<DataSource>(env.base, '/api/integrations/configurations', {
      templateId: 'custom',
      name: 'Custom feed A',
      providerName: 'custom',
      tableName: 'custom_usage',
    });
    const second = await postJson<{ error: { message: string } }>(
      env.base,
      '/api/integrations/configurations',
      {
        templateId: 'custom',
        name: 'Custom feed B',
        providerName: 'custom',
        tableName: 'CUSTOM_USAGE',
      },
    );

    assert.equal(first.status, 201);
    assert.equal(second.status, 409);
    assert.match(second.body.error.message, /already registered/);
  } finally {
    await env.close();
  }
});

test('PATCH /configurations rejects duplicate custom table registrations', async () => {
  const env = await startServer();
  try {
    const first = await postJson<DataSource>(env.base, '/api/integrations/configurations', {
      templateId: 'custom',
      name: 'Custom feed A',
      providerName: 'custom',
      tableName: 'custom_usage_a',
    });
    const second = await postJson<DataSource>(env.base, '/api/integrations/configurations', {
      templateId: 'custom',
      name: 'Custom feed B',
      providerName: 'custom',
      tableName: 'custom_usage_b',
    });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);

    const duplicate = await patchJson<{ error: { message: string } }>(
      env.base,
      `/api/integrations/configurations/custom/${encodeURIComponent(second.body.accountId)}`,
      { tableName: 'CUSTOM_USAGE_A' },
    );

    assert.equal(duplicate.status, 409);
    assert.match(duplicate.body.error.message, /already registered/);
  } finally {
    await env.close();
  }
});

test('POST /configurations creates Google Cloud row with source config reflected', async () => {
  const env = await startServer();
  try {
    const { status, body } = await postJson<DataSource>(
      env.base,
      '/api/integrations/configurations',
      {
        templateId: 'gcp',
        name: 'Google Cloud billing',
        providerName: 'Google Cloud',
        accountId: 'ABCDEF_123456_ABCDEF',
        tableName: 'gcp_abcdef_123456_abcdef_usage',
        config: {
          billingAccountId: 'ABCDEF_123456_ABCDEF',
          sourceCatalog: 'gcp_foreign',
          sourceSchema: 'billing_export',
          sourceTable: 'gcp_billing_export_resource_v1_ABCDEF_123456_ABCDEF',
        },
      },
    );
    assert.equal(status, 201);
    assert.equal(body.providerName, PROVIDER_GCP);
    assert.equal(body.accountId, 'ABCDEF-123456-ABCDEF');
    assert.equal(body.focusVersion, '1.2');
    assert.equal(body.config.billingAccountId, 'ABCDEF-123456-ABCDEF');
    assert.equal(body.config.sourceCatalog, 'gcp_foreign');
    assert.equal(body.config.sourceSchema, 'billing_export');
    assert.equal(body.config.sourceTable, 'gcp_billing_export_resource_v1_ABCDEF_123456_ABCDEF');
  } finally {
    await env.close();
  }
});

test('POST /configurations creates Snowflake row with source config reflected', async () => {
  const env = await startServer();
  try {
    const expectedSourceId = snowflakeSourceIdFromParts(
      'snowflake_foreign',
      'ORGANIZATION_USAGE',
      'USAGE_IN_CURRENCY_DAILY',
    );
    const { status, body } = await postJson<DataSource>(
      env.base,
      '/api/integrations/configurations',
      {
        templateId: 'snowflake',
        name: 'Snowflake usage',
        providerName: 'Snowflake',
        accountId: 'snowflake_source',
        tableName: 'snowflake_usage',
        config: {
          sourceCatalog: 'snowflake_foreign',
          sourceSchema: 'ORGANIZATION_USAGE',
          sourceTable: 'USAGE_IN_CURRENCY_DAILY',
        },
      },
    );
    assert.equal(status, 201);
    assert.equal(body.providerName, PROVIDER_SNOWFLAKE);
    assert.equal(body.accountId, expectedSourceId);
    assert.equal(body.focusVersion, '1.2');
    assert.equal(body.config.sourceCatalog, 'snowflake_foreign');
    assert.equal(body.config.sourceSchema, 'ORGANIZATION_USAGE');
    assert.equal(body.config.sourceTable, 'USAGE_IN_CURRENCY_DAILY');
    assert.equal(
      body.config.sourceFqn,
      'snowflake_foreign.ORGANIZATION_USAGE.USAGE_IN_CURRENCY_DAILY',
    );
    assert.equal(body.config.sourceId, expectedSourceId);
  } finally {
    await env.close();
  }
});

test('POST /configurations rejects Snowflake without organization usage source config', async () => {
  const env = await startServer();
  try {
    const missing = await postJson<DataSource>(env.base, '/api/integrations/configurations', {
      templateId: 'snowflake',
      name: 'Snowflake usage',
      providerName: 'snowflake',
      accountId: 'ignored',
      tableName: 'snowflake_usage',
      config: {},
    });
    assert.equal(missing.status, 400);
    assert.match(
      String((missing.body as { error?: { message?: string } }).error?.message),
      /sourceCatalog, sourceSchema, and sourceTable/,
    );

    const wrongTable = await postJson<DataSource>(env.base, '/api/integrations/configurations', {
      templateId: 'snowflake',
      name: 'Snowflake usage',
      providerName: 'snowflake',
      accountId: 'ignored',
      tableName: 'snowflake_usage',
      config: {
        sourceCatalog: 'snowflake_foreign',
        sourceSchema: 'ACCOUNT_USAGE',
        sourceTable: 'METERING_DAILY_HISTORY',
      },
    });
    assert.equal(wrongTable.status, 400);
    assert.match(
      String((wrongTable.body as { error?: { message?: string } }).error?.message),
      /ORGANIZATION_USAGE\.USAGE_IN_CURRENCY_DAILY/,
    );
  } finally {
    await env.close();
  }
});

test('PATCH /configurations rejects registered Snowflake source key changes', async () => {
  const env = await startServer();
  try {
    const created = await postJson<DataSource>(env.base, '/api/integrations/configurations', {
      templateId: 'snowflake',
      name: 'Snowflake usage',
      providerName: 'snowflake',
      accountId: 'ignored',
      tableName: 'snowflake_usage',
      config: {
        sourceCatalog: 'snowflake_foreign',
        sourceSchema: 'ORGANIZATION_USAGE',
        sourceTable: 'USAGE_IN_CURRENCY_DAILY',
        owner: 'finance',
      },
    });
    assert.equal(created.status, 201);

    const key = `${created.body.providerName}/${created.body.accountId}`;
    const changed = await patchJson<DataSource>(
      env.base,
      `/api/integrations/configurations/${key}`,
      { config: { sourceTable: 'METERING_DAILY_HISTORY' } },
    );
    assert.equal(changed.status, 409);
    assert.match(
      String((changed.body as { error?: { message?: string } }).error?.message),
      /Registered Snowflake source settings cannot be changed: sourceTable/,
    );

    const partial = await patchJson<DataSource>(
      env.base,
      `/api/integrations/configurations/${key}`,
      { config: { owner: 'platform' } },
    );
    assert.equal(partial.status, 200);
    assert.equal(partial.body.config.sourceCatalog, 'snowflake_foreign');
    assert.equal(partial.body.config.sourceTable, 'USAGE_IN_CURRENCY_DAILY');
    assert.equal(partial.body.config.owner, 'platform');
  } finally {
    await env.close();
  }
});

test('GET /configurations/:providerName/:accountId normalizes provider casing', async () => {
  const env = await startServer();
  try {
    await postJson<DataSource>(env.base, '/api/integrations/configurations', {
      templateId: 'databricks_focus13',
      name: 'Databricks',
      providerName: 'Databricks',
      tableName: 'databricks_usage',
    });
    const res = await fetch(`${env.base}/api/integrations/configurations/Databricks/default`);
    assert.equal(res.status, 200);
    const row = (await res.json()) as DataSource;
    assert.equal(row.providerName, PROVIDER_DATABRICKS);
    assert.equal(row.accountId, DEFAULT_DATABRICKS_ACCOUNT_ID);
  } finally {
    await env.close();
  }
});

test('POST /configurations rejects unknown templateId', async () => {
  const env = await startServer();
  try {
    const { status, body } = await postJson<{ error: { message: string } }>(
      env.base,
      '/api/integrations/configurations',
      {
        templateId: 'bogus',
        name: 'X',
        providerName: 'aws',
        accountId: '123456789012',
        tableName: 'aws_usage',
      },
    );
    assert.equal(status, 400);
    assert.equal(body.error.message, 'Invalid templateId');
  } finally {
    await env.close();
  }
});
