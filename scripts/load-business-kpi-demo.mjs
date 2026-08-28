import { gzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';

const rows = buildRows(90);
if (process.argv.includes('--dry-run')) {
  process.stdout.write(
    `${JSON.stringify({ demo: true, rowCount: rows.length, first: rows[0], last: rows.at(-1) }, null, 2)}\n`,
  );
  process.exit(0);
}

const host = workspaceOrigin(requiredEnv('DATABRICKS_HOST'));
const token = requiredEnv('DATABRICKS_TOKEN');
const catalog = identifierEnv('FINLAKE_CATALOG', 'finops');
const ingestSchema = identifierEnv('FINLAKE_INGEST_SCHEMA', 'ingest');
const goldSchema = identifierEnv('FINLAKE_GOLD_SCHEMA', 'analytics');
const volume = identifierEnv('FINLAKE_DOWNLOADS_VOLUME', 'downloads');
const pipelineName = 'finops-demo-business-kpi-pipeline';
const workspacePath = '/Shared/finlake/demo/business-kpi-pipeline.sql';
const rawDirectory = `/Volumes/${catalog}/${ingestSchema}/${volume}/demo/ai-value/business-kpi`;
const rawFile = `${rawDirectory}/business_kpi_daily.json.gz`;

const existing = await findPipelineByName(pipelineName);
if (existing?.pipeline_id) {
  const current = await api(`/api/2.0/pipelines/${encodeURIComponent(existing.pipeline_id)}`);
  assertManagedPipeline(current.spec ?? current);
}

const body = gzipSync(`${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
await api(`/api/2.0/fs/directories${rawDirectory}`, { method: 'PUT', allow: [200, 201, 204, 409] });
await api(`/api/2.0/fs/files${rawFile}?overwrite=true`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/octet-stream' },
  body,
  raw: true,
});

const pipelineSql = await readFile(
  new URL('../apps/api/src/sql/businessKpiDemoPipeline.sql', import.meta.url),
  'utf8',
);
await api('/api/2.0/workspace/import', {
  method: 'POST',
  body: {
    path: workspacePath,
    format: 'SOURCE',
    language: 'SQL',
    overwrite: true,
    content: Buffer.from(pipelineSql, 'utf8').toString('base64'),
  },
});

const settings = {
  name: pipelineName,
  catalog,
  schema: ingestSchema,
  serverless: true,
  development: false,
  continuous: false,
  channel: 'CURRENT',
  libraries: [{ file: { path: workspacePath } }],
  configuration: {
    demo_raw_path: `${rawDirectory}/*.json.gz`,
    gold_schema_name: goldSchema,
  },
  tags: {
    ManagedBy: 'finlake',
    Project: 'finops',
    CostCenter: 'finlake',
    Environment: 'demo',
  },
};

let pipelineId = existing?.pipeline_id;
if (pipelineId) {
  await api(`/api/2.0/pipelines/${encodeURIComponent(pipelineId)}`, {
    method: 'PUT',
    body: settings,
  });
} else {
  const created = await api('/api/2.0/pipelines', { method: 'POST', body: settings });
  pipelineId = created.pipeline_id;
}
if (!pipelineId) throw new Error('Lakeflow Pipelines API returned no pipeline_id');

const started = await api(`/api/2.0/pipelines/${encodeURIComponent(pipelineId)}/updates`, {
  method: 'POST',
  body: { full_refresh: true },
});
if (!started.update_id) throw new Error('Lakeflow Pipelines API returned no update_id');
await waitForUpdate(pipelineId, started.update_id);

process.stdout.write(
  `${JSON.stringify(
    {
      demo: true,
      rowCount: rows.length,
      startDate: rows[0].date,
      endDate: rows.at(-1).date,
      rawFile,
      table: `${catalog}.${goldSchema}.business_kpi_daily`,
      pipelineId,
      updateId: started.update_id,
    },
    null,
    2,
  )}\n`,
);

function buildRows(days) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - (days - index - 1));
    const adoptionDay = Math.max(0, index - 59);
    const weekly = Math.sin((index / 7) * Math.PI * 2);
    const headcount = 28 + Math.floor(index / 45);
    const ticketsResolved = Math.round(510 + index * 1.8 + adoptionDay * 4.2 + weekly * 24);
    const avgResolutionMinutes = round(194 - index * 0.18 - adoptionDay * 0.75 + weekly * 4.5, 1);
    const csat = round(Math.min(94, 82.5 + index * 0.025 + adoptionDay * 0.18 - weekly * 0.4), 1);
    return {
      date: date.toISOString().slice(0, 10),
      team_id: 'support',
      headcount,
      tickets_resolved: ticketsResolved,
      avg_resolution_minutes: avgResolutionMinutes,
      csat,
      active_customers: 18400 + index * 37,
      is_demo: true,
    };
  });
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function findPipelineByName(name) {
  let pageToken;
  let match;
  do {
    const query = new URLSearchParams({ max_results: '100' });
    if (pageToken) query.set('page_token', pageToken);
    const page = await api(`/api/2.0/pipelines?${query}`);
    for (const pipeline of page.statuses ?? []) {
      if (pipeline.name !== name) continue;
      if (match)
        throw new Error(`Multiple Lakeflow pipelines are named ${name}; refusing to choose one`);
      match = pipeline;
    }
    pageToken = page.next_page_token;
  } while (pageToken);
  return match;
}

function assertManagedPipeline(spec) {
  const expectedRawPath = `${rawDirectory}/*.json.gz`;
  const hasWorkspaceLibrary = (spec.libraries ?? []).some(
    (library) => library.file?.path === workspacePath,
  );
  if (
    spec.catalog !== catalog ||
    spec.schema !== ingestSchema ||
    spec.configuration?.demo_raw_path !== expectedRawPath ||
    spec.configuration?.gold_schema_name !== goldSchema ||
    spec.tags?.ManagedBy !== 'finlake' ||
    spec.tags?.Environment !== 'demo' ||
    !hasWorkspaceLibrary
  ) {
    throw new Error(
      `${pipelineName} exists but is not the expected FinLake demo pipeline; refusing to overwrite it`,
    );
  }
}

async function waitForUpdate(pipelineId, updateId) {
  const deadline = Date.now() + 20 * 60_000;
  while (Date.now() < deadline) {
    const update = await api(
      `/api/2.0/pipelines/${encodeURIComponent(pipelineId)}/updates/${encodeURIComponent(updateId)}`,
    );
    const state = update.update?.state;
    if (state === 'COMPLETED') return;
    if (state === 'FAILED' || state === 'CANCELED') {
      throw new Error(`Lakeflow update ${updateId} ended in ${state}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(`Timed out waiting for Lakeflow update ${updateId}`);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (options.body !== undefined && !options.raw) headers.set('Content-Type', 'application/json');

  let body;
  if (options.body !== undefined) {
    body = options.raw ? options.body : JSON.stringify(options.body);
  }

  const response = await fetch(`${host}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body,
    signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
  });
  if (options.allow?.includes(response.status))
    return response.status === 204 ? {} : safeJson(response);
  if (!response.ok)
    throw new Error(
      `${options.method ?? 'GET'} ${path}: ${response.status} ${await response.text()}`,
    );
  return response.status === 204 ? {} : safeJson(response);
}

function identifierEnv(name, fallback) {
  const value = process.env[name]?.trim() || fallback;
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${name} must contain only letters, numbers, underscores, or hyphens`);
  }
  return value;
}

function workspaceOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DATABRICKS_HOST must be a valid HTTPS workspace URL');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'DATABRICKS_HOST must be an HTTPS origin without credentials, path, query, or hash',
    );
  }
  return url.origin;
}

async function safeJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
