import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { SqliteClient } from '@finlake/db';
import type { Env } from '@finlake/shared';
import { genieRouter } from '../src/routes/genie.js';

async function startGenieServer(opts: { accessToken?: string | null } = {}) {
  const db = await SqliteClient.create({ sqlitePath: ':memory:' });
  await db.repos.genieSpaces.upsert('finops', 'space-finops');

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (opts.accessToken !== null) {
      req.user = {
        accessToken: opts.accessToken ?? 'obo-token',
        userId: 'user-1',
        email: 'user-1@example.com',
      };
    } else {
      req.user = {};
    }
    next();
  });
  app.use(
    '/api/genie',
    genieRouter(db, {
      DATABRICKS_HOST: 'https://example.cloud.databricks.com',
    } as Env),
  );

  const server: Server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await db.close();
    },
  };
}

test('POST /api/genie/chat requires an OBO token', async () => {
  const env = await startGenieServer({ accessToken: null });
  try {
    const res = await fetch(`${env.base}/api/genie/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'hello' }),
    });

    assert.equal(res.status, 401);
    const body = (await res.json()) as { error?: { message?: string } };
    assert.equal(body.error?.message, 'Genie requires an OBO access token.');
  } finally {
    await env.close();
  }
});

test('SSE Genie message route requires an OBO token before opening the stream', async () => {
  const env = await startGenieServer({ accessToken: null });
  try {
    const res = await fetch(`${env.base}/api/genie/finops/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'hello' }),
    });

    assert.equal(res.status, 401);
    assert.equal(res.headers.get('content-type')?.includes('application/json'), true);
    const body = (await res.json()) as { error?: { message?: string } };
    assert.equal(body.error?.message, 'Genie requires an OBO access token.');
  } finally {
    await env.close();
  }
});

test('Genie history routes require an OBO token before opening the stream', async () => {
  const env = await startGenieServer({ accessToken: null });
  try {
    const [conversation, message] = await Promise.all([
      fetch(`${env.base}/api/genie/finops/conversations/conversation-1`),
      fetch(`${env.base}/api/genie/finops/conversations/conversation-1/messages/message-1`),
    ]);

    assert.equal(conversation.status, 401);
    assert.equal(message.status, 401);
    assert.equal(conversation.headers.get('content-type')?.includes('application/json'), true);
    assert.equal(message.headers.get('content-type')?.includes('application/json'), true);
  } finally {
    await env.close();
  }
});

test('Genie message route sends the OBO token to Databricks', async () => {
  const env = await startGenieServer({ accessToken: 'obo-custom-token' });
  const originalFetch = globalThis.fetch;
  const authorizationHeaders: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(env.base)) {
      return originalFetch(input, init);
    }
    const headers = new Headers(init?.headers);
    authorizationHeaders.push(headers.get('authorization') ?? '');
    return new Response(
      JSON.stringify({
        conversation_id: 'conversation-1',
        message_id: 'message-1',
        status: 'COMPLETED',
        attachments: [],
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    );
  }) as typeof fetch;

  try {
    const res = await fetch(`${env.base}/api/genie/finops/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'hello' }),
    });

    assert.equal(res.status, 200);
    assert.equal(authorizationHeaders[0], 'Bearer obo-custom-token');
    const body = await res.text();
    assert.match(body, /"type":"message_start"/);
    assert.match(body, /"type":"message_result"/);
  } finally {
    await env.close();
    globalThis.fetch = originalFetch;
  }
});
