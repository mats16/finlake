import type { Env } from '@finlake/shared';
import { requireAppWorkspaceClient } from './servicePrincipalIdentity.js';
import type { WorkspaceClient } from './statementExecution.js';
import { WorkspaceServiceError, isPermissionDenied } from './workspaceClientErrors.js';

export class PipelineRunPermissionError extends WorkspaceServiceError {}

interface PipelinePermissionResponse {
  access_control_list?: PipelineAccessControlEntry[];
}

interface PipelineAccessControlEntry {
  all_permissions?: Array<{
    permission_level?: string;
  }>;
  permission_level?: string;
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

export async function assertAppServicePrincipalCanRunPipeline(
  env: Env,
  pipelineId: string,
  workspaceClient?: WorkspaceClient,
): Promise<void> {
  const wc = workspaceClient ?? requireAppWorkspaceClient(env, PipelineRunPermissionError);
  const aliases = await currentPrincipalAliases(wc, env);
  let permissions: PipelinePermissionResponse;
  try {
    permissions = (await wc.apiClient.request({
      path: `/api/2.0/permissions/pipelines/${encodeURIComponent(pipelineId)}`,
      method: 'GET',
      headers: new Headers({ Accept: 'application/json' }),
      raw: false,
    })) as PipelinePermissionResponse;
  } catch (err) {
    throw new PipelineRunPermissionError(
      `Failed to read permissions for Lakeflow pipeline ${pipelineId}: ${(err as Error).message}`,
      isPermissionDenied(err) ? 403 : 502,
    );
  }

  if (hasRunPermission(permissions, aliases)) return;

  const servicePrincipal = env.DATABRICKS_CLIENT_ID?.trim() || 'the app service principal';
  throw new PipelineRunPermissionError(
    `The app service principal (${servicePrincipal}) needs CAN_RUN, CAN_MANAGE, or IS_OWNER on Lakeflow pipeline ${pipelineId} before it can be attached to the master job.`,
    403,
  );
}

function hasRunPermission(
  permissions: PipelinePermissionResponse,
  principalAliases: Set<string>,
): boolean {
  return (permissions.access_control_list ?? []).some(
    (entry) => principalMatches(entry, principalAliases) && entryCanRun(entry),
  );
}

function principalMatches(
  entry: PipelineAccessControlEntry,
  principalAliases: Set<string>,
): boolean {
  return [entry.service_principal_name, entry.user_name, entry.group_name].some((value) => {
    const normalized = normalizePrincipal(value);
    return normalized !== null && principalAliases.has(normalized);
  });
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
  return trimmed ? trimmed.toLocaleLowerCase() : null;
}

async function currentPrincipalAliases(wc: WorkspaceClient, env: Env): Promise<Set<string>> {
  const aliases = new Set<string>();
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
    current.userName,
    current.displayName,
    current.externalId,
    current.applicationId,
  ]) {
    addPrincipalAlias(aliases, value);
  }
  for (const group of current.groups ?? []) {
    addPrincipalAlias(aliases, group.display);
    addPrincipalAlias(aliases, group.value);
  }
  return aliases;
}

function addPrincipalAlias(aliases: Set<string>, value: string | undefined): void {
  const normalized = normalizePrincipal(value);
  if (normalized) aliases.add(normalized);
}
