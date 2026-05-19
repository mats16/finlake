import type { Env } from '@finlake/shared';
import type { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { DatabaseClient } from './DatabaseClient.js';
import type {
  AppSettingValue,
  AppSettingsRepo,
  BudgetsRepo,
  CachedAggregationValue,
  CachedAggregationsRepo,
  DataSourceCreateInput,
  DataSourceUpdatePatch,
  DataSourceValue,
  DataSourcesRepo,
  GenieSpacesRepo,
  GenieSpaceValue,
  PricingDataRepo,
  PricingDataRunPatch,
  PricingDataUpsertInput,
  PricingDataValue,
  Repositories,
  SetupStateRepo,
  SetupStateValue,
  UserPreferencesRepo,
  UserPreferencesValue,
  WorkspacesRepo,
  WorkspaceValue,
} from './repositories/index.js';
import * as s from './schema/pg.js';
import { logger } from './logger.js';
import type {
  Budget,
  CreateBudgetInput,
  DataSourceKey,
  SetupCheckResult,
  UpdateBudgetInput,
} from '@finlake/shared';

type Db = NodePgDatabase<typeof s>;

/**
 * Lakebase-backed DatabaseClient.
 *
 * Uses the Databricks Lakebase/AppKit connector path via
 * `@databricks/lakebase#createLakebasePool`, which returns a `pg.Pool`
 * configured with Databricks OAuth credential refresh for Lakebase.
 */
export class LakebaseClient implements DatabaseClient {
  readonly backend = 'lakebase' as const;
  readonly repos: Repositories;

  private constructor(
    private readonly pool: Pool,
    private readonly db: Db,
  ) {
    this.repos = {
      budgets: new PgBudgetsRepo(db),
      userPreferences: new PgUserPreferencesRepo(db),
      cachedAggregations: new PgCachedAggregationsRepo(db),
      setupState: new PgSetupStateRepo(db),
      appSettings: new PgAppSettingsRepo(db),
      genieSpaces: new PgGenieSpacesRepo(db),
      workspaces: new PgWorkspacesRepo(db),
      dataSources: new PgDataSourcesRepo(db),
      pricingData: new PgPricingDataRepo(db),
    };
  }

  static async create(env: Env): Promise<LakebaseClient> {
    const { createLakebasePool } = await import('@databricks/lakebase').catch((err: unknown) => {
      throw new Error(
        `@databricks/lakebase is required when LAKEBASE_ENDPOINT is set: ${messageOf(err)}`,
      );
    });
    const schemaName = resolveLakebaseSchema(env);
    const pool = createLakebasePool({
      endpoint: env.LAKEBASE_ENDPOINT,
      host: env.PGHOST,
      database: env.PGDATABASE,
      user: env.PGUSER,
      port: env.PGPORT,
      sslMode: env.PGSSLMODE as 'require' | 'disable' | 'prefer' | undefined,
    });
    await pool.query(`create schema if not exists ${quoteIdent(schemaName)}`);
    installSearchPath(pool, schemaName);
    const db = drizzle(pool, { schema: s });
    const client = new LakebaseClient(pool, db);
    await client.bootstrapSchema();
    logger.info({ schemaName }, 'Lakebase schema initialized');
    return client;
  }

  private async bootstrapSchema(): Promise<void> {
    await this.db.execute(sql`
      create table if not exists budgets (
        id text primary key,
        workspace_id text,
        name text not null,
        scope_type text not null,
        scope_value text not null,
        amount_usd double precision not null,
        period text not null,
        thresholds_pct jsonb not null default '[80,100]'::jsonb,
        notify_emails jsonb not null default '[]'::jsonb,
        created_by text not null,
        created_at timestamptz not null default now()
      )
    `);
    await this.db.execute(sql`
      create table if not exists budget_alerts (
        id text primary key,
        budget_id text not null,
        threshold_pct integer not null,
        triggered_at timestamptz not null default now(),
        actual_usd double precision not null,
        notified_channels jsonb not null default '[]'::jsonb
      )
    `);
    await this.db.execute(sql`
      create table if not exists user_preferences (
        user_id text primary key,
        currency text not null default 'USD',
        default_workspace_id text,
        theme text not null default 'system',
        prefs jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default now()
      )
    `);
    await this.db.execute(sql`
      create table if not exists cached_aggregations (
        cache_key text primary key,
        query_hash text not null,
        payload jsonb not null,
        computed_at timestamptz not null default now(),
        expires_at timestamptz not null
      )
    `);
    await this.db.execute(sql`
      create table if not exists tag_chargeback_rules (
        id text primary key,
        tag_key text not null,
        tag_value_pattern text not null,
        cost_center text not null,
        owner_email text,
        priority integer not null default 100
      )
    `);
    await this.db.execute(sql`
      create table if not exists app_settings (
        key text primary key,
        value text not null,
        updated_at timestamptz not null default now()
      )
    `);
    await this.db.execute(sql`
      create table if not exists genie_spaces (
        purpose text primary key,
        space_id text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await this.db.execute(sql`
      create table if not exists workspaces (
        id text primary key,
        domain text not null,
        updated_at timestamptz not null default now()
      )
    `);
    await this.db.execute(sql`
      create table if not exists data_sources (
        name text not null,
        provider_name text not null,
        account_id text not null,
        table_name text not null,
        focus_version text,
        pipeline_id text,
        enabled boolean not null default true,
        config jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default now(),
        primary key(provider_name, account_id)
      )
    `);
    await this.db.execute(sql`
      create table if not exists pricing_data (
        id text primary key,
        provider text not null,
        service text not null,
        "table" text not null,
        raw_data_table text,
        raw_data_path text,
        notebook_path text,
        notebook_id text,
        metadata jsonb not null default '{}'::jsonb,
        run_id bigint,
        run_status text not null default 'not_started',
        run_url text,
        run_started_at timestamptz,
        run_finished_at timestamptz,
        run_checked_at timestamptz,
        updated_at timestamptz not null default now(),
        unique(provider, service)
      )
    `);
    await this.ensurePricingRunIdBigint();
    await this.db.execute(sql`
      create table if not exists setup_state (
        workspace_id text primary key,
        system_tables_ok boolean not null default false,
        permissions_ok boolean not null default false,
        cur_configured boolean not null default false,
        azure_export_configured boolean not null default false,
        last_checked_at timestamptz not null default now(),
        details jsonb not null default '{}'::jsonb
      )
    `);
    await this.migrateWorkspacesDomainColumn();
    await this.migrateLegacyGenieSpace();
    await this.addColumnIfMissing('data_sources', 'pipeline_id', 'text');
    await this.dropColumnIfExists('data_sources', 'job_id');
    await this.migrateAppSettingKey('focus_pipeline_job_id', 'lakeflow_pipeline_job_id');
    await this.migrateAppSettingKey('focus_pipeline_id', 'lakeflow_pipeline_id');
    logger.debug('Lakebase schema bootstrap complete');
  }

  private async migrateWorkspacesDomainColumn(): Promise<void> {
    const columns = await this.tableColumns('workspaces');
    if (columns.has('domain') || !columns.has('deployment_name')) return;
    await this.db.execute(sql`alter table workspaces rename column deployment_name to domain`);
  }

  private async migrateLegacyGenieSpace(): Promise<void> {
    await this.db.execute(sql`
      insert into genie_spaces (purpose, space_id, created_at, updated_at)
      select 'finops', value, now(), now()
      from app_settings
      where key = 'genie_space_id'
        and btrim(value) <> ''
        and not exists (select 1 from genie_spaces where purpose = 'finops')
    `);
    await this.db.execute(sql`delete from app_settings where key = 'genie_space_id'`);
  }

  private async addColumnIfMissing(
    table: string,
    column: string,
    definition: string,
  ): Promise<void> {
    const columns = await this.tableColumns(table);
    if (columns.has(column)) return;
    await this.db.execute(
      sql.raw(`alter table ${quoteIdent(table)} add column ${quoteIdent(column)} ${definition}`),
    );
  }

  private async dropColumnIfExists(table: string, column: string): Promise<void> {
    const columns = await this.tableColumns(table);
    if (!columns.has(column)) return;
    await this.db.execute(
      sql.raw(`alter table ${quoteIdent(table)} drop column ${quoteIdent(column)}`),
    );
  }

  private async migrateAppSettingKey(oldKey: string, newKey: string): Promise<void> {
    await this.db.execute(sql`
      update app_settings
      set key = ${newKey}
      where key = ${oldKey}
        and not exists (select 1 from app_settings where key = ${newKey})
    `);
    await this.db.execute(sql`delete from app_settings where key = ${oldKey}`);
  }

  private async ensurePricingRunIdBigint(): Promise<void> {
    const result = await this.pool.query<{ data_type: string }>(
      `select data_type
       from information_schema.columns
       where table_schema = current_schema()
         and table_name = 'pricing_data'
         and column_name = 'run_id'`,
    );
    const dataType = result.rows[0]?.data_type;
    if (dataType === 'bigint') return;
    await this.db.execute(sql`alter table pricing_data alter column run_id type bigint`);
  }

  private async tableColumns(table: string): Promise<Set<string>> {
    const result = await this.pool.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = current_schema() and table_name = $1`,
      [table],
    );
    return new Set(result.rows.map((row) => row.column_name));
  }

  async healthCheck(): Promise<{ ok: true; backend: 'lakebase' }> {
    await this.db.execute(sql`select 1`);
    return { ok: true, backend: 'lakebase' };
  }

  async migrate(): Promise<void> {
    await this.bootstrapSchema();
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

class PgBudgetsRepo implements BudgetsRepo {
  constructor(private db: Db) {}

  async list(workspaceId: string | null): Promise<Budget[]> {
    const rows = workspaceId
      ? await this.db.select().from(s.budgets).where(eq(s.budgets.workspaceId, workspaceId))
      : await this.db.select().from(s.budgets);
    return rows.map(toBudget);
  }

  async create(input: CreateBudgetInput, createdBy: string): Promise<Budget> {
    const row = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      name: input.name,
      scopeType: input.scopeType,
      scopeValue: input.scopeValue,
      amountUsd: input.amountUsd,
      period: input.period,
      thresholdsPct: input.thresholdsPct,
      notifyEmails: input.notifyEmails,
      createdBy,
      createdAt: new Date(),
    };
    const inserted = await this.db.insert(s.budgets).values(row).returning();
    return toBudget(inserted[0] ?? row);
  }

  async update(id: string, input: UpdateBudgetInput): Promise<Budget | null> {
    const updated = await this.db
      .update(s.budgets)
      .set({
        name: input.name,
        scopeType: input.scopeType,
        scopeValue: input.scopeValue,
        amountUsd: input.amountUsd,
        period: input.period,
        thresholdsPct: input.thresholdsPct,
        notifyEmails: input.notifyEmails,
      })
      .where(eq(s.budgets.id, id))
      .returning();
    return updated[0] ? toBudget(updated[0]) : null;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(s.budgets).where(eq(s.budgets.id, id));
  }
}

function toBudget(row: typeof s.budgets.$inferSelect): Budget {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    scopeType: row.scopeType as Budget['scopeType'],
    scopeValue: row.scopeValue,
    amountUsd: row.amountUsd,
    period: row.period as Budget['period'],
    thresholdsPct: row.thresholdsPct as number[],
    notifyEmails: row.notifyEmails as string[],
    createdBy: row.createdBy,
    createdAt: toIsoString(row.createdAt),
  };
}

class PgUserPreferencesRepo implements UserPreferencesRepo {
  constructor(private db: Db) {}

  async get(userId: string): Promise<UserPreferencesValue | null> {
    const rows = await this.db
      .select()
      .from(s.userPreferences)
      .where(eq(s.userPreferences.userId, userId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      userId: row.userId,
      currency: row.currency,
      defaultWorkspaceId: row.defaultWorkspaceId,
      theme: row.theme,
      prefs: row.prefs as Record<string, unknown>,
      updatedAt: toIsoString(row.updatedAt),
    };
  }

  async upsert(value: UserPreferencesValue): Promise<UserPreferencesValue> {
    const row = {
      userId: value.userId,
      currency: value.currency,
      defaultWorkspaceId: value.defaultWorkspaceId,
      theme: value.theme,
      prefs: value.prefs,
      updatedAt: new Date(value.updatedAt),
    };
    await this.db
      .insert(s.userPreferences)
      .values(row)
      .onConflictDoUpdate({
        target: s.userPreferences.userId,
        set: {
          currency: row.currency,
          defaultWorkspaceId: row.defaultWorkspaceId,
          theme: row.theme,
          prefs: row.prefs,
          updatedAt: row.updatedAt,
        },
      });
    return value;
  }
}

class PgCachedAggregationsRepo implements CachedAggregationsRepo {
  constructor(private db: Db) {}

  async get(cacheKey: string): Promise<CachedAggregationValue | null> {
    const rows = await this.db
      .select()
      .from(s.cachedAggregations)
      .where(eq(s.cachedAggregations.cacheKey, cacheKey))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (new Date(row.expiresAt).getTime() < Date.now()) return null;
    return {
      cacheKey: row.cacheKey,
      queryHash: row.queryHash,
      payload: row.payload,
      computedAt: toIsoString(row.computedAt),
      expiresAt: toIsoString(row.expiresAt),
    };
  }

  async set(value: CachedAggregationValue): Promise<void> {
    const row = {
      cacheKey: value.cacheKey,
      queryHash: value.queryHash,
      payload: value.payload,
      computedAt: new Date(value.computedAt),
      expiresAt: new Date(value.expiresAt),
    };
    await this.db
      .insert(s.cachedAggregations)
      .values(row)
      .onConflictDoUpdate({
        target: s.cachedAggregations.cacheKey,
        set: {
          queryHash: row.queryHash,
          payload: row.payload,
          computedAt: row.computedAt,
          expiresAt: row.expiresAt,
        },
      });
  }

  async prune(now: string): Promise<number> {
    const result = await this.db.execute(
      sql`delete from cached_aggregations where expires_at < ${new Date(now)}`,
    );
    return result.rowCount ?? 0;
  }

  async clear(): Promise<number> {
    const result = await this.db.execute(sql`delete from cached_aggregations`);
    return result.rowCount ?? 0;
  }
}

class PgSetupStateRepo implements SetupStateRepo {
  constructor(private db: Db) {}

  async get(workspaceId: string): Promise<SetupStateValue | null> {
    const rows = await this.db
      .select()
      .from(s.setupState)
      .where(eq(s.setupState.workspaceId, workspaceId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      workspaceId: row.workspaceId,
      systemTablesOk: row.systemTablesOk,
      permissionsOk: row.permissionsOk,
      curConfigured: row.curConfigured,
      azureExportConfigured: row.azureExportConfigured,
      lastCheckedAt: toIsoString(row.lastCheckedAt),
      details: row.details as Record<string, unknown>,
    };
  }

  async upsert(value: SetupStateValue): Promise<SetupStateValue> {
    const row = {
      workspaceId: value.workspaceId,
      systemTablesOk: value.systemTablesOk,
      permissionsOk: value.permissionsOk,
      curConfigured: value.curConfigured,
      azureExportConfigured: value.azureExportConfigured,
      lastCheckedAt: new Date(value.lastCheckedAt),
      details: value.details,
    };
    await this.db
      .insert(s.setupState)
      .values(row)
      .onConflictDoUpdate({
        target: s.setupState.workspaceId,
        set: {
          systemTablesOk: row.systemTablesOk,
          permissionsOk: row.permissionsOk,
          curConfigured: row.curConfigured,
          azureExportConfigured: row.azureExportConfigured,
          lastCheckedAt: row.lastCheckedAt,
          details: row.details,
        },
      });
    return value;
  }

  async recordCheck(workspaceId: string, result: SetupCheckResult): Promise<void> {
    const existing = (await this.get(workspaceId)) ?? {
      workspaceId,
      systemTablesOk: false,
      permissionsOk: false,
      curConfigured: false,
      azureExportConfigured: false,
      lastCheckedAt: result.checkedAt,
      details: {},
    };

    const next: SetupStateValue = {
      ...existing,
      lastCheckedAt: result.checkedAt,
      details: { ...existing.details, [result.step]: result },
    };
    if (result.step === 'systemTables') next.systemTablesOk = result.status === 'ok';
    if (result.step === 'permissions') next.permissionsOk = result.status === 'ok';
    if (result.step === 'awsCur') next.curConfigured = result.status === 'ok';
    if (result.step === 'azureExport') next.azureExportConfigured = result.status === 'ok';
    await this.upsert(next);
  }

  async clear(): Promise<number> {
    const result = await this.db.execute(sql`delete from setup_state`);
    return result.rowCount ?? 0;
  }
}

class PgDataSourcesRepo implements DataSourcesRepo {
  constructor(private db: Db) {}

  async list(): Promise<DataSourceValue[]> {
    const rows = await this.db.select().from(s.dataSources);
    return rows.map(toDataSource);
  }

  async get(key: DataSourceKey): Promise<DataSourceValue | null> {
    const rows = await this.db
      .select()
      .from(s.dataSources)
      .where(
        and(
          eq(s.dataSources.providerName, key.providerName),
          eq(s.dataSources.accountId, key.accountId),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? toDataSource(row) : null;
  }

  async create(input: DataSourceCreateInput): Promise<DataSourceValue> {
    const inserted = await this.db
      .insert(s.dataSources)
      .values({
        name: input.name,
        providerName: input.providerName,
        accountId: input.accountId,
        tableName: input.tableName,
        focusVersion: input.focusVersion ?? null,
        pipelineId: input.pipelineId ?? null,
        enabled: input.enabled,
        config: input.config ?? {},
        updatedAt: new Date(),
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error('Failed to insert data source');
    return toDataSource(row);
  }

  async update(key: DataSourceKey, patch: DataSourceUpdatePatch): Promise<DataSourceValue> {
    const set: Partial<typeof s.dataSources.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.tableName !== undefined) set.tableName = patch.tableName;
    if (patch.focusVersion !== undefined) set.focusVersion = patch.focusVersion;
    if (patch.pipelineId !== undefined) set.pipelineId = patch.pipelineId;
    if (patch.enabled !== undefined) set.enabled = patch.enabled;
    if (patch.config !== undefined) set.config = patch.config;

    const updated = await this.db
      .update(s.dataSources)
      .set(set)
      .where(
        and(
          eq(s.dataSources.providerName, key.providerName),
          eq(s.dataSources.accountId, key.accountId),
        ),
      )
      .returning();
    const row = updated[0];
    if (!row) throw new Error(`Data source ${key.providerName}/${key.accountId} not found`);
    return toDataSource(row);
  }

  async delete(key: DataSourceKey): Promise<void> {
    await this.db
      .delete(s.dataSources)
      .where(
        and(
          eq(s.dataSources.providerName, key.providerName),
          eq(s.dataSources.accountId, key.accountId),
        ),
      );
  }

  async clear(): Promise<number> {
    const result = await this.db.execute(sql`delete from data_sources`);
    return result.rowCount ?? 0;
  }
}

function toDataSource(row: typeof s.dataSources.$inferSelect): DataSourceValue {
  return {
    name: row.name,
    providerName: row.providerName,
    accountId: row.accountId,
    tableName: row.tableName,
    focusVersion: row.focusVersion,
    pipelineId: row.pipelineId,
    enabled: row.enabled,
    config: row.config as Record<string, unknown>,
    updatedAt: toIsoString(row.updatedAt),
  };
}

class PgWorkspacesRepo implements WorkspacesRepo {
  constructor(private db: Db) {}

  async get(id: string): Promise<WorkspaceValue | null> {
    const rows = await this.db.select().from(s.workspaces).where(eq(s.workspaces.id, id)).limit(1);
    const row = rows[0];
    return row ? toWorkspace(row) : null;
  }

  async list(): Promise<WorkspaceValue[]> {
    const rows = await this.db.select().from(s.workspaces).orderBy(s.workspaces.id);
    return rows.map(toWorkspace);
  }

  async upsert(id: string, domain: string): Promise<WorkspaceValue> {
    const updatedAt = new Date();
    await this.db.insert(s.workspaces).values({ id, domain, updatedAt }).onConflictDoUpdate({
      target: s.workspaces.id,
      set: { domain, updatedAt },
    });
    return { id, domain, updatedAt: updatedAt.toISOString() };
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(s.workspaces).where(eq(s.workspaces.id, id));
  }

  async clear(): Promise<number> {
    const result = await this.db.execute(sql`delete from workspaces`);
    return result.rowCount ?? 0;
  }
}

function toWorkspace(row: typeof s.workspaces.$inferSelect): WorkspaceValue {
  return {
    id: row.id,
    domain: row.domain,
    updatedAt: toIsoString(row.updatedAt),
  };
}

class PgPricingDataRepo implements PricingDataRepo {
  constructor(private db: Db) {}

  async get(provider: string, service: string): Promise<PricingDataValue | null> {
    const rows = await this.db
      .select()
      .from(s.pricingData)
      .where(and(eq(s.pricingData.provider, provider), eq(s.pricingData.service, service)))
      .limit(1);
    const row = rows[0];
    return row ? toPricingData(row) : null;
  }

  async getById(id: string): Promise<PricingDataValue | null> {
    const rows = await this.db
      .select()
      .from(s.pricingData)
      .where(eq(s.pricingData.id, id))
      .limit(1);
    const row = rows[0];
    return row ? toPricingData(row) : null;
  }

  async getByNotebookId(notebookId: string): Promise<PricingDataValue | null> {
    const rows = await this.db
      .select()
      .from(s.pricingData)
      .where(eq(s.pricingData.notebookId, notebookId))
      .limit(1);
    const row = rows[0];
    return row ? toPricingData(row) : null;
  }

  async upsert(input: PricingDataUpsertInput): Promise<PricingDataValue> {
    const row = {
      id: input.id,
      provider: input.provider,
      service: input.service,
      tableName: input.table,
      rawDataTable: input.rawDataTable,
      rawDataPath: input.rawDataPath,
      notebookPath: input.notebookPath,
      notebookId: input.notebookId,
      metadata: input.metadata,
      runId: input.runId,
      runStatus: input.runStatus,
      runUrl: input.runUrl,
      runStartedAt: timestampStringOrNullForPg(input.runStartedAt),
      runFinishedAt: timestampStringOrNullForPg(input.runFinishedAt),
      runCheckedAt: timestampStringOrNullForPg(input.runCheckedAt),
      updatedAt: new Date(),
    };
    const inserted = await this.db
      .insert(s.pricingData)
      .values(row)
      .onConflictDoUpdate({
        target: s.pricingData.id,
        set: {
          provider: row.provider,
          service: row.service,
          tableName: row.tableName,
          rawDataTable: row.rawDataTable,
          rawDataPath: row.rawDataPath,
          notebookPath: row.notebookPath,
          notebookId: row.notebookId,
          metadata: row.metadata,
          runId: row.runId,
          runStatus: row.runStatus,
          runUrl: row.runUrl,
          runStartedAt: row.runStartedAt,
          runFinishedAt: row.runFinishedAt,
          runCheckedAt: row.runCheckedAt,
          updatedAt: row.updatedAt,
        },
      })
      .returning();
    return toPricingData(inserted[0] ?? row);
  }

  async updateRun(id: string, patch: PricingDataRunPatch): Promise<PricingDataValue | null> {
    const updated = await this.db
      .update(s.pricingData)
      .set({
        runId: patch.runId,
        runStatus: patch.runStatus,
        runUrl: patch.runUrl,
        runStartedAt: timestampStringOrNullForPg(patch.runStartedAt),
        runFinishedAt: timestampStringOrNullForPg(patch.runFinishedAt),
        runCheckedAt: timestampStringOrNullForPg(patch.runCheckedAt),
        updatedAt: new Date(),
      })
      .where(eq(s.pricingData.id, id))
      .returning();
    const row = updated[0];
    return row ? toPricingData(row) : null;
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await this.db.delete(s.pricingData).where(eq(s.pricingData.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async clear(): Promise<number> {
    const result = await this.db.execute(sql`delete from pricing_data`);
    return result.rowCount ?? 0;
  }
}

function toPricingData(row: typeof s.pricingData.$inferSelect): PricingDataValue {
  return {
    id: row.id,
    provider: row.provider,
    service: row.service,
    table: row.tableName,
    rawDataTable: row.rawDataTable,
    rawDataPath: row.rawDataPath,
    notebookPath: row.notebookPath,
    notebookId: row.notebookId,
    metadata: row.metadata as Record<string, unknown>,
    runId: row.runId,
    runStatus: row.runStatus as PricingDataValue['runStatus'],
    runUrl: row.runUrl,
    runStartedAt: toIsoStringOrNull(row.runStartedAt),
    runFinishedAt: toIsoStringOrNull(row.runFinishedAt),
    runCheckedAt: toIsoStringOrNull(row.runCheckedAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

class PgAppSettingsRepo implements AppSettingsRepo {
  constructor(private db: Db) {}

  async get(key: string): Promise<AppSettingValue | null> {
    const rows = await this.db
      .select()
      .from(s.appSettings)
      .where(eq(s.appSettings.key, key))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { key: row.key, value: row.value, updatedAt: toIsoString(row.updatedAt) };
  }

  async list(): Promise<AppSettingValue[]> {
    const rows = await this.db.select().from(s.appSettings);
    return rows.map((row) => ({
      key: row.key,
      value: row.value,
      updatedAt: toIsoString(row.updatedAt),
    }));
  }

  async upsert(key: string, value: string): Promise<AppSettingValue> {
    const updatedAt = new Date();
    await this.db.insert(s.appSettings).values({ key, value, updatedAt }).onConflictDoUpdate({
      target: s.appSettings.key,
      set: { value, updatedAt },
    });
    return { key, value, updatedAt: updatedAt.toISOString() };
  }

  async delete(key: string): Promise<void> {
    await this.db.delete(s.appSettings).where(eq(s.appSettings.key, key));
  }

  async deleteMany(keys: readonly string[]): Promise<number> {
    if (keys.length === 0) return 0;
    const result = await this.db.delete(s.appSettings).where(inArray(s.appSettings.key, [...keys]));
    return result.rowCount ?? 0;
  }
}

class PgGenieSpacesRepo implements GenieSpacesRepo {
  constructor(private db: Db) {}

  async get(purpose: string): Promise<GenieSpaceValue | null> {
    const rows = await this.db
      .select()
      .from(s.genieSpaces)
      .where(eq(s.genieSpaces.purpose, purpose))
      .limit(1);
    const row = rows[0];
    return row ? toGenieSpace(row) : null;
  }

  async list(): Promise<GenieSpaceValue[]> {
    const rows = await this.db.select().from(s.genieSpaces).orderBy(s.genieSpaces.purpose);
    return rows.map(toGenieSpace);
  }

  async upsert(purpose: string, spaceId: string): Promise<GenieSpaceValue> {
    const now = new Date();
    const existing = await this.get(purpose);
    const row = {
      purpose,
      spaceId,
      createdAt: existing ? new Date(existing.createdAt) : now,
      updatedAt: now,
    };
    await this.db
      .insert(s.genieSpaces)
      .values(row)
      .onConflictDoUpdate({
        target: s.genieSpaces.purpose,
        set: { spaceId, updatedAt: now },
      });
    return toGenieSpace(row);
  }

  async delete(purpose: string): Promise<void> {
    await this.db.delete(s.genieSpaces).where(eq(s.genieSpaces.purpose, purpose));
  }

  async clear(): Promise<number> {
    const result = await this.db.execute(sql`delete from genie_spaces`);
    return result.rowCount ?? 0;
  }
}

function toGenieSpace(row: typeof s.genieSpaces.$inferSelect): GenieSpaceValue {
  return {
    purpose: row.purpose,
    spaceId: row.spaceId,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

export function timestampStringOrNullForPg(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function toIsoStringOrNull(value: Date | string | null): string | null {
  return value ? toIsoString(value) : null;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function installSearchPath(pool: Pool, schemaName: string): void {
  const searchPathSql = `set search_path to ${quoteIdent(schemaName)}`;
  pool.query = (async (...args: Parameters<Pool['query']>) => {
    const lastArg = args.at(-1);
    const callback =
      typeof lastArg === 'function'
        ? (lastArg as (err: Error | null, result?: unknown) => void)
        : undefined;
    const queryArgs = callback ? args.slice(0, -1) : args;
    const client = await pool.connect();
    try {
      await client.query(searchPathSql);
      const result = await client.query(...(queryArgs as Parameters<typeof client.query>));
      if (callback) {
        callback(null, result);
        return;
      }
      return result;
    } catch (err) {
      if (callback) {
        callback(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      throw err;
    } finally {
      client.release();
    }
  }) as Pool['query'];

  pool.on('error', (err) => {
    logger.error({ err, schemaName }, 'Lakebase pool error');
  });
  logger.debug({ schemaName }, 'Installed Lakebase search_path query wrapper');
}

function resolveLakebaseSchema(env: Env): string {
  const appName = env.PGAPPNAME ?? env.DATABRICKS_APP_NAME;
  const servicePrincipalId = env.PGUSER ?? env.DATABRICKS_CLIENT_ID;
  if (!appName || !servicePrincipalId) {
    throw new Error(
      'PGAPPNAME and PGUSER are required to resolve the Databricks Apps Lakebase schema.',
    );
  }
  return `${appName}_schema_${servicePrincipalId.replaceAll('-', '')}`;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
