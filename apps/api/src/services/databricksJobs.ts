import type { WorkspaceClient } from './statementExecution.js';
import { sleep } from '../utils/sleep.js';

export interface PipelineScheduleParams {
  /** Display name for the Lakeflow pipeline (e.g. `finops-databricks-focus-pipeline`). */
  pipelineName: string;
  /** Display name for the Databricks Job (e.g. `finops-databricks-focus-job`). */
  jobName: string;
  /** Pipeline SQL source files uploaded into the workspace. */
  files: PipelineSourceFile[];
  /** Unity Catalog target catalog. */
  catalog: string;
  /** Unity Catalog target schema (e.g. `silver`). */
  schema: string;
  /** Lakeflow pipeline parameters exposed to SQL as `${key}` references. */
  configuration?: Record<string, string>;
  /** Quartz cron expression: `seconds minutes hours day-of-month month day-of-week`. */
  cronExpression: string;
  /** Java timezone id, e.g. `UTC`. */
  timezoneId: string;
  /** Optional application ID for service-principal-owned pipeline runs. */
  servicePrincipalId?: string;
  /** Deployment environment tag value, normally NODE_ENV. */
  environmentTag?: string;
}

export interface PipelineJobTaskParams {
  /** Stable Databricks job task key. */
  taskKey: string;
  /** Display name for this Lakeflow pipeline. */
  pipelineName: string;
  /** Pipeline SQL source files uploaded into the workspace. */
  files: PipelineSourceFile[];
  /** Unity Catalog target catalog. */
  catalog: string;
  /** Unity Catalog target schema. */
  schema: string;
  /** Lakeflow pipeline parameters exposed to SQL as `${key}` references. */
  configuration?: Record<string, string>;
  /** Existing pipeline id to update, when known. */
  existingPipelineId?: string | null;
  /** Upstream task keys this pipeline task depends on. */
  dependsOn?: string[];
}

export interface MultiPipelineScheduleParams {
  /** Display name for the Databricks Job. */
  jobName: string;
  /** Lakeflow pipelines to upsert and wire into the job. */
  pipelines: PipelineJobTaskParams[];
  /** Quartz cron expression: `seconds minutes hours day-of-month month day-of-week`. */
  cronExpression: string;
  /** Java timezone id, e.g. `UTC`. */
  timezoneId: string;
  /** Optional application ID for service-principal-owned pipeline runs. */
  servicePrincipalId?: string;
  /** Deployment environment tag value, normally NODE_ENV. */
  environmentTag?: string;
}

export interface PipelineSourceFile {
  /** Absolute workspace path for the uploaded pipeline SQL source. */
  workspacePath: string;
  /** DLT SQL body — must use `CREATE OR REFRESH` syntax. */
  pipelineSql: string;
}

export interface UpsertPipelineScheduleResult {
  jobId: number;
  pipelineId: string;
  workspacePaths: string[];
  createdJob: boolean;
}

export interface UpsertMultiPipelineScheduleResult {
  jobId: number;
  pipelines: Array<{
    taskKey: string;
    pipelineId: string;
    workspacePaths: string[];
  }>;
  createdJob: boolean;
}

export interface PipelineUpdateRunResult {
  pipelineId: string;
  updateId: string;
  requestId: string | null;
}

const FINLAKE_BASE_RESOURCE_TAGS = {
  ManagedBy: 'finlake',
  Project: 'finops',
  CostCenter: 'finlake',
} as const;
const JOB_PIPELINE_REFERENCE_RETRY_DELAYS_MS = [250, 500, 1000, 2000, 4000] as const;

export function finlakeResourceTags(environmentTag?: string): Record<string, string> {
  return {
    ...FINLAKE_BASE_RESOURCE_TAGS,
    Environment: normalizedEnvironmentTag(environmentTag),
  };
}

function normalizedEnvironmentTag(environmentTag?: string): string {
  const trimmed = environmentTag?.trim();
  // Fall back to 'local' when the value is empty or is an unexpanded DAB template variable (e.g. '${bundle.target}')
  if (!trimmed || trimmed.startsWith('${')) return 'local';
  return trimmed;
}

async function ensureWorkspaceDir(wc: WorkspaceClient, dir: string): Promise<void> {
  try {
    await wc.workspace.mkdirs({ path: dir });
  } catch {
    /* `mkdirs` is idempotent in practice; ignore failures for already-existing dirs */
  }
}

export interface UploadWorkspaceFileOptions {
  format?: 'SOURCE' | 'JUPYTER' | 'RAW';
  language?: 'SQL' | 'PYTHON' | 'SCALA' | 'R';
}

export async function uploadPipelineFile(
  wc: WorkspaceClient,
  path: string,
  content: string,
  options: UploadWorkspaceFileOptions = {},
): Promise<void> {
  const lastSlash = path.lastIndexOf('/');
  if (lastSlash > 0) {
    await ensureWorkspaceDir(wc, path.slice(0, lastSlash));
  }
  await wc.workspace.import({
    path,
    content: Buffer.from(content, 'utf8').toString('base64'),
    format: options.format ?? 'SOURCE',
    language: options.format === 'RAW' ? undefined : (options.language ?? 'SQL'),
    overwrite: true,
  });
}

/**
 * Create or update the Lakeflow Declarative Pipeline that builds the FOCUS
 * materialized view. Photon is managed by Databricks for serverless pipelines,
 * so we don't pass any photon-related flag — leaving the platform default in
 * place is the supported configuration.
 */
async function upsertPipeline(
  wc: WorkspaceClient,
  params: Pick<
    PipelineScheduleParams,
    | 'pipelineName'
    | 'files'
    | 'catalog'
    | 'schema'
    | 'configuration'
    | 'servicePrincipalId'
    | 'environmentTag'
  >,
  existingPipelineId: string | null,
): Promise<string> {
  const settings = {
    name: params.pipelineName,
    catalog: params.catalog,
    schema: params.schema,
    serverless: true,
    development: false,
    continuous: false,
    channel: 'CURRENT',
    libraries: params.files.map((file) => ({ file: { path: file.workspacePath } })),
    ...(params.configuration ? { configuration: params.configuration } : {}),
    ...(params.servicePrincipalId
      ? { run_as: { service_principal_name: params.servicePrincipalId } }
      : {}),
    tags: finlakeResourceTags(params.environmentTag),
  };

  if (existingPipelineId) {
    try {
      await wc.pipelines.update({ pipeline_id: existingPipelineId, ...settings });
      return existingPipelineId;
    } catch (err) {
      if (!isManagePermissionDenied(err) && !isPipelineNotFound(err)) throw err;
      // The saved pipeline may be owned by a different principal or may have
      // been deleted outside FinLake. Create a replacement owned by the current
      // app service principal and persist the new id after job sync.
      if (isManagePermissionDenied(err)) {
        await wc.pipelines.delete({ pipeline_id: existingPipelineId }).catch(() => {});
      }
    }
  }
  const created = await wc.pipelines.create({ ...settings, allow_duplicate_names: true });
  if (!created.pipeline_id) {
    throw new Error('Databricks Pipelines API returned no pipeline_id');
  }
  return created.pipeline_id;
}

export async function dryRunPipelineCreate(
  wc: WorkspaceClient,
  params: PipelineScheduleParams,
): Promise<void> {
  await wc.pipelines.create({
    name: params.pipelineName,
    catalog: params.catalog,
    schema: params.schema,
    serverless: true,
    development: false,
    continuous: false,
    channel: 'CURRENT',
    libraries: params.files.map((file) => ({ file: { path: file.workspacePath } })),
    ...(params.configuration ? { configuration: params.configuration } : {}),
    ...(params.servicePrincipalId
      ? { run_as: { service_principal_name: params.servicePrincipalId } }
      : {}),
    tags: finlakeResourceTags(params.environmentTag),
    dry_run: true,
  });
}

interface PipelineUpdateStartResponse {
  update_id?: string;
  request_id?: string;
}

export async function startPipelineUpdate(
  wc: WorkspaceClient,
  pipelineId: string,
): Promise<PipelineUpdateRunResult> {
  let response: PipelineUpdateStartResponse;
  try {
    response = (await retryPipelineReferenceNotReady(() =>
      wc.apiClient.request({
        path: `/api/2.0/pipelines/${encodeURIComponent(pipelineId)}/updates`,
        method: 'POST',
        headers: new Headers({
          Accept: 'application/json',
          'Content-Type': 'application/json',
        }),
        raw: false,
        payload: {
          full_refresh: false,
        },
      }),
    )) as PipelineUpdateStartResponse;
  } catch (err) {
    throw new Error(`Failed to start pipeline ${pipelineId}: ${(err as Error).message}`);
  }

  if (!response.update_id) {
    throw new Error(`Databricks Pipelines API returned no update_id for ${pipelineId}`);
  }
  return {
    pipelineId,
    updateId: response.update_id,
    requestId: response.request_id ?? null,
  };
}

/**
 * Create or replace the Databricks Job that triggers the pipeline on cron.
 * `pipeline_task` runs an update of the named pipeline; cron lives on the job
 * so we can change the schedule without touching the pipeline definition.
 */
export async function upsertPipelineSchedule(
  wc: WorkspaceClient,
  params: PipelineScheduleParams,
  existing: { jobId: number | null; pipelineId: string | null },
): Promise<UpsertPipelineScheduleResult> {
  const result = await upsertMultiPipelineSchedule(
    wc,
    {
      jobName: params.jobName,
      pipelines: [
        {
          taskKey: 'refresh',
          pipelineName: params.pipelineName,
          files: params.files,
          catalog: params.catalog,
          schema: params.schema,
          configuration: params.configuration,
          existingPipelineId: existing.pipelineId,
        },
      ],
      cronExpression: params.cronExpression,
      timezoneId: params.timezoneId,
      servicePrincipalId: params.servicePrincipalId,
      environmentTag: params.environmentTag,
    },
    { jobId: existing.jobId },
  );
  const pipeline = result.pipelines[0];
  if (!pipeline) {
    throw new Error('No pipeline task was created for the Databricks job');
  }
  return {
    jobId: result.jobId,
    pipelineId: pipeline.pipelineId,
    workspacePaths: pipeline.workspacePaths,
    createdJob: result.createdJob,
  };
}

/**
 * Create or replace one Databricks Job that runs multiple Lakeflow pipelines.
 * Source-specific silver tasks can run independently; downstream tasks express
 * dependencies through Databricks Jobs `depends_on`.
 */
export async function upsertMultiPipelineSchedule(
  wc: WorkspaceClient,
  params: MultiPipelineScheduleParams,
  existing: { jobId: number | null },
): Promise<UpsertMultiPipelineScheduleResult> {
  if (params.pipelines.length === 0) {
    throw new Error('At least one pipeline task is required');
  }

  const pipelines = await Promise.all(
    params.pipelines.map(async (pipeline) => {
      await Promise.all(
        pipeline.files.map((file) => uploadPipelineFile(wc, file.workspacePath, file.pipelineSql)),
      );
      const pipelineId = await upsertPipeline(
        wc,
        {
          pipelineName: pipeline.pipelineName,
          files: pipeline.files,
          catalog: pipeline.catalog,
          schema: pipeline.schema,
          configuration: pipeline.configuration,
          servicePrincipalId: params.servicePrincipalId,
          environmentTag: params.environmentTag,
        },
        pipeline.existingPipelineId ?? null,
      );
      return {
        taskKey: pipeline.taskKey,
        pipelineId,
        workspacePaths: pipeline.files.map((file) => file.workspacePath),
        dependsOn: pipeline.dependsOn ?? [],
      };
    }),
  );

  const jobSettings = {
    name: params.jobName,
    max_concurrent_runs: 1,
    tags: finlakeResourceTags(params.environmentTag),
    schedule: {
      quartz_cron_expression: params.cronExpression,
      timezone_id: params.timezoneId,
      pause_status: 'UNPAUSED' as const,
    },
    tasks: pipelines.map((pipeline) => ({
      task_key: pipeline.taskKey,
      ...(pipeline.dependsOn.length > 0
        ? { depends_on: pipeline.dependsOn.map((taskKey) => ({ task_key: taskKey })) }
        : {}),
      pipeline_task: { pipeline_id: pipeline.pipelineId, full_refresh: false },
    })),
  };

  if (existing.jobId !== null) {
    try {
      await retryPipelineReferenceNotReady(() =>
        wc.jobs.reset({ job_id: existing.jobId as number, new_settings: jobSettings }),
      );
      return {
        jobId: existing.jobId,
        pipelines: stripDependsOn(pipelines),
        createdJob: false,
      };
    } catch (err) {
      if (!isManagePermissionDenied(err)) throw err;
      // The saved job may be owned by a different principal. Create a new
      // user-owned job and persist its id in the data source row.
      await wc.jobs.delete({ job_id: existing.jobId }).catch(() => {});
    }
  }
  const created = await retryPipelineReferenceNotReady(() => wc.jobs.create(jobSettings));
  if (typeof created.job_id !== 'number') {
    throw new Error('Databricks Jobs API returned no job_id');
  }
  return {
    jobId: created.job_id,
    pipelines: stripDependsOn(pipelines),
    createdJob: true,
  };
}

function stripDependsOn<T extends { dependsOn: unknown }>(items: T[]): Omit<T, 'dependsOn'>[] {
  return items.map(({ dependsOn: _dependsOn, ...rest }) => rest);
}

function isManagePermissionDenied(err: unknown): boolean {
  const code = hasErrorCode(err) ? err.errorCode : '';
  const message = err instanceof Error ? err.message : String(err);
  const isPermDenied = code === 'PERMISSION_DENIED' || /PERMISSION_DENIED/i.test(message);
  return isPermDenied && /Manage permissions/i.test(message);
}

async function retryPipelineReferenceNotReady<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const delay = JOB_PIPELINE_REFERENCE_RETRY_DELAYS_MS[attempt];
      if (!isPipelineNotFound(err) || delay === undefined) throw err;
      await sleep(delay);
      attempt += 1;
    }
  }
}

function isPipelineNotFound(err: unknown): boolean {
  const code = hasErrorCode(err) ? err.errorCode : '';
  const message = err instanceof Error ? err.message : String(err);
  if (code === 'RESOURCE_DOES_NOT_EXIST' && /pipeline/i.test(message)) return true;
  if (/PIPELINE_NOT_FOUND|pipeline.*not found|specified pipeline .* was not found/i.test(message)) {
    return true;
  }
  return errorDetails(err).some(
    (detail) =>
      detail.reason === 'PIPELINE_NOT_FOUND' ||
      (detail.domain === 'deltapipelines.databricks.com' && /not.?found/i.test(message)),
  );
}

function errorDetails(err: unknown): Array<{ reason?: string; domain?: string }> {
  if (!err || typeof err !== 'object' || !('details' in err)) return [];
  const details = (err as { details?: unknown }).details;
  if (!Array.isArray(details)) return [];
  return details.filter(
    (detail): detail is { reason?: string; domain?: string } =>
      detail !== null && typeof detail === 'object',
  );
}

function hasErrorCode(err: unknown): err is { errorCode: string } {
  return (
    err != null &&
    typeof err === 'object' &&
    'errorCode' in err &&
    typeof (err as { errorCode: unknown }).errorCode === 'string'
  );
}

/**
 * Delete the job, the pipeline, and the workspace SQL file. Each delete is
 * best-effort so a partial setup can still be torn down.
 */
export async function deletePipelineSchedule(
  wc: WorkspaceClient,
  ids: { jobId: number | null; pipelineId: string | null; workspacePath: string | null },
): Promise<void> {
  const ops: Promise<unknown>[] = [];
  if (ids.jobId !== null) {
    ops.push(wc.jobs.delete({ job_id: ids.jobId }).catch(() => {}));
  }
  if (ids.pipelineId) {
    ops.push(wc.pipelines.delete({ pipeline_id: ids.pipelineId }).catch(() => {}));
  }
  if (ids.workspacePath) {
    ops.push(wc.workspace.delete({ path: ids.workspacePath, recursive: false }).catch(() => {}));
  }
  await Promise.allSettled(ops);
}
