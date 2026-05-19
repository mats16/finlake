import assert from 'node:assert/strict';
import test from 'node:test';
import type { DatabaseClient } from '../src/DatabaseClient.js';
import { LakebaseClient } from '../src/LakebaseClient.js';
import { createDatabaseClient, SqliteClient } from '../src/index.js';

function env(overrides: Record<string, unknown> = {}) {
  return {
    NODE_ENV: 'test' as const,
    PORT: 8080,
    SQLITE_PATH: ':memory:',
    SQL_API_CACHE_TTL_SEC: 300,
    SQL_API_STATEMENT_TTL_SEC: 900,
    SQL_API_SUBMIT_RATE_LIMIT_PER_MINUTE: 60,
    MIGRATE_ON_BOOT: false,
    LOG_LEVEL: 'info' as const,
    ...overrides,
  };
}

test('uses SQLite when LAKEBASE_ENDPOINT is not set', async () => {
  const db = await createDatabaseClient(env());
  try {
    assert.ok(db instanceof SqliteClient);
    assert.equal(db.backend, 'sqlite');
  } finally {
    await db.close();
  }
});

test('uses SQLite when PGHOST is set without LAKEBASE_ENDPOINT', async () => {
  const db = await createDatabaseClient(env({ PGHOST: 'lakebase.example.databricks.com' }));
  try {
    assert.ok(db instanceof SqliteClient);
    assert.equal(db.backend, 'sqlite');
  } finally {
    await db.close();
  }
});

test('attempts Lakebase when LAKEBASE_ENDPOINT is set', async () => {
  const originalCreate = LakebaseClient.create;
  let createCalls = 0;
  let healthCalls = 0;
  const fakeDb = {
    backend: 'lakebase',
    repos: {},
    healthCheck: async () => {
      healthCalls += 1;
      return { ok: true, backend: 'lakebase' as const };
    },
    migrate: async () => {},
    close: async () => {},
  } as unknown as DatabaseClient;

  LakebaseClient.create = async () => {
    createCalls += 1;
    return fakeDb as LakebaseClient;
  };

  try {
    const db = await createDatabaseClient(
      env({ LAKEBASE_ENDPOINT: 'projects/p/branches/b/endpoints/e' }),
    );
    assert.equal(db, fakeDb);
    assert.equal(createCalls, 1);
    assert.equal(healthCalls, 1);
  } finally {
    LakebaseClient.create = originalCreate;
  }
});

test('propagates Lakebase initialization failures when LAKEBASE_ENDPOINT is set', async () => {
  const originalCreate = LakebaseClient.create;
  LakebaseClient.create = async () => {
    throw new Error('lakebase unavailable');
  };

  try {
    await assert.rejects(
      createDatabaseClient(env({ LAKEBASE_ENDPOINT: 'projects/p/branches/b/endpoints/e' })),
      /lakebase unavailable/,
    );
  } finally {
    LakebaseClient.create = originalCreate;
  }
});

test('propagates Lakebase health check failures when LAKEBASE_ENDPOINT is set', async () => {
  const originalCreate = LakebaseClient.create;
  const fakeDb = {
    backend: 'lakebase',
    repos: {},
    healthCheck: async () => {
      throw new Error('lakebase unhealthy');
    },
    migrate: async () => {},
    close: async () => {},
  } as unknown as DatabaseClient;

  LakebaseClient.create = async () => fakeDb as LakebaseClient;

  try {
    await assert.rejects(
      createDatabaseClient(env({ LAKEBASE_ENDPOINT: 'projects/p/branches/b/endpoints/e' })),
      /lakebase unhealthy/,
    );
  } finally {
    LakebaseClient.create = originalCreate;
  }
});
