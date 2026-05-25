import type { Env } from '@finlake/shared';
import { requireAppWorkspaceClient } from './servicePrincipalIdentity.js';
import type { WorkspaceClient } from './statementExecution.js';
import { WorkspaceServiceError, isNotFound, isPermissionDenied } from './workspaceClientErrors.js';

export class PipelineRunPermissionError extends WorkspaceServiceError {}

interface PipelinePermissionResponse {
  access_control_list?: PipelineAccessControlEntry[];
}

interface PipelineAccessControlEntry {
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

export function createAppServicePrincipalPipelineRunAsserter(
  env: Env,
): (pipelineId: string) => Promise<void> {
  let wc: WorkspaceClient | null = null;
  let aliasesPromise: Promise<PrincipalAliases> | null = null;
  return async (pipelineId: string) => {
    wc ??= requireAppWorkspaceClient(env, PipelineRunPermissionError);
    aliasesPromise ??= currentPrincipalAliases(wc, env);
    await assertAppServicePrincipalCanRunPipeline(env, pipelineId, wc, aliasesPromise);
  };
}

export async function assertAppServicePrincipalCanRunPipeline(
  env: Env,
  pipelineId: string,
  workspaceClient?: WorkspaceClient,
  principalAliasesPromise?: Promise<PrincipalAliases>,
): Promise<void> {
  const wc = workspaceClient ?? requireAppWorkspaceClient(env, PipelineRunPermissionError);
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
  const levels = (entry.all_permissions ?? []).map((permission) => permission.permission_level);
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
  for (const value of [env.DATABRICKS_CLIENT_ID, current.applicationId]) {
    addPrincipalAlias(aliases.servicePrincipal, value);
  }
  addPrincipalAlias(aliases.user, current.userName);
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
