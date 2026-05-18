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

  async list(): Promise<WorkspaceValue[]> {
    return Array.from(this.rows.values()).sort((a, b) => a.id.localeCompare(b.id));
  }

  async upsert(id: string, domain: string): Promise<WorkspaceValue> {
    const row = { id, domain, updatedAt: new Date().toISOString() };
    this.rows.set(id, row);
    return row;
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
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

test('PUT /api/workspaces/:id stores Azure Databricks workspace domains', async () => {
  const server = await startServer();
  try {
    const saved = await fetch(`${server.base}/api/workspaces/123`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: 'adb-5555555555555555.19.azuredatabricks.net' }),
    });
    assert.equal(saved.status, 200);
    assert.equal(
      ((await saved.json()) as { domain: string }).domain,
      'adb-5555555555555555.19.azuredatabricks.net',
    );
  } finally {
    await server.close();
  }
});

test('PUT /api/workspaces/:id rejects non-Databricks lookalike domains', async () => {
  const server = await startServer();
  try {
    const saved = await fetch(`${server.base}/api/workspaces/123`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: 'evil-databricks.com' }),
    });
    assert.equal(saved.status, 400);
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

test('GET /api/workspaces lists stored workspace mappings', async () => {
  const server = await startServer();
  try {
    await fetch(`${server.base}/api/workspaces/456`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: 'b.cloud.databricks.com' }),
    });
    await fetch(`${server.base}/api/workspaces/123`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: 'a.cloud.databricks.com' }),
    });

    const res = await fetch(`${server.base}/api/workspaces`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { workspaces: WorkspaceValue[] };
    assert.deepEqual(
      body.workspaces.map((row) => [row.id, row.domain]),
      [
        ['123', 'a.cloud.databricks.com'],
        ['456', 'b.cloud.databricks.com'],
      ],
    );
  } finally {
    await server.close();
  }
});

test('DELETE /api/workspaces/:id removes a workspace mapping', async () => {
  const server = await startServer();
  try {
    await fetch(`${server.base}/api/workspaces/123`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: 'target.cloud.databricks.com' }),
    });

    const deleted = await fetch(`${server.base}/api/workspaces/123`, { method: 'DELETE' });
    assert.equal(deleted.status, 204);

    const loaded = await fetch(`${server.base}/api/workspaces/123`);
    assert.equal(loaded.status, 404);
  } finally {
    await server.close();
  }
});
