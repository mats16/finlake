import type { Env } from '@finlake/shared';
import { requireAppWorkspaceClient } from './servicePrincipalIdentity.js';
import type { WorkspaceClient } from './statementExecution.js';
import { WorkspaceServiceError, isNotFound, isPermissionDenied } from './workspaceClientErrors.js';

export class PipelineRunPermissionError extends WorkspaceServiceError {}

interface PipelinePermissionResponse {
  access_control_list?: PipelineAccessControlEntry[];
}

interface PipelineAccessControlEntry {
  permission_level?: string;
  all_permissions?: Array<{
    permission_level?: string;
  }>;
  service_principal_name?: string;
  user_name?: string;
  group_name?: string;
}

interface CurrentPrincipalLike {
  id?: string;
  userName?: string;
  displayName?: string;
  externalId?: string;
  applicationId?: string;
  groups?: Array<{
    display?: string;
    value?: string;
  }>;
}

const RUN_PERMISSION_LEVELS = new Set(['CAN_RUN', 'CAN_MANAGE', 'IS_OWNER']);

interface PrincipalAliases {
  servicePrincipal: Set<string>;
  user: Set<string>;
  group: Set<string>;
}

export interface PipelineRunAsserterOptions {
  cacheTtlMs?: number;
  now?: () => number;
  workspaceClientFactory?: (env: Env) => WorkspaceClient;
}

const PRINCIPAL_ALIAS_CACHE_TTL_MS = 5 * 60 * 1000;

export function createAppServicePrincipalPipelineRunAsserter(
  env: Env,
  options: PipelineRunAsserterOptions = {},
): (pipelineId: string) => Promise<void> {
  let wcCache: { client: WorkspaceClient; expiresAt: number } | null = null;
  let aliasesCache: { promise: Promise<PrincipalAliases>; expiresAt: number } | null = null;
  const cacheTtlMs = options.cacheTtlMs ?? PRINCIPAL_ALIAS_CACHE_TTL_MS;
  const now = options.now ?? Date.now;
  const createWorkspaceClient =
    options.workspaceClientFactory ??
    ((currentEnv: Env) => requireAppWorkspaceClient(currentEnv, PipelineRunPermissionError, 412));

  return async (pipelineId: string) => {
    const currentTime = now();
    if (!wcCache || currentTime >= wcCache.expiresAt) {
      wcCache = { client: createWorkspaceClient(env), expiresAt: currentTime + cacheTtlMs };
      aliasesCache = null;
    }
    if (!aliasesCache || currentTime >= aliasesCache.expiresAt) {
      aliasesCache = cachePrincipalAliases(wcCache.client, currentTime + cacheTtlMs);
    }
    try {
      await assertAppServicePrincipalCanRunPipeline(
        env,
        pipelineId,
        wcCache.client,
        aliasesCache.promise,
      );
    } catch (err) {
      if (!shouldRefreshAliasesAfterDenial(err) || !wcCache) {
        throw err;
      }
      aliasesCache = cachePrincipalAliases(wcCache.client, now() + cacheTtlMs);
      await assertAppServicePrincipalCanRunPipeline(
        env,
        pipelineId,
        wcCache.client,
        aliasesCache.promise,
      );
    }
  };

  function cachePrincipalAliases(client: WorkspaceClient, expiresAt: number) {
    const aliasesPromise = currentPrincipalAliases(client, env).catch((err) => {
      if (aliasesCache?.promise === aliasesPromise) {
        aliasesCache = null;
        wcCache = null;
      }
      throw err;
    });
    return { promise: aliasesPromise, expiresAt };
  }
}

export async function assertAppServicePrincipalCanRunPipeline(
  env: Env,
  pipelineId: string,
  workspaceClient?: WorkspaceClient,
  principalAliasesPromise?: Promise<PrincipalAliases>,
): Promise<void> {
  const wc = workspaceClient ?? requireAppWorkspaceClient(env, PipelineRunPermissionError, 412);
  const aliases = await (principalAliasesPromise ?? currentPrincipalAliases(wc, env));
  let permissions: PipelinePermissionResponse;
  try {
    permissions = (await wc.apiClient.request({
      path: `/api/2.0/permissions/pipelines/${encodeURIComponent(pipelineId)}`,
      method: 'GET',
      headers: new Headers({ Accept: 'application/json' }),
      raw: false,
    })) as PipelinePermissionResponse;
  } catch (err) {
    if (isNotFound(err)) {
      throw new PipelineRunPermissionError(`Lakeflow pipeline ${pipelineId} was not found.`, 404);
    }
    throw new PipelineRunPermissionError(
      `Failed to read permissions for Lakeflow pipeline ${pipelineId}: ${(err as Error).message}`,
      isPermissionDenied(err) ? 403 : 502,
    );
  }

  if (hasRunPermission(permissions, aliases)) return;

  const servicePrincipal = env.DATABRICKS_CLIENT_ID?.trim() || 'the app service principal';
  throw new PipelineRunPermissionError(
    `The app service principal (${servicePrincipal}) needs CAN_RUN, CAN_MANAGE, or IS_OWNER on Lakeflow pipeline ${pipelineId}.`,
    403,
  );
}

function shouldRefreshAliasesAfterDenial(err: unknown): boolean {
  return (
    err instanceof PipelineRunPermissionError &&
    err.statusCode === 403 &&
    !err.message.startsWith('Failed to read permissions for Lakeflow pipeline')
  );
}

function hasRunPermission(
  permissions: PipelinePermissionResponse,
  principalAliases: PrincipalAliases,
): boolean {
  return (permissions.access_control_list ?? []).some(
    (entry) => principalMatches(entry, principalAliases) && entryCanRun(entry),
  );
}

function principalMatches(
  entry: PipelineAccessControlEntry,
  principalAliases: PrincipalAliases,
): boolean {
  return (
    aliasSetMatches(principalAliases.servicePrincipal, entry.service_principal_name) ||
    aliasSetMatches(principalAliases.user, entry.user_name) ||
    aliasSetMatches(principalAliases.group, entry.group_name)
  );
}

function entryCanRun(entry: PipelineAccessControlEntry): boolean {
  const levels = [
    entry.permission_level,
    ...(entry.all_permissions ?? []).map((permission) => permission.permission_level),
  ];
  return levels.some((level) => RUN_PERMISSION_LEVELS.has((level ?? '').trim().toUpperCase()));
}

function normalizePrincipal(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

async function currentPrincipalAliases(wc: WorkspaceClient, env: Env): Promise<PrincipalAliases> {
  const aliases: PrincipalAliases = {
    servicePrincipal: new Set<string>(),
    user: new Set<string>(),
    group: new Set<string>(),
  };
  let current: CurrentPrincipalLike;
  try {
    current = (await wc.currentUser.me()) as CurrentPrincipalLike;
  } catch (err) {
    throw new PipelineRunPermissionError(
      `Failed to resolve app service principal identity: ${(err as Error).message}`,
      isPermissionDenied(err) ? 403 : 502,
    );
  }
  for (const value of [
    env.DATABRICKS_CLIENT_ID,
    current.id,
    current.displayName,
    current.externalId,
    current.applicationId,
  ]) {
    addPrincipalAlias(aliases.servicePrincipal, value);
  }
  addUserAlias(aliases, current.userName);
  for (const group of current.groups ?? []) {
    addPrincipalAlias(aliases.group, group.display);
  }
  return aliases;
}

function aliasSetMatches(aliases: Set<string>, value: string | undefined): boolean {
  const normalized = normalizePrincipal(value);
  return normalized !== null && aliases.has(normalized);
}

function addPrincipalAlias(aliases: Set<string>, value: string | undefined): void {
  const normalized = normalizePrincipal(value);
  if (normalized) aliases.add(normalized);
}

function addUserAlias(aliases: PrincipalAliases, value: string | undefined): void {
  const normalized = normalizePrincipal(value);
  if (normalized) aliases.user.add(normalized);
}
