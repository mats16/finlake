import { settingsToRecord, type DatabaseClient } from '@finlake/db';
import {
  CATALOG_SETTING_KEY,
  DataSourceIdentifierSchema,
  DEFAULT_GENIE_SPACE_PURPOSE,
  GENIE_SPACE_PURPOSES,
  GOLD_USAGE_TABLES,
  PERF_GENIE_SPACE_PURPOSE,
  medallionSchemaNamesFromSettings,
  type Env,
  type GenieChatResponse,
  type GenieSpacePurpose,
  type GenieSetupResponse,
} from '@finlake/shared';
import { fetchServicePrincipalToken } from '../auth/appServicePrincipal.js';
import { sleep } from '../utils/sleep.js';
import {
  genieMessageError,
  toGenieStreamMessage,
  type GenieMessageResponse,
  type GenieStreamEvent,
  type GenieStreamMessage,
} from './genieUtils.js';
import {
  getGenieAttachmentStatementResponse,
  normalizeGenieAttachments,
} from './genieAttachments.js';
import {
  createGenieMessage,
  createGenieSpace,
  getGenieMessage,
  listGenieConversationMessages,
  trashGenieSpace,
  updateGenieSpace,
} from './genieClient.js';
import { normalizeHost } from './normalizeHost.js';
import { WorkspaceServiceError } from './workspaceClientErrors.js';

export type { GenieStreamEvent } from './genieUtils.js';
export class GenieServiceError extends WorkspaceServiceError {}

const GENIE_SPACE_PARENT_PATH = '/Workspace/Shared';
const FINOPS_GENIE_SPACE_TITLE = 'FinOps Agent';
const PERF_GENIE_SPACE_TITLE = 'Performance Agent';

const GENIE_POLL_TIMEOUT_MS = 2 * 60 * 1000;
const GENIE_POLL_INITIAL_DELAY_MS = 1_000;
const GENIE_POLL_MAX_DELAY_MS = 5_000;
const GENIE_TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'CANCELED']);
const GENIE_TEXT_INSTRUCTIONS = [
  'You are FinOps Agent, a FinOps and billing analytics specialist for finance, platform, engineering, and product teams. Use only the attached FinLake tables plus general FinOps knowledge; do not claim internet access or rely on external facts. Answer in the same language as the user.',
  'Use the FinOps Framework as the operating model. Apply its principles: teams collaborate, everyone takes ownership of cloud usage, reports are accessible and timely, decisions are driven by business value, a central FinOps practice enables teams, and teams take advantage of the variable cloud cost model.',
  'Frame analysis through Inform, Optimize, and Operate. Inform: allocation, showback/chargeback, trends, forecasts, anomalies, and unit economics. Optimize: identify major cost drivers, waste, rate/commitment opportunities, rightsizing candidates, and architecture tradeoffs. Operate: recommend governance, ownership, budgets, alerts, recurring KPIs, and data-quality improvements.',
  'For cost metrics, default to EffectiveCost as the primary FinOps measure. Use ListCost for public or undiscounted price analysis, ContractedCost for negotiated-rate analysis, and BilledCost for invoice-oriented questions. Report BillingCurrency; if multiple currencies appear, group or caveat by BillingCurrency and do not convert unless the data supports conversion.',
  'Table selection: start with the gold usage_daily table for cost summaries, day-level trends, anomalies, month-over-month comparisons, provider/service/SKU breakdowns, and workspace or sub-account analysis. It has x_ChargeDate, x_BillingMonth, BillingAccountId, BillingAccountName, BillingCurrency, SubAccountId, SubAccountName, SubAccountType, ProviderName, ServiceCategory, ServiceSubcategory, ServiceName, SkuId, SkuMeter, ListCost, BilledCost, ContractedCost, and EffectiveCost.',
  'Use the gold usage_monthly table when the question needs resource-level or ownership context: ResourceType, ResourceId, ResourceName, Tags, top resources, showback, chargeback, unallocated spend, or tag-based analysis. It is monthly-grain; do not use it for daily trend questions.',
  'Use the silver usage table for record-level drill-down, audit or troubleshooting questions, fields missing from gold tables, charge-period detail, or validating a gold aggregate. This table can be large, so filter by date, account, provider, service, SKU, resource, or tag and avoid SELECT *.',
  "Tags is a MAP<STRING, STRING>; default governed tag keys are CostCenter, Project, and Environment. Read or filter tags with expressions such as Tags['CostCenter'], Tags['Project'], or Tags['Environment']. Treat null, empty, or missing values for these keys as unallocated spend and recommend ownership/tagging remediation when relevant.",
  'When producing SQL, always bound cost queries by date or billing month, aggregate before ranking, order top-N results by the selected cost metric, and use LIMIT for detail lists. Do not invent column names; if needed fields are absent, state the limitation and suggest the data needed.',
  'When answering, lead with the direct answer and quantified numbers, then show the main drivers, assumptions/date range, and concrete next actions. Separate observed facts from recommendations. Do not infer utilization, performance, or contractual commitment inventory from billing tables alone.',
] as const;

const PERF_GENIE_TEXT_INSTRUCTIONS = [
  'You are Performance Agent, a Databricks compute performance and cost optimization specialist. Use only the attached Databricks system tables and FinLake usage tables plus general Databricks performance knowledge; do not claim internet access. Answer in the same language as the user.',
  'Focus on cluster CPU and memory utilization, idle time, query execution status, failed or canceled statements, long-running statements, wait or queue time, recurring workload patterns, and actionable performance or cost tradeoffs.',
  'Use system.compute.clusters for cluster configuration history, system.compute.node_timeline for minute-level CPU and memory utilization, and system.compute.node_types for node hardware context.',
  'Use system.query.history for SQL statement execution status, duration, queue or wait time, failures, read/write/shuffle/spill metrics, executed user, and source context. Filter by compute.cluster_id when that field is populated.',
  'Use FinLake usage tables when cost attribution is needed. Bind cost queries by date or billing month, filter to Databricks, aggregate before ranking, and do not infer runtime utilization from billing tables alone.',
  'Prefer visual analysis over text-only summaries. For cluster investigations, create chart-ready result sets: hourly CPU and memory utilization time series, query execution count/status over time, status breakdown, and top long-running or failed statements. Explain what each chart shows and then summarize the operational implication.',
  'When a prompt names a cluster ID, start by filtering utilization tables to that cluster and the requested date range, and check query history for the same cluster and period. If query history has no rows for classic or jobs compute, state the limitation instead of inventing query activity. Lead with observed facts, then likely causes, then concrete next actions and verification SQL.',
] as const;

const SYSTEM_COMPUTE_TABLES = [
  'system.compute.clusters',
  'system.compute.node_timeline',
  'system.compute.node_types',
] as const;

const SYSTEM_QUERY_TABLES = ['system.query.history'] as const;

const GENIE_PURPOSE_SET = new Set<string>(GENIE_SPACE_PURPOSES);

interface GeniePurposeConfig {
  purpose: GenieSpacePurpose;
  title: string;
  description: string;
  instructions: readonly string[];
  requiresCatalog: boolean;
}

interface ResolvedGenieContext {
  host: string;
  token: string;
  spaceId: string;
  authMode: 'obo' | 'service_principal';
}

const GENIE_PURPOSE_CONFIG: Record<GenieSpacePurpose, GeniePurposeConfig> = {
  finops: {
    purpose: DEFAULT_GENIE_SPACE_PURPOSE,
    title: FINOPS_GENIE_SPACE_TITLE,
    description: 'FinLake Genie Space for exploring usage and daily cost facts.',
    instructions: GENIE_TEXT_INSTRUCTIONS,
    requiresCatalog: true,
  },
  perf: {
    purpose: PERF_GENIE_SPACE_PURPOSE,
    title: PERF_GENIE_SPACE_TITLE,
    description: 'FinLake Genie Space for investigating Databricks compute performance.',
    instructions: PERF_GENIE_TEXT_INSTRUCTIONS,
    requiresCatalog: false,
  },
};

export async function setupFinLakeGenieSpace(
  env: Env,
  db: DatabaseClient,
  warehouseId?: string,
  purpose: GenieSpacePurpose = DEFAULT_GENIE_SPACE_PURPOSE,
): Promise<GenieSetupResponse> {
  const config = GENIE_PURPOSE_CONFIG[purpose];
  const settings = settingsToRecord(await db.repos.appSettings.list());
  const existing = await db.repos.genieSpaces.get(purpose);
  const existingSpaceId = existing?.spaceId.trim();
  const tables = genieTablesForPurpose(purpose, settings);
  const host = normalizeHost(env.DATABRICKS_HOST);
  const selectedWarehouseId = warehouseId?.trim();

  validateFinLakeTableIdentifiers(settings, config.requiresCatalog);

  if (existingSpaceId) {
    if (host && selectedWarehouseId) {
      const token = await fetchServicePrincipalToken(host, env, GenieServiceError);
      const updated = await updateGenieSpace(
        host,
        token,
        existingSpaceId,
        {
          title: config.title,
          description: config.description,
          warehouseId: selectedWarehouseId,
          serializedSpace: buildSerializedSpace(tables, config),
        },
        GenieServiceError,
      );
      return {
        spaceId: existingSpaceId,
        title: updated.title?.trim() || config.title,
        tableIdentifiers: tables,
        purpose,
      };
    }
    return { spaceId: existingSpaceId, title: config.title, tableIdentifiers: tables, purpose };
  }

  if (!host || !selectedWarehouseId) {
    throw new GenieServiceError('DATABRICKS_HOST and selected SQL warehouse are required.', 500);
  }

  const token = await fetchServicePrincipalToken(host, env, GenieServiceError);
  const space = await createGenieSpace(
    host,
    token,
    {
      title: config.title,
      description: config.description,
      warehouseId: selectedWarehouseId,
      parentPath: GENIE_SPACE_PARENT_PATH,
      serializedSpace: buildSerializedSpace(tables, config),
    },
    GenieServiceError,
  );

  const spaceId = space.space_id?.trim();
  if (!spaceId) {
    throw new GenieServiceError('Create Genie Space returned no space_id.', 502);
  }

  await db.repos.genieSpaces.upsert(purpose, spaceId);
  return {
    spaceId,
    title: space.title?.trim() || config.title,
    tableIdentifiers: tables,
    purpose,
  };
}

export async function deleteFinLakeGenieSpace(
  env: Env,
  db: DatabaseClient,
  purpose: GenieSpacePurpose = DEFAULT_GENIE_SPACE_PURPOSE,
): Promise<void> {
  const space = await db.repos.genieSpaces.get(purpose);
  const spaceId = space?.spaceId.trim();
  if (!spaceId) return;

  const host = normalizeHost(env.DATABRICKS_HOST);
  if (!host) {
    throw new GenieServiceError('DATABRICKS_HOST is required.', 500);
  }

  const token = await fetchServicePrincipalToken(host, env, GenieServiceError);
  await trashGenieSpace(host, token, spaceId, GenieServiceError);
  await db.repos.genieSpaces.delete(purpose);
}

export async function deleteAllFinLakeGenieSpaces(env: Env, db: DatabaseClient): Promise<string[]> {
  const spaces = await db.repos.genieSpaces.list();
  const validSpaces = spaces.filter((s) => normalizeGeniePurpose(s.purpose));
  await Promise.all(
    validSpaces.map((s) => deleteFinLakeGenieSpace(env, db, normalizeGeniePurpose(s.purpose)!)),
  );
  return validSpaces.map((s) => s.spaceId);
}

export async function askFinLakeGenie(
  env: Env,
  db: DatabaseClient,
  opts: {
    purpose?: GenieSpacePurpose;
    content: string;
    conversationId?: string;
    userAccessToken?: string;
  },
): Promise<GenieChatResponse> {
  const context = await resolveGenieContext(
    env,
    db,
    opts.userAccessToken,
    opts.purpose ?? DEFAULT_GENIE_SPACE_PURPOSE,
  );
  const started = await startGenieMessage(context, opts);

  const message = await pollGenieMessage(
    context.host,
    context.token,
    context.spaceId,
    started.conversationId,
    started.messageId,
  );
  const status = message.status?.trim() || 'UNKNOWN';
  const normalizedStatus = status.toUpperCase();
  if (normalizedStatus !== 'COMPLETED') {
    const detail = genieMessageError(message) ?? status;
    throw new GenieServiceError(`Genie message did not complete: ${detail}`, 502);
  }

  const attachments = await normalizeGenieAttachments(
    context.host,
    context.token,
    context.spaceId,
    started.conversationId,
    started.messageId,
    message.attachments ?? [],
  );
  const answer = attachments.map((attachment) => attachment.text).find(Boolean) ?? null;
  return {
    conversationId: started.conversationId,
    messageId: started.messageId,
    status,
    answer,
    attachments,
    authMode: context.authMode,
  };
}

export async function streamFinLakeGenieMessage(
  env: Env,
  db: DatabaseClient,
  opts: {
    purpose?: GenieSpacePurpose;
    content: string;
    conversationId?: string;
    userAccessToken?: string;
    emit: (event: GenieStreamEvent) => void;
  },
): Promise<void> {
  const context = await resolveGenieContext(
    env,
    db,
    opts.userAccessToken,
    opts.purpose ?? DEFAULT_GENIE_SPACE_PURPOSE,
  );
  const started = await startGenieMessage(context, opts);
  const { conversationId, messageId } = started;

  opts.emit({ type: 'message_start', conversationId, messageId, spaceId: context.spaceId });

  let message = started.message;
  let delay = GENIE_POLL_INITIAL_DELAY_MS;
  const deadline = Date.now() + GENIE_POLL_TIMEOUT_MS;
  while (!GENIE_TERMINAL_STATUSES.has((message.status ?? '').toUpperCase())) {
    if (message.status) {
      opts.emit({ type: 'status', status: message.status });
    }
    if (Date.now() > deadline) {
      throw new GenieServiceError('Genie response timed out. Try a narrower question.', 504);
    }
    await sleep(delay);
    delay = Math.min(Math.round(delay * 1.5), GENIE_POLL_MAX_DELAY_MS);
    message = await getGenieMessage(
      context.host,
      context.token,
      context.spaceId,
      conversationId,
      messageId,
      GenieServiceError,
    );
  }

  const status = message.status?.trim() || 'UNKNOWN';
  opts.emit({ type: 'status', status });
  const streamMessage = toGenieStreamMessage(message, {
    conversationId,
    messageId,
    spaceId: context.spaceId,
  });
  opts.emit({
    type: 'message_result',
    message: {
      ...streamMessage,
      status,
      content: streamMessage.content || opts.content,
    },
  });
  await emitQueryResultsForMessage(context, conversationId, streamMessage, opts.emit);
}

export async function streamFinLakeGenieConversation(
  env: Env,
  db: DatabaseClient,
  opts: {
    purpose?: GenieSpacePurpose;
    conversationId: string;
    pageToken?: string;
    includeQueryResults?: boolean;
    userAccessToken?: string;
    emit: (event: GenieStreamEvent) => void;
  },
): Promise<void> {
  const context = await resolveGenieContext(
    env,
    db,
    opts.userAccessToken,
    opts.purpose ?? DEFAULT_GENIE_SPACE_PURPOSE,
  );
  const page = await listGenieConversationMessages(
    context.host,
    context.token,
    context.spaceId,
    opts.conversationId,
    opts.pageToken,
    GenieServiceError,
  );
  const messages = page.messages.reverse().map((message) => toGenieStreamMessage(message));

  for (const message of messages) {
    opts.emit({ type: 'message_result', message });
  }
  opts.emit({
    type: 'history_info',
    conversationId: opts.conversationId,
    spaceId: context.spaceId,
    nextPageToken: page.nextPageToken,
    loadedCount: messages.length,
  });

  if (opts.includeQueryResults === false) return;
  for (const message of messages) {
    await emitQueryResultsForMessage(context, opts.conversationId, message, opts.emit);
  }
}

export async function streamFinLakeGenieExistingMessage(
  env: Env,
  db: DatabaseClient,
  opts: {
    purpose?: GenieSpacePurpose;
    conversationId: string;
    messageId: string;
    userAccessToken?: string;
    emit: (event: GenieStreamEvent) => void;
  },
): Promise<void> {
  const context = await resolveGenieContext(
    env,
    db,
    opts.userAccessToken,
    opts.purpose ?? DEFAULT_GENIE_SPACE_PURPOSE,
  );
  const message = await pollGenieMessage(
    context.host,
    context.token,
    context.spaceId,
    opts.conversationId,
    opts.messageId,
  );
  const streamMessage = toGenieStreamMessage(message, {
    conversationId: opts.conversationId,
    messageId: opts.messageId,
    spaceId: context.spaceId,
  });
  opts.emit({ type: 'message_result', message: streamMessage });
  await emitQueryResultsForMessage(context, opts.conversationId, streamMessage, opts.emit);
}

async function startGenieMessage(
  context: ResolvedGenieContext,
  opts: { content: string; conversationId?: string },
): Promise<{ conversationId: string; messageId: string; message: GenieMessageResponse }> {
  const started = await createGenieMessage(
    context.host,
    context.token,
    context.spaceId,
    {
      content: opts.content,
      conversationId: opts.conversationId,
    },
    GenieServiceError,
  );
  const message = started.message ?? started;
  const conversationId =
    message.conversation_id?.trim() ||
    started.conversation?.id?.trim() ||
    opts.conversationId?.trim();
  const messageId = message.message_id?.trim() || message.id?.trim();
  if (!conversationId || !messageId) {
    throw new GenieServiceError(
      'Genie response did not include a conversation or message id.',
      502,
    );
  }
  return { conversationId, messageId, message };
}

async function resolveGenieContext(
  env: Env,
  db: DatabaseClient,
  userAccessToken: string | undefined,
  purpose: GenieSpacePurpose,
): Promise<ResolvedGenieContext> {
  const space = await db.repos.genieSpaces.get(purpose);
  const spaceId = space?.spaceId.trim();
  if (!spaceId) {
    throw new GenieServiceError(
      `${GENIE_PURPOSE_CONFIG[purpose].title} has not been configured yet.`,
      400,
    );
  }
  const host = normalizeHost(env.DATABRICKS_HOST);
  if (!host) {
    throw new GenieServiceError('DATABRICKS_HOST is required.', 500);
  }
  const userToken = userAccessToken?.trim();
  return {
    host,
    spaceId,
    token: userToken || (await fetchServicePrincipalToken(host, env, GenieServiceError)),
    authMode: userToken ? 'obo' : 'service_principal',
  };
}

export function normalizeGeniePurpose(alias: string | undefined): GenieSpacePurpose | null {
  const value = alias?.trim().toLowerCase();
  if (!value || value === 'default' || value === 'finlake') return DEFAULT_GENIE_SPACE_PURPOSE;
  if (GENIE_PURPOSE_SET.has(value)) return value as GenieSpacePurpose;
  return null;
}

export async function getGenieSpaceStatus(
  db: DatabaseClient,
  purpose: GenieSpacePurpose,
): Promise<{
  purpose: GenieSpacePurpose;
  spaceId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}> {
  const space = await db.repos.genieSpaces.get(purpose);
  return {
    purpose,
    spaceId: space?.spaceId ?? null,
    createdAt: space?.createdAt ?? null,
    updatedAt: space?.updatedAt ?? null,
  };
}

function finLakeCatalog(settings: Record<string, string | undefined>): string {
  return settings[CATALOG_SETTING_KEY]?.trim() ?? '';
}

function genieTablesForPurpose(
  purpose: GenieSpacePurpose,
  settings: Record<string, string | undefined>,
): string[] {
  const catalog = finLakeCatalog(settings);
  const medallionSchemas = medallionSchemaNamesFromSettings(settings);
  const finLakeTables = catalog
    ? [
        `${catalog}.${medallionSchemas.silver}.usage`,
        `${catalog}.${medallionSchemas.gold}.${GOLD_USAGE_TABLES.daily}`,
        `${catalog}.${medallionSchemas.gold}.${GOLD_USAGE_TABLES.monthly}`,
      ]
    : [];
  if (purpose === PERF_GENIE_SPACE_PURPOSE) {
    return [...SYSTEM_COMPUTE_TABLES, ...SYSTEM_QUERY_TABLES, ...finLakeTables];
  }
  return finLakeTables;
}

function validateFinLakeTableIdentifiers(
  settings: Record<string, string | undefined>,
  required: boolean,
): void {
  const catalog = finLakeCatalog(settings);
  if (!catalog) {
    if (required) {
      throw new GenieServiceError(
        'Main catalog not configured. Set catalog_name in Catalog first.',
        400,
      );
    }
    return;
  }
  const medallionSchemas = medallionSchemaNamesFromSettings(settings);
  for (const part of [catalog, medallionSchemas.silver, medallionSchemas.gold]) {
    const parsed = DataSourceIdentifierSchema.safeParse(part);
    if (!parsed.success) {
      throw new GenieServiceError(
        `Catalog and schema names must be simple Unity Catalog identifiers for Genie setup: ${part}`,
        400,
      );
    }
  }
}

async function pollGenieMessage(
  host: string,
  token: string,
  spaceId: string,
  conversationId: string,
  messageId: string,
): Promise<GenieMessageResponse> {
  let message = await getGenieMessage(
    host,
    token,
    spaceId,
    conversationId,
    messageId,
    GenieServiceError,
  );
  let delay = GENIE_POLL_INITIAL_DELAY_MS;
  const deadline = Date.now() + GENIE_POLL_TIMEOUT_MS;

  while (!GENIE_TERMINAL_STATUSES.has((message.status ?? '').toUpperCase())) {
    if (Date.now() > deadline) {
      throw new GenieServiceError('Genie response timed out. Try a narrower question.', 504);
    }
    await sleep(delay);
    delay = Math.min(Math.round(delay * 1.5), GENIE_POLL_MAX_DELAY_MS);
    message = await getGenieMessage(
      host,
      token,
      spaceId,
      conversationId,
      messageId,
      GenieServiceError,
    );
  }

  return message;
}

function buildSerializedSpace(tableIdentifiers: string[], config: GeniePurposeConfig) {
  const sortedTableIdentifiers = [...tableIdentifiers].sort((a, b) => a.localeCompare(b));

  return {
    version: 2,
    config: {
      sample_questions: sampleQuestionsForPurpose(config.purpose),
    },
    data_sources: {
      tables: sortedTableIdentifiers.map((identifier) => ({
        identifier,
        description: [descriptionForTable(identifier)],
      })),
    },
    instructions: {
      text_instructions: [
        {
          id: '01f1a100000000000000000000000005',
          content: [...config.instructions],
        },
      ],
    },
  };
}

function sampleQuestionsForPurpose(purpose: GenieSpacePurpose) {
  if (purpose === PERF_GENIE_SPACE_PURPOSE) {
    return [
      {
        id: '01f1a100000000000000000000000011',
        question: ['Which clusters had the lowest CPU utilization in the last 30 days?'],
      },
      {
        id: '01f1a100000000000000000000000012',
        question: ['Find clusters with high cost and low memory utilization this month.'],
      },
      {
        id: '01f1a100000000000000000000000013',
        question: [
          'Review autoscaling and autotermination settings for idle all-purpose clusters.',
        ],
      },
      {
        id: '01f1a100000000000000000000000014',
        question: ['Show CPU, memory, and query execution signals for a specific cluster ID.'],
      },
    ];
  }
  return [
    {
      id: '01f1a100000000000000000000000001',
      question: ['What drove EffectiveCost last month?'],
    },
    {
      id: '01f1a100000000000000000000000002',
      question: ['Show daily EffectiveCost by provider and service for the last 30 days.'],
    },
    {
      id: '01f1a100000000000000000000000003',
      question: ['Which unallocated or poorly tagged resources should we prioritize?'],
    },
    {
      id: '01f1a100000000000000000000000004',
      question: ['List top resources by EffectiveCost this month with recommended next actions.'],
    },
  ];
}

function descriptionForTable(identifier: string): string {
  if (identifier === 'system.compute.clusters') {
    return 'Databricks compute configuration history, including cluster owner, source, runtime, worker sizing, autoscaling, autotermination, access mode, and policy metadata.';
  }
  if (identifier === 'system.compute.node_timeline') {
    return 'Minute-level Databricks node utilization metrics, including CPU, memory, network, node type, driver flag, and instance identity by workspace and cluster.';
  }
  if (identifier === 'system.compute.node_types') {
    return 'Databricks node type hardware reference with vCPU, memory, and GPU counts.';
  }
  if (identifier === 'system.query.history') {
    return 'Databricks query history with statement execution status, timing, wait and queue duration, failure details, read/write/shuffle/spill metrics, compute identifiers, executed user, and query source context.';
  }
  if (identifier.endsWith(`.${GOLD_USAGE_TABLES.monthly}`)) {
    return 'Gold FOCUS monthly usage rollup with provider, service, SKU, account, resource identifiers, latest Tags, and List/Billed/Contracted/Effective cost columns. Best for resource-level analysis, ownership, showback, chargeback, and tag allocation.';
  }
  if (identifier.endsWith(`.${GOLD_USAGE_TABLES.daily}`)) {
    return 'Gold FOCUS daily usage rollup with x_ChargeDate, x_BillingMonth, provider, service, SKU, account, sub-account, and List/Billed/Contracted/Effective cost columns. Best for trends, anomalies, summaries, and service/provider breakdowns.';
  }
  return 'Silver FOCUS 1.2 usage detail view unifying enabled billing data sources. Best for record-level drill-down, audit, troubleshooting, detailed charge-period analysis, and validation of gold aggregates.';
}

async function emitQueryResultsForMessage(
  context: { host: string; token: string; spaceId: string },
  conversationId: string,
  message: GenieStreamMessage,
  emit: (event: GenieStreamEvent) => void,
): Promise<void> {
  for (const attachment of message.attachments ?? []) {
    const attachmentId = attachment.attachmentId;
    const statementId = attachment.query?.statementId;
    if (!attachmentId || !statementId) continue;
    const statement = await getGenieAttachmentStatementResponse(
      context.host,
      context.token,
      context.spaceId,
      conversationId,
      message.messageId,
      attachmentId,
    );
    if (!statement) continue;
    emit({
      type: 'query_result',
      attachmentId,
      statementId,
      data: statement,
    });
  }
}
