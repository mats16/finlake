import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import type { DatabaseClient, WorkspacesRepo, WorkspaceValue } from '@finlake/db';
import { workspacesRouter } from '../src/routes/workspaces.js';

async function startServer() {
  const workspaces = new MemoryWorkspacesRepo();
  const db = { repos: { workspaces } } as DatabaseClient;
  const app = express();
  app.use(express.json());
  app.use('/api/workspaces', workspacesRouter(db));
  const server: Server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

class MemoryWorkspacesRepo implements WorkspacesRepo {
  private rows = new Map<string, WorkspaceValue>();

  async get(id: string): Promise<WorkspaceValue | null> {
    return this.rows.get(id) ?? null;
  }

  async upsert(id: string, domain: string): Promise<WorkspaceValue> {
    const row = { id, domain, updatedAt: new Date().toISOString() };
    this.rows.set(id, row);
    return row;
  }

  async clear(): Promise<number> {
    const count = this.rows.size;
    this.rows.clear();
    return count;
  }
}

test('PUT /api/workspaces/:id stores and returns a workspace domain', async () => {
  const server = await startServer();
  try {
    const saved = await fetch(`${server.base}/api/workspaces/123`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: 'target.cloud.databricks.com' }),
    });
    assert.equal(saved.status, 200);
    assert.equal(
      ((await saved.json()) as { domain: string }).domain,
      'target.cloud.databricks.com',
    );

    const loaded = await fetch(`${server.base}/api/workspaces/123`);
    assert.equal(loaded.status, 200);
    assert.equal(
      ((await loaded.json()) as { domain: string }).domain,
      'target.cloud.databricks.com',
    );
  } finally {
    await server.close();
  }
});

test('PUT /api/workspaces/:id stores only the domain from pasted workspace URLs', async () => {
  const server = await startServer();
  try {
    const saved = await fetch(`${server.base}/api/workspaces/123`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        domain: 'https://target.cloud.databricks.com/sql/warehouses/abc/monitoring?o=123',
      }),
    });
    assert.equal(saved.status, 200);
    assert.equal(
      ((await saved.json()) as { domain: string }).domain,
      'target.cloud.databricks.com',
    );
  } finally {
    await server.close();
  }
});

test('GET /api/workspaces/:id returns 404 when workspace mapping is missing', async () => {
  const server = await startServer();
  try {
    const res = await fetch(`${server.base}/api/workspaces/123`);
    assert.equal(res.status, 404);
  } finally {
    await server.close();
  }
});
