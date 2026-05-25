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
  type DataSource,
  type Env,
} from '@finlake/shared';
import { dataSourcesRouter } from '../src/routes/dataSources.js';

interface Harness {
  db: SqliteClient;
  base: string;
  close: () => Promise<void>;
}

async function startServer(): Promise<Harness> {
  const db = await SqliteClient.create({ sqlitePath: ':memory:' });
  const env: Env = EnvSchema.parse({});
  const app = express();
  app.use(express.json());
  app.use('/api/integrations', dataSourcesRouter(db, env));
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
  const env = await startServer();
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

test('POST /configurations creates distinct custom rows for the same pipeline', async () => {
  const env = await startServer();
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
    assert.equal(body.accountId, 'ABCDEF_123456_ABCDEF');
    assert.equal(body.config.sourceCatalog, 'gcp_foreign');
    assert.equal(body.config.sourceSchema, 'billing_export');
    assert.equal(body.config.sourceTable, 'gcp_billing_export_resource_v1_ABCDEF_123456_ABCDEF');
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
