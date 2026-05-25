import { Router, type Response } from 'express';
import type { DatabaseClient } from '@finlake/db';
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
  normalizeGcpBillingAccountId,
  type DataSourceKey,
  type Env,
} from '@finlake/shared';
import {
  runDataSourceJob,
  setupFocusDataSource,
  syncSharedFocusPipeline,
} from '../services/dataSourceSetup.js';
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

export interface DataSourcesRouterDeps {
  assertPipelineCanRun?: (pipelineId: string) => Promise<void>;
  syncSharedPipeline?: () => Promise<void>;
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

  router.get('/templates', (_req, res) => {
    res.json({ items: DATA_SOURCE_TEMPLATES });
  });

  router.get('/custom-options', async (req, res, next) => {
    try {
      res.json(await listCustomDataSourceOptions(db, env, req.user?.accessToken));
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
      if (isCustomTemplate && (await customTableAlreadyRegistered(db, parsed.data.tableName))) {
        res.status(409).json({
          error: {
            message: `Custom data source table is already registered: ${parsed.data.tableName}`,
          },
        });
        return;
      }
      if (isCustomTemplate && pipelineId) {
        await assertPipelineCanRun(pipelineId);
      }
      if (isCustomTemplate && parsed.data.enabled === true && !pipelineId) {
        res.status(409).json({
          error: { message: 'Custom data source must have a pipelineId before enabling.' },
        });
        return;
      }
      const accountId = accountIdForCreate(
        isCustomTemplate,
        parsed.data.providerName,
        parsed.data.accountId,
      );
      if (!accountId) {
        res.status(400).json({ error: { message: 'accountId is required' } });
        return;
      }
      const created = await db.repos.dataSources.create({
        name: parsed.data.name,
        providerName: parsed.data.providerName,
        accountId,
        tableName: parsed.data.tableName,
        focusVersion: template.focus_version,
        pipelineId,
        enabled: parsed.data.enabled ?? false,
        config: configForCreate(parsed.data.providerName, parsed.data.config ?? {}, accountId),
      });
      if (sourceNeedsPipelineSync(created)) {
        try {
          await syncSharedPipelineIfAnyEnabled(db, syncSharedPipeline);
        } catch (err) {
          await db.repos.dataSources.delete({
            providerName: created.providerName,
            accountId: created.accountId,
          });
          throw err;
        }
      }
      const refreshed = await db.repos.dataSources.get({
        providerName: created.providerName,
        accountId: created.accountId,
      });
      res.status(201).json(refreshed ?? created);
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
      if (parsed.data.config && isRegisteredAwsSource(existing)) {
        const changedKeys = AWS_SOURCE_LOCKED_CONFIG_KEYS.filter(
          (key) => !sameJsonValue(existing.config[key], parsed.data.config?.[key]),
        );
        if (changedKeys.length > 0) {
          res.status(409).json({
            error: {
              message: `Registered AWS source settings cannot be changed: ${changedKeys.join(', ')}`,
            },
          });
          return;
        }
      }
      const nextCandidate = { ...existing, ...parsed.data };
      if (
        isCustomProvider(existing.providerName) &&
        nextCandidate.enabled &&
        !nextCandidate.pipelineId
      ) {
        res.status(409).json({
          error: { message: 'Custom data source must have a pipelineId before enabling.' },
        });
        return;
      }
      const pipelineIdToCheck = pipelineIdForRunPermissionCheck(
        existing,
        nextCandidate,
        parsed.data,
      );
      if (pipelineIdToCheck) {
        await assertPipelineCanRun(pipelineIdToCheck);
      }
      const updated = await db.repos.dataSources.update(key, parsed.data);
      if (sourceUpdateNeedsPipelineSync(existing, updated, parsed.data)) {
        try {
          await syncSharedPipelineIfAnyEnabled(db, syncSharedPipeline);
        } catch (err) {
          await restoreDataSource(db, key, existing);
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
          await syncSharedPipelineIfAnyEnabled(db, syncSharedPipeline);
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
): string | null {
  if (isCustomTemplate) {
    return `custom_${randomUUID()}`;
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
  accountId: string,
): Record<string, unknown> {
  if (!isGcpProvider(providerName)) return config;
  const billingAccountId =
    typeof config.billingAccountId === 'string' && config.billingAccountId.trim().length > 0
      ? config.billingAccountId
      : accountId;
  return {
    ...config,
    billingAccountId: normalizeGcpBillingAccountId(billingAccountId),
  };
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

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function customTableAlreadyRegistered(
  db: DatabaseClient,
  tableName: string,
): Promise<boolean> {
  const normalizedTableName = normalizeTableNameForComparison(tableName);
  const existingSources = await db.repos.dataSources.list();
  return existingSources.some(
    (source) =>
      isCustomProvider(source.providerName) &&
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
  const pipelineChanged = patch.pipelineId !== undefined && patch.pipelineId !== previous.pipelineId;
  if (pipelineChanged) return next.pipelineId;

  const enabling = patch.enabled === true && !previous.enabled;
  if (enabling) return next.pipelineId;

  const enabledSourceChanged =
    previous.enabled &&
    (patch.name !== undefined || patch.tableName !== undefined || patch.config !== undefined);
  return enabledSourceChanged ? next.pipelineId : null;
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
  const configChanged = patch.config !== undefined && !sameJsonValue(patch.config, previous.config);
  if (!isCustomProvider(previous.providerName)) {
    return tableNameChanged || configChanged;
  }
  const pipelineChanged = patch.pipelineId !== undefined && patch.pipelineId !== previous.pipelineId;
  return tableNameChanged || pipelineChanged;
}

async function syncSharedPipelineIfAnyEnabled(
  db: DatabaseClient,
  syncSharedPipeline: () => Promise<void>,
): Promise<void> {
  const enabledSources = (await db.repos.dataSources.list()).filter((source) => source.enabled);
  if (enabledSources.length === 0) return;
  await syncSharedPipeline();
}

async function restoreDataSource(
  db: DatabaseClient,
  key: DataSourceKey,
  source: {
    name: string;
    tableName: string;
    focusVersion: string | null;
    pipelineId: string | null;
    enabled: boolean;
    config: Record<string, unknown>;
  },
): Promise<void> {
  await db.repos.dataSources.update(key, {
    name: source.name,
    tableName: source.tableName,
    focusVersion: source.focusVersion,
    pipelineId: source.pipelineId,
    enabled: source.enabled,
    config: source.config,
  });
}
