import { Router, type Response } from 'express';
import { settingsToRecord, type DatabaseClient } from '@finlake/db';
import { randomUUID } from 'node:crypto';
import {
  DATA_SOURCE_TEMPLATES,
  DataSourceCreateBodySchema,
  DataSourceKeySchema,
  DataSourceSetupBodySchema,
  DataSourceUpdateBodySchema,
  DEFAULT_DATABRICKS_ACCOUNT_ID,
  isAwsProvider,
  isCustomProvider,
  isDatabricksProvider,
  isGcpProvider,
  GCP_DEMO_ACCOUNT_ID,
  GCP_SOURCE_KIND_TAGGED_DEMO,
  gcpDemoSourceIdFromParts,
  isSnowflakeProvider,
  isSnowflakeUsageInCurrencyDailySource,
  normalizeGcpBillingAccountId,
  snowflakeSourceIdFromParts,
  toDataSourceKey,
  type DataSourceKey,
  type Env,
} from '@finlake/shared';
import {
  LEGACY_SHARED_PIPELINE_SETTING_KEYS,
  SHARED_PIPELINE_SETTING_KEYS,
  runDataSourceJob,
  setupFocusDataSource,
  syncSharedFocusPipeline,
} from '../services/dataSourceSetup.js';
import { buildAppWorkspaceClient } from '../services/statementExecution.js';
import { DataSourceSetupError } from '../services/dataSourceErrors.js';
import {
  CustomDataSourceOptionsError,
  listCustomDataSourceOptions,
} from '../services/customDataSourceOptions.js';
import {
  PipelineRunPermissionError,
  createAppServicePrincipalPipelineRunAsserter,
} from '../services/pipelinePermissions.js';

const AWS_SOURCE_LOCKED_CONFIG_KEYS = [
  'awsAccountId',
  'externalLocationName',
  'externalLocationUrl',
  'storageCredentialName',
  's3Bucket',
  'exportName',
  's3Prefix',
  's3Region',
];

const SNOWFLAKE_SOURCE_LOCKED_CONFIG_KEYS = [
  'sourceId',
  'sourceCatalog',
  'sourceSchema',
  'sourceTable',
  'sourceFqn',
];

const GCP_SOURCE_LOCKED_CONFIG_KEYS = [
  'billingAccountId',
  'sourceKind',
  'sourceId',
  'sourceCatalog',
  'sourceSchema',
  'sourceTable',
  'sourceFqn',
];

export interface DataSourcesRouterDeps {
  assertPipelineCanRun?: (pipelineId: string) => Promise<void>;
  syncSharedPipeline?: () => Promise<void>;
  cleanupSharedPipeline?: () => Promise<void>;
}

export function dataSourcesRouter(
  db: DatabaseClient,
  env: Env,
  deps: DataSourcesRouterDeps = {},
): Router {
  const router = Router();
  const assertPipelineCanRun =
    deps.assertPipelineCanRun ?? createAppServicePrincipalPipelineRunAsserter(env);
  const syncSharedPipeline: () => Promise<void> =
    deps.syncSharedPipeline ??
    (async () => {
      await syncSharedFocusPipeline(env, db);
    });
  const cleanupSharedPipeline: () => Promise<void> =
    deps.cleanupSharedPipeline ??
    (async () => {
      await cleanupSharedPipelineAssets(env, db);
    });

  router.get('/templates', (_req, res) => {
    res.json({ items: DATA_SOURCE_TEMPLATES });
  });

  router.get('/custom-options', async (_req, res, next) => {
    try {
      res.json(await listCustomDataSourceOptions(db, env));
    } catch (err) {
      if (err instanceof CustomDataSourceOptionsError) {
        res.status(err.statusCode).json({ error: { message: err.message } });
        return;
      }
      next(err);
    }
  });

  router.get('/configurations', async (_req, res, next) => {
    try {
      const items = await db.repos.dataSources.list();
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });

  router.post('/configurations', async (req, res, next) => {
    try {
      const parsed = DataSourceCreateBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { message: 'Invalid input', issues: parsed.error.issues } });
        return;
      }
      const template = DATA_SOURCE_TEMPLATES.find((tpl) => tpl.id === parsed.data.templateId);
      if (!template || !template.available) {
        res.status(400).json({ error: { message: 'Invalid templateId' } });
        return;
      }
      const isCustomTemplate = parsed.data.templateId === 'custom';
      const pipelineId = parsed.data.pipelineId ?? null;
      if (isGcpProvider(parsed.data.providerName) && parsed.data.enabled === true) {
        res.status(409).json({
          error: { message: 'Google Cloud sources must be enabled through setup validation.' },
        });
        return;
      }
      if (isCustomTemplate && (await customTableAlreadyRegistered(db, parsed.data.tableName))) {
        res.status(409).json({
          error: {
            message: `Custom data source table is already registered: ${parsed.data.tableName}`,
          },
        });
        return;
      }
      if (isCustomTemplate && parsed.data.enabled === true && pipelineId) {
        await assertPipelineCanRun(pipelineId);
      }
      if (isCustomTemplate && parsed.data.enabled === true && !pipelineId) {
        res.status(409).json({
          error: { message: 'Custom data source cannot be enabled without a pipelineId.' },
        });
        return;
      }
      let config: Record<string, unknown>;
      try {
        config = configForCreate(
          parsed.data.providerName,
          parsed.data.config ?? {},
          parsed.data.accountId ?? '',
        );
      } catch (err) {
        res.status(400).json({ error: { message: (err as Error).message } });
        return;
      }
      const accountId = accountIdForCreate(
        isCustomTemplate,
        parsed.data.providerName,
        parsed.data.accountId,
        config,
      );
      if (!accountId) {
        res.status(400).json({ error: { message: 'accountId is required' } });
        return;
      }
      const isTaggedGcpDemo =
        isGcpProvider(parsed.data.providerName) &&
        config.sourceKind === GCP_SOURCE_KIND_TAGGED_DEMO;
      let created;
      try {
        created = await db.repos.dataSources.create({
          name: parsed.data.name,
          providerName: parsed.data.providerName,
          accountId,
          tableName: parsed.data.tableName,
          focusVersion: template.focus_version,
          pipelineId,
          enabled: parsed.data.enabled ?? false,
          config,
        });
      } catch (err) {
        if (
          isTaggedGcpDemo &&
          (await db.repos.dataSources.get({
            providerName: parsed.data.providerName,
            accountId: GCP_DEMO_ACCOUNT_ID,
          }))
        ) {
          res.status(409).json({
            error: { message: 'Only one Google Cloud synthetic demo source can be registered.' },
          });
          return;
        }
        if (isCustomTableUniqueViolation(err)) {
          res.status(409).json({
            error: {
              message: `Custom data source table is already registered: ${parsed.data.tableName}`,
            },
          });
          return;
        }
        throw err;
      }
      const needsPipelineSync = sourceNeedsPipelineSync(created);
      if (needsPipelineSync) {
        try {
          await syncSharedPipelineIfAnyEnabled(db, syncSharedPipeline, cleanupSharedPipeline);
        } catch (err) {
          try {
            await db.repos.dataSources.delete({
              providerName: created.providerName,
              accountId: created.accountId,
            });
          } catch (cleanupErr) {
            console.warn(
              `[dataSources] Failed to delete DB row ${created.providerName}/${created.accountId} after shared pipeline sync failure: ${(cleanupErr as Error).message}`,
            );
          }
          throw err;
        }
      }
      if (!needsPipelineSync) {
        res.status(201).json(created);
        return;
      }
      const refreshed = await db.repos.dataSources.get({
        providerName: created.providerName,
        accountId: created.accountId,
      });
      if (!refreshed) {
        res.status(409).json({
          error: {
            message:
              'Data source was deleted after pipeline synchronization completed. Generated Lakeflow assets may require cleanup.',
          },
        });
        return;
      }
      res.status(201).json(refreshed);
    } catch (err) {
      if (sendPipelineRunPermissionError(err, res)) return;
      next(err);
    }
  });

  router.get('/configurations/:providerName/:accountId', async (req, res, next) => {
    try {
      const key = parseDataSourceKey(req.params);
      if (!key) {
        res.status(400).json({ error: { message: 'Invalid data source key' } });
        return;
      }
      const row = await db.repos.dataSources.get(key);
      if (!row) {
        res.status(404).json({ error: { message: 'Not found' } });
        return;
      }
      res.json(row);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/configurations/:providerName/:accountId', async (req, res, next) => {
    try {
      const key = parseDataSourceKey(req.params);
      if (!key) {
        res.status(400).json({ error: { message: 'Invalid data source key' } });
        return;
      }
      const parsed = DataSourceUpdateBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { message: 'Invalid input', issues: parsed.error.issues } });
        return;
      }
      const existing = await db.repos.dataSources.get(key);
      if (!existing) {
        res.status(404).json({ error: { message: 'Not found' } });
        return;
      }
      if (
        isGcpProvider(existing.providerName) &&
        parsed.data.enabled === true &&
        !existing.enabled
      ) {
        res.status(409).json({
          error: { message: 'Google Cloud sources must be enabled through setup validation.' },
        });
        return;
      }
      const lockedKeys = registeredSourceLockedConfigKeys(existing);
      if (parsed.data.config && lockedKeys.length > 0) {
        const changedKeys = lockedKeys.filter(
          (key) =>
            parsed.data.config?.[key] !== undefined &&
            !sameJsonValue(existing.config[key], parsed.data.config[key]),
        );
        if (changedKeys.length > 0) {
          res.status(409).json({
            error: {
              message: `Registered ${sourceProviderLabel(existing.providerName)} source settings cannot be changed: ${changedKeys.join(', ')}`,
            },
          });
          return;
        }
      }
      const updatePatch =
        parsed.data.config && lockedKeys.length > 0
          ? { ...parsed.data, config: { ...existing.config, ...parsed.data.config } }
          : parsed.data;
      const nextCandidate = { ...existing, ...updatePatch };
      if (isSnowflakeProvider(existing.providerName) && nextCandidate.enabled) {
        const configError = snowflakeSourceConfigError(nextCandidate.config);
        if (configError) {
          res.status(409).json({ error: { message: configError } });
          return;
        }
      }
      if (
        isCustomProvider(existing.providerName) &&
        updatePatch.tableName !== undefined &&
        updatePatch.tableName !== existing.tableName &&
        (await customTableAlreadyRegistered(db, updatePatch.tableName, key))
      ) {
        res.status(409).json({
          error: {
            message: `Custom data source table is already registered: ${updatePatch.tableName}`,
          },
        });
        return;
      }
      if (
        isCustomProvider(existing.providerName) &&
        nextCandidate.enabled &&
        !nextCandidate.pipelineId
      ) {
        res.status(409).json({
          error: { message: 'Custom data source cannot be enabled without a pipelineId.' },
        });
        return;
      }
      const pipelineIdToCheck = pipelineIdForRunPermissionCheck(
        existing,
        nextCandidate,
        updatePatch,
      );
      if (pipelineIdToCheck) {
        await assertPipelineCanRun(pipelineIdToCheck);
      }
      const updated = await db.repos.dataSources.update(key, updatePatch);
      if (sourceUpdateNeedsPipelineSync(existing, updated, updatePatch)) {
        try {
          await syncSharedPipelineIfAnyEnabled(db, syncSharedPipeline, cleanupSharedPipeline);
        } catch (err) {
          try {
            await restoreDataSource(db, key, existing, updated, updatePatch);
          } catch (restoreErr) {
            console.warn(
              `[dataSources] Failed to restore DB row ${key.providerName}/${key.accountId} after shared pipeline sync failure: ${(restoreErr as Error).message}`,
            );
          }
          throw err;
        }
      }
      res.json(updated);
    } catch (err) {
      if (sendPipelineRunPermissionError(err, res)) return;
      next(err);
    }
  });

  router.delete('/configurations/:providerName/:accountId', async (req, res, next) => {
    try {
      const key = parseDataSourceKey(req.params);
      if (!key) {
        res.status(400).json({ error: { message: 'Invalid data source key' } });
        return;
      }
      const existing = await db.repos.dataSources.get(key);
      if (!existing) {
        res.status(404).json({ error: { message: 'Not found' } });
        return;
      }
      await db.repos.dataSources.delete(key);
      if (existing.enabled) {
        try {
          await syncSharedPipelineIfAnyEnabled(db, syncSharedPipeline, cleanupSharedPipeline);
        } catch (err) {
          console.warn(
            `[dataSources] Deleted DB row ${key.providerName}/${key.accountId} but failed to refresh the shared pipeline: ${(err as Error).message}`,
          );
        }
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.post('/configurations/:providerName/:accountId/setup', async (req, res, next) => {
    try {
      const key = parseDataSourceKey(req.params);
      if (!key) {
        res.status(400).json({ error: { message: 'Invalid data source key' } });
        return;
      }
      const parsed = DataSourceSetupBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: { message: 'Invalid input', issues: parsed.error.issues } });
        return;
      }
      const result = await setupFocusDataSource(env, db, req.user?.accessToken, key, parsed.data);
      res.json(result);
    } catch (err) {
      if (err instanceof DataSourceSetupError) {
        res
          .status(err.statusCode)
          .json({ error: { message: err.message, step: err.step ?? null } });
        return;
      }
      next(err);
    }
  });

  router.post('/configurations/:providerName/:accountId/run', async (req, res, next) => {
    try {
      const key = parseDataSourceKey(req.params);
      if (!key) {
        res.status(400).json({ error: { message: 'Invalid data source key' } });
        return;
      }
      const result = await runDataSourceJob(env, db, req.user?.accessToken, key);
      res.json(result);
    } catch (err) {
      if (err instanceof DataSourceSetupError) {
        res.status(err.statusCode).json({ error: { message: err.message } });
        return;
      }
      next(err);
    }
  });

  return router;
}

function parseDataSourceKey(params: {
  providerName?: string;
  accountId?: string;
}): DataSourceKey | null {
  const parsed = DataSourceKeySchema.safeParse({
    providerName: params.providerName,
    accountId: params.accountId,
  });
  return parsed.success ? parsed.data : null;
}

function accountIdForCreate(
  isCustomTemplate: boolean,
  providerName: string,
  accountId: string | undefined,
  config: Record<string, unknown>,
): string | null {
  if (isCustomTemplate) {
    return `custom_${randomUUID()}`;
  }
  if (isSnowflakeProvider(providerName)) {
    return nonEmptyConfigString(config, 'sourceId');
  }
  if (isGcpProvider(providerName) && config.sourceKind === GCP_SOURCE_KIND_TAGGED_DEMO) {
    return GCP_DEMO_ACCOUNT_ID;
  }
  const trimmedAccountId = accountId?.trim();
  if (trimmedAccountId) {
    if (isGcpProvider(providerName)) return normalizeGcpBillingAccountId(trimmedAccountId);
    return trimmedAccountId;
  }
  return isDatabricksProvider(providerName) ? DEFAULT_DATABRICKS_ACCOUNT_ID : null;
}

function configForCreate(
  providerName: string,
  config: Record<string, unknown>,
  accountIdFallback: string,
): Record<string, unknown> {
  if (isGcpProvider(providerName)) {
    if (config.sourceKind === GCP_SOURCE_KIND_TAGGED_DEMO) {
      const sourceCatalog = nonEmptyConfigString(config, 'sourceCatalog');
      const sourceSchema = nonEmptyConfigString(config, 'sourceSchema');
      const sourceTable = nonEmptyConfigString(config, 'sourceTable');
      if (!sourceCatalog || !sourceSchema || !sourceTable) {
        throw new Error(
          'Google Cloud demo sourceCatalog, sourceSchema, and sourceTable are required.',
        );
      }
      return {
        ...config,
        sourceId: gcpDemoSourceIdFromParts(sourceCatalog, sourceSchema, sourceTable),
      };
    }
    const billingAccountId =
      typeof config.billingAccountId === 'string' && config.billingAccountId.trim().length > 0
        ? config.billingAccountId
        : accountIdFallback;
    return {
      ...config,
      ...(billingAccountId
        ? { billingAccountId: normalizeGcpBillingAccountId(billingAccountId) }
        : {}),
    };
  }
  if (isSnowflakeProvider(providerName)) {
    const sourceCatalog = nonEmptyConfigString(config, 'sourceCatalog');
    const sourceSchema = nonEmptyConfigString(config, 'sourceSchema');
    const sourceTable = nonEmptyConfigString(config, 'sourceTable');
    if (!sourceCatalog || !sourceSchema || !sourceTable) {
      throw new Error('Snowflake sourceCatalog, sourceSchema, and sourceTable are required.');
    }
    if (!isSnowflakeUsageInCurrencyDailySource(sourceSchema, sourceTable)) {
      throw new Error('Snowflake source table must be ORGANIZATION_USAGE.USAGE_IN_CURRENCY_DAILY.');
    }
    const sourceId = snowflakeSourceIdFromParts(sourceCatalog, sourceSchema, sourceTable);
    return {
      ...config,
      sourceCatalog,
      sourceSchema,
      sourceTable,
      sourceFqn: `${sourceCatalog}.${sourceSchema}.${sourceTable}`,
      sourceId,
    };
  }
  return config;
}

function nonEmptyConfigString(config: Record<string, unknown>, key: string): string | null {
  const value = config[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isRegisteredAwsSource(source: {
  providerName: string;
  config: Record<string, unknown>;
}): boolean {
  if (!isAwsProvider(source.providerName)) return false;
  return ['awsAccountId', 'externalLocationName', 'exportName', 's3Prefix'].every((key) => {
    const value = source.config[key];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

function isRegisteredSnowflakeSource(source: {
  providerName: string;
  config: Record<string, unknown>;
}): boolean {
  if (!isSnowflakeProvider(source.providerName)) return false;
  return snowflakeSourceConfigError(source.config) === null;
}

function isRegisteredGcpSource(source: {
  providerName: string;
  config: Record<string, unknown>;
}): boolean {
  if (!isGcpProvider(source.providerName)) return false;
  return ['sourceCatalog', 'sourceSchema', 'sourceTable'].every(
    (key) => nonEmptyConfigString(source.config, key) !== null,
  );
}

function snowflakeSourceConfigError(config: Record<string, unknown>): string | null {
  const sourceCatalog = nonEmptyConfigString(config, 'sourceCatalog');
  const sourceSchema = nonEmptyConfigString(config, 'sourceSchema');
  const sourceTable = nonEmptyConfigString(config, 'sourceTable');
  const sourceId = nonEmptyConfigString(config, 'sourceId');
  if (!sourceCatalog || !sourceSchema || !sourceTable || !sourceId) {
    return 'Snowflake sourceCatalog, sourceSchema, sourceTable, and sourceId are required.';
  }
  if (!isSnowflakeUsageInCurrencyDailySource(sourceSchema, sourceTable)) {
    return 'Snowflake source table must be ORGANIZATION_USAGE.USAGE_IN_CURRENCY_DAILY.';
  }
  return null;
}

function registeredSourceLockedConfigKeys(source: {
  providerName: string;
  config: Record<string, unknown>;
}): string[] {
  if (isRegisteredAwsSource(source)) return AWS_SOURCE_LOCKED_CONFIG_KEYS;
  if (isRegisteredGcpSource(source)) return GCP_SOURCE_LOCKED_CONFIG_KEYS;
  if (isRegisteredSnowflakeSource(source)) return SNOWFLAKE_SOURCE_LOCKED_CONFIG_KEYS;
  return [];
}

function sourceProviderLabel(providerName: string): string {
  if (isAwsProvider(providerName)) return 'AWS';
  if (isGcpProvider(providerName)) return 'Google Cloud';
  if (isSnowflakeProvider(providerName)) return 'Snowflake';
  return providerName;
}

function isCustomTableUniqueViolation(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('data_sources_custom_table_unique');
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  if (!isJsonComparable(left) || !isJsonComparable(right)) return Object.is(left, right);
  return JSON.stringify(canonicalJsonValue(left)) === JSON.stringify(canonicalJsonValue(right));
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalJsonValue);
  }
  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([leftKey], [rightKey]) => (leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0))
        .map(([key, nestedValue]) => [key, canonicalJsonValue(nestedValue)]),
    );
  }
  return value;
}

function isJsonComparable(value: unknown): boolean {
  if (value === null) return true;
  if (Array.isArray(value)) return value.every(isJsonComparable);
  if (isPlainRecord(value)) return Object.values(value).every(isJsonComparable);
  return ['boolean', 'number', 'string'].includes(typeof value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

async function customTableAlreadyRegistered(
  db: DatabaseClient,
  tableName: string,
  exceptKey?: DataSourceKey,
): Promise<boolean> {
  const normalizedTableName = normalizeTableNameForComparison(tableName);
  const existingSources = await db.repos.dataSources.list();
  return existingSources.some(
    (source) =>
      isCustomProvider(source.providerName) &&
      !(
        exceptKey &&
        source.providerName === exceptKey.providerName &&
        source.accountId === exceptKey.accountId
      ) &&
      normalizeTableNameForComparison(source.tableName) === normalizedTableName,
  );
}

function normalizeTableNameForComparison(tableName: string): string {
  return tableName
    .split('.')
    .map((part) => part.trim().toLowerCase())
    .join('.');
}

function sendPipelineRunPermissionError(err: unknown, res: Response): boolean {
  if (!(err instanceof PipelineRunPermissionError)) return false;
  res.status(err.statusCode).json({ error: { message: err.message } });
  return true;
}

function pipelineIdForRunPermissionCheck(
  previous: {
    providerName: string;
    tableName: string;
    pipelineId: string | null;
    enabled: boolean;
  },
  next: {
    pipelineId: string | null;
    enabled: boolean;
  },
  patch: {
    name?: string;
    tableName?: string;
    pipelineId?: string | null;
    enabled?: boolean;
    config?: Record<string, unknown>;
  },
): string | null {
  if (!isCustomProvider(previous.providerName) || !next.pipelineId) return null;
  if (!next.enabled) return null;
  const pipelineChanged =
    patch.pipelineId !== undefined && patch.pipelineId !== previous.pipelineId;
  if (pipelineChanged) return next.pipelineId;

  const enabling = patch.enabled === true && !previous.enabled;
  return enabling ? next.pipelineId : null;
}

function sourceNeedsPipelineSync(source: { providerName: string; enabled: boolean }): boolean {
  return source.enabled;
}

function sourceUpdateNeedsPipelineSync(
  previous: {
    providerName: string;
    tableName: string;
    pipelineId: string | null;
    enabled: boolean;
    config: Record<string, unknown>;
  },
  next: { enabled: boolean },
  patch: {
    tableName?: string;
    pipelineId?: string | null;
    enabled?: boolean;
    config?: Record<string, unknown>;
  },
): boolean {
  const enabledChanged = patch.enabled !== undefined && patch.enabled !== previous.enabled;
  if (enabledChanged) return true;
  if (!next.enabled) return false;

  const tableNameChanged = patch.tableName !== undefined && patch.tableName !== previous.tableName;
  if (!isCustomProvider(previous.providerName)) {
    const configChanged =
      patch.config !== undefined && !sameJsonValue(patch.config, previous.config);
    const pipelineChanged =
      patch.pipelineId !== undefined && patch.pipelineId !== previous.pipelineId;
    return tableNameChanged || configChanged || pipelineChanged;
  }
  const pipelineChanged =
    patch.pipelineId !== undefined && patch.pipelineId !== previous.pipelineId;
  return tableNameChanged || pipelineChanged;
}

async function syncSharedPipelineIfAnyEnabled(
  db: DatabaseClient,
  syncSharedPipeline: () => Promise<void>,
  cleanupSharedPipeline: () => Promise<void>,
): Promise<void> {
  const enabledSources = (await db.repos.dataSources.list()).filter((source) => source.enabled);
  if (enabledSources.length === 0) {
    await cleanupSharedPipeline();
    return;
  }
  await syncSharedPipeline();
}

async function cleanupSharedPipelineAssets(env: Env, db: DatabaseClient): Promise<void> {
  const [settingsRows, sources] = await Promise.all([
    db.repos.appSettings.list(),
    db.repos.dataSources.list(),
  ]);
  const settings = settingsToRecord(settingsRows);
  const jobId = numberSetting(
    settings[SHARED_PIPELINE_SETTING_KEYS.jobId] ??
      settings[LEGACY_SHARED_PIPELINE_SETTING_KEYS.jobId],
  );
  const pipelineIds = new Set<string>();
  addPipelineId(
    pipelineIds,
    settings[SHARED_PIPELINE_SETTING_KEYS.pipelineId] ??
      settings[LEGACY_SHARED_PIPELINE_SETTING_KEYS.pipelineId],
  );
  for (const source of sources) {
    if (!isCustomProvider(source.providerName)) addPipelineId(pipelineIds, source.pipelineId);
  }
  const workspaceRoot = settings[SHARED_PIPELINE_SETTING_KEYS.workspaceRoot]?.trim();
  const ops: Promise<unknown>[] = [];
  const needsWorkspaceClient = jobId !== null || pipelineIds.size > 0 || Boolean(workspaceRoot);
  if (needsWorkspaceClient) {
    const wc = buildAppWorkspaceClient(env);
    if (!wc) {
      throw new Error(
        'Failed to build Databricks app service principal workspace client for shared pipeline cleanup.',
      );
    }
    if (jobId !== null) ops.push(wc.jobs.delete({ job_id: jobId }).catch(() => {}));
    for (const pipelineId of pipelineIds) {
      ops.push(wc.pipelines.delete({ pipeline_id: pipelineId }).catch(() => {}));
    }
    if (workspaceRoot) {
      ops.push(wc.workspace.delete({ path: workspaceRoot, recursive: true }).catch(() => {}));
    }
  }
  await Promise.allSettled(ops);
  await Promise.all([
    db.repos.appSettings.delete(SHARED_PIPELINE_SETTING_KEYS.jobId),
    db.repos.appSettings.delete(SHARED_PIPELINE_SETTING_KEYS.pipelineId),
    db.repos.appSettings.delete(SHARED_PIPELINE_SETTING_KEYS.workspaceRoot),
    db.repos.appSettings.delete(LEGACY_SHARED_PIPELINE_SETTING_KEYS.jobId),
    db.repos.appSettings.delete(LEGACY_SHARED_PIPELINE_SETTING_KEYS.pipelineId),
    ...sources
      .filter((source) => !isCustomProvider(source.providerName) && source.pipelineId)
      .map((source) => db.repos.dataSources.update(toDataSourceKey(source), { pipelineId: null })),
  ]);
}

function addPipelineId(target: Set<string>, value: string | null | undefined): void {
  const trimmed = value?.trim();
  if (trimmed) target.add(trimmed);
}

function numberSetting(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function restoreDataSource(
  db: DatabaseClient,
  key: DataSourceKey,
  source: {
    name: string;
    tableName: string;
    pipelineId: string | null;
    enabled: boolean;
    config: Record<string, unknown>;
  },
  updated: {
    name: string;
    tableName: string;
    pipelineId: string | null;
    enabled: boolean;
    config: Record<string, unknown>;
  },
  patch: {
    name?: string;
    tableName?: string;
    pipelineId?: string | null;
    enabled?: boolean;
    config?: Record<string, unknown>;
  },
): Promise<void> {
  const current = await db.repos.dataSources.get(key);
  if (!current) return;
  if (!patchStillMatchesUpdated(current, updated, patch)) return;
  const rollback: typeof patch = {};
  if (patch.name !== undefined) rollback.name = source.name;
  if (patch.tableName !== undefined) rollback.tableName = source.tableName;
  if (patch.pipelineId !== undefined) rollback.pipelineId = source.pipelineId;
  if (patch.enabled !== undefined) rollback.enabled = source.enabled;
  if (patch.config !== undefined) rollback.config = source.config;
  if (Object.keys(rollback).length > 0) {
    await db.repos.dataSources.update(key, rollback);
  }
}

function patchStillMatchesUpdated(
  current: {
    name: string;
    tableName: string;
    pipelineId: string | null;
    enabled: boolean;
    config: Record<string, unknown>;
  },
  updated: {
    name: string;
    tableName: string;
    pipelineId: string | null;
    enabled: boolean;
    config: Record<string, unknown>;
  },
  patch: {
    name?: string;
    tableName?: string;
    pipelineId?: string | null;
    enabled?: boolean;
    config?: Record<string, unknown>;
  },
): boolean {
  if (patch.name !== undefined && current.name !== updated.name) return false;
  if (patch.tableName !== undefined && current.tableName !== updated.tableName) return false;
  if (patch.pipelineId !== undefined && current.pipelineId !== updated.pipelineId) return false;
  if (patch.enabled !== undefined && current.enabled !== updated.enabled) return false;
  if (patch.config !== undefined && !sameJsonValue(current.config, updated.config)) return false;
  return true;
}
