import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { settingsToRecord, SqliteClient } from '@finlake/db';
import {
  CATALOG_SETTING_KEY,
  CATALOG_USER_GROUP_SETTING_KEY,
  EnvSchema,
  MEDALLION_SCHEMA_SETTING_KEYS,
  type Env,
} from '@finlake/shared';
import { appSettingsRouter } from '../src/routes/settings.js';

interface Harness {
  db: SqliteClient;
  base: string;
  close: () => Promise<void>;
}

async function startServer(env: Env = EnvSchema.parse({})): Promise<Harness> {
  const db = await SqliteClient.create({ sqlitePath: ':memory:' });
  const app = express();
  app.use(express.json());
  app.use('/api/app-settings', appSettingsRouter(db, env));
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

test('PUT /app-settings does not persist catalog settings when provisioning fails', async () => {
  const env = await startServer();
  try {
    const res = await fetch(`${env.base}/api/app-settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        settings: {
          [CATALOG_SETTING_KEY]: 'finops',
          [CATALOG_USER_GROUP_SETTING_KEY]: 'account users',
          [MEDALLION_SCHEMA_SETTING_KEYS.bronze]: 'ingest',
          [MEDALLION_SCHEMA_SETTING_KEYS.silver]: 'focus',
          [MEDALLION_SCHEMA_SETTING_KEYS.gold]: 'analytics',
        },
        provision: { createIfMissing: false },
      }),
    });

    assert.equal(res.status, 400);
    const settings = settingsToRecord(await env.db.repos.appSettings.list());
    assert.deepEqual(settings, {});
  } finally {
    await env.close();
  }
});
