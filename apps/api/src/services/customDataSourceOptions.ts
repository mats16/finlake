import { settingsToRecord, type DatabaseClient } from '@finlake/db';
import {
  CATALOG_SETTING_KEY,
  medallionSchemaNamesFromSettings,
  type CustomDataSourceOptionsResponse,
  type CustomDataSourcePipelineOption,
  type CustomDataSourceTableOption,
  type Env,
} from '@finlake/shared';
import { buildAppWorkspaceClient } from './statementExecution.js';
import { WorkspaceServiceError, isPermissionDenied } from './workspaceClientErrors.js';

export class CustomDataSourceOptionsError extends WorkspaceServiceError {}

interface PipelineListResponse {
  statuses?: Array<{
    pipeline_id?: string;
    name?: string;
    state?: string;
  }>;
  next_page_token?: string;
}

interface TableListResponse {
  tables?: Array<{
    catalog_name?: string;
    schema_name?: string;
    name?: string;
    full_name?: string;
    table_type?: string;
  }>;
  next_page_token?: string;
}

export async function listCustomDataSourceOptions(
  db: DatabaseClient,
  env: Env,
): Promise<CustomDataSourceOptionsResponse> {
  const wc = buildAppWorkspaceClient(env);
  if (!wc) {
    throw new CustomDataSourceOptionsError(
      'DATABRICKS_HOST and app service principal credentials are required to list custom data source resources.',
      401,
    );
  }

  const settings = settingsToRecord(await db.repos.appSettings.list());
  const defaultCatalog = (settings[CATALOG_SETTING_KEY] ?? '').trim() || null;
  const defaultSchema = medallionSchemaNamesFromSettings(settings).silver;

  const [pipelines, tables] = await Promise.all([
    listPipelines(wc),
    defaultCatalog ? listTables(wc, defaultCatalog, defaultSchema) : Promise.resolve([]),
  ]);

  return {
    defaultCatalog,
    defaultSchema,
    pipelines,
    tables,
  };
}

async function listPipelines(
  wc: NonNullable<ReturnType<typeof buildAppWorkspaceClient>>,
): Promise<CustomDataSourcePipelineOption[]> {
  const pipelines: CustomDataSourcePipelineOption[] = [];
  let pageToken: string | undefined;
  try {
    do {
      const response = (await wc.apiClient.request({
        path: '/api/2.0/pipelines',
        method: 'GET',
        headers: new Headers({ Accept: 'application/json' }),
        query: {
          max_results: 100,
          ...(pageToken ? { page_token: pageToken } : {}),
        },
        raw: false,
      })) as PipelineListResponse;
      for (const item of response.statuses ?? []) {
        if (!item.pipeline_id) continue;
        pipelines.push({
          id: item.pipeline_id,
          name: item.name?.trim() || item.pipeline_id,
          state: item.state ?? null,
        });
      }
      pageToken = response.next_page_token;
    } while (pageToken);
  } catch (err) {
    throw new CustomDataSourceOptionsError(
      `Failed to list Lakeflow pipelines: ${(err as Error).message}`,
      isPermissionDenied(err) ? 403 : 502,
    );
  }
  return pipelines.sort((a, b) => a.name.localeCompare(b.name));
}

async function listTables(
  wc: NonNullable<ReturnType<typeof buildAppWorkspaceClient>>,
  catalog: string,
  schema: string,
): Promise<CustomDataSourceTableOption[]> {
  const tables: CustomDataSourceTableOption[] = [];
  let pageToken: string | undefined;
  try {
    do {
      const response = (await wc.apiClient.request({
        path: '/api/2.1/unity-catalog/tables',
        method: 'GET',
        headers: new Headers({ Accept: 'application/json' }),
        query: {
          catalog_name: catalog,
          schema_name: schema,
          max_results: 100,
          ...(pageToken ? { page_token: pageToken } : {}),
        },
        raw: false,
      })) as TableListResponse;
      for (const item of response.tables ?? []) {
        if (!item.catalog_name || !item.schema_name || !item.name) continue;
        const fullName = item.full_name ?? `${item.catalog_name}.${item.schema_name}.${item.name}`;
        tables.push({
          catalog: item.catalog_name,
          schema: item.schema_name,
          name: item.name,
          fullName,
          tableType: item.table_type ?? null,
        });
      }
      pageToken = response.next_page_token;
    } while (pageToken);
  } catch (err) {
    throw new CustomDataSourceOptionsError(
      `Failed to list tables in ${catalog}.${schema}: ${(err as Error).message}`,
      isPermissionDenied(err) ? 403 : 502,
    );
  }
  return tables.sort((a, b) => a.fullName.localeCompare(b.fullName));
}
