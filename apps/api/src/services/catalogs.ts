import {
  CATALOG_USER_GROUP_DEFAULT,
  DOWNLOADS_VOLUME_DEFAULT,
  MEDALLION_SCHEMA_DEFAULTS,
  MEDALLION_SCHEMAS,
  PRICING_SCHEMA_DEFAULT,
  quoteIdent,
  quotePrincipal,
  schemaGrantPrivileges,
  type CatalogSchemaSummary,
  type CatalogSummary,
  type CatalogTableSummary,
  type Env,
  type MedallionSchema,
  type ProvisionResult,
  type SchemaEnsureStatus,
} from '@finlake/shared';
import { logger } from '../config/logger.js';
import {
  buildDefaultUserExecutor,
  buildUserWorkspaceClient,
  type StatementExecutor,
  type WorkspaceClient,
} from './statementExecution.js';
import { z } from 'zod';
import { WorkspaceServiceError, isNotFound, isPermissionDenied } from './workspaceClientErrors.js';

/** Catalogs hidden from the picker — not user-selectable for FOCUS provisioning. */
const HIDDEN_CATALOG_NAMES = new Set(['system', 'samples', '__databricks_internal']);
/** Catalog types that can't host customer-managed schemas / FOCUS materialized views. */
const HIDDEN_CATALOG_TYPES = new Set(['DELTASHARING_CATALOG']);

interface CatalogInfoLike {
  name?: string;
  catalog_type?: string;
  comment?: string;
}

interface SchemaInfoLike {
  name?: string;
  full_name?: string;
  catalog_name?: string;
  catalog_type?: string;
  comment?: string;
}

interface TableInfoLike {
  name?: string;
  full_name?: string;
  catalog_name?: string;
  schema_name?: string;
  table_type?: string;
  data_source_format?: string;
  comment?: string;
}

interface TableTagFilter {
  tagName: string;
  tagValue: string;
}

interface EntityTagAssignmentLike {
  tag_value?: string;
}

const TAG_LOOKUP_CONCURRENCY = 8;
const TAGGABLE_DELTA_TABLE_TYPES = new Set(['MANAGED', 'EXTERNAL', 'STREAMING_TABLE']);

/** Pure eligibility check — exposed for unit tests. */
export function isTaggableDeltaTable(table: CatalogTableSummary): boolean {
  return (
    (table.dataSourceFormat ?? '').toUpperCase() === 'DELTA' &&
    TAGGABLE_DELTA_TABLE_TYPES.has((table.tableType ?? '').toUpperCase())
  );
}

/** Pure filter — exposed for unit tests. */
export function filterSelectableCatalogs(items: CatalogInfoLike[]): CatalogSummary[] {
  const out: CatalogSummary[] = [];
  for (const c of items) {
    if (!c.name) continue;
    if (HIDDEN_CATALOG_NAMES.has(c.name)) continue;
    if (c.catalog_type && HIDDEN_CATALOG_TYPES.has(c.catalog_type)) continue;
    out.push({
      name: c.name,
      catalogType: c.catalog_type ?? null,
      comment: c.comment ?? null,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * List Unity Catalog catalogs visible to the calling OBO user, minus the
 * non-selectable ones (system, samples, internal, Delta Sharing).
 */
export async function listAccessibleCatalogs(
  env: Env,
  userToken: string | undefined,
): Promise<CatalogSummary[]> {
  if (!userToken) throw new CatalogServiceError('OBO access token required', 401);
  const wc = buildUserWorkspaceClient(env, userToken);
  if (!wc) throw new CatalogServiceError('DATABRICKS_HOST not configured', 500);
  const collected: CatalogInfoLike[] = [];
  try {
    for await (const item of wc.catalogs.list({})) {
      collected.push(item as CatalogInfoLike);
    }
  } catch (err) {
    logger.error({ err }, 'wc.catalogs.list failed');
    throw new CatalogServiceError(
      `Failed to list catalogs: ${(err as Error).message}`,
      isPermissionDenied(err) ? 403 : 502,
    );
  }
  return filterSelectableCatalogs(collected);
}

export async function listAccessibleSchemas(
  env: Env,
  userToken: string | undefined,
  catalogName: string,
): Promise<CatalogSchemaSummary[]> {
  if (!userToken) throw new CatalogServiceError('OBO access token required', 401);
  const wc = buildUserWorkspaceClient(env, userToken);
  if (!wc) throw new CatalogServiceError('DATABRICKS_HOST not configured', 500);
  const collected: CatalogSchemaSummary[] = [];
  try {
    for await (const schema of wc.schemas.list({
      catalog_name: catalogName,
      include_browse: true,
    })) {
      const s = schema as SchemaInfoLike;
      if (!s.name) continue;
      collected.push({
        name: s.name,
        fullName: s.full_name ?? null,
        catalogName: s.catalog_name ?? null,
        catalogType: s.catalog_type ?? null,
        comment: s.comment ?? null,
      });
    }
  } catch (err) {
    logger.error({ err, catalogName }, 'wc.schemas.list failed');
    throw new CatalogServiceError(
      `Failed to list schemas in ${catalogName}: ${(err as Error).message}`,
      isPermissionDenied(err) ? 403 : 502,
    );
  }
  collected.sort((a, b) => a.name.localeCompare(b.name));
  return collected;
}

export async function listAccessibleTables(
  env: Env,
  userToken: string | undefined,
  catalogName: string,
  schemaName: string,
  tagFilter?: TableTagFilter,
): Promise<CatalogTableSummary[]> {
  if (!userToken) throw new CatalogServiceError('OBO access token required', 401);
  const wc = buildUserWorkspaceClient(env, userToken);
  if (!wc) throw new CatalogServiceError('DATABRICKS_HOST not configured', 500);
  const collected: CatalogTableSummary[] = [];
  try {
    for await (const table of wc.tables.list({
      catalog_name: catalogName,
      schema_name: schemaName,
      include_browse: true,
      omit_columns: true,
      omit_properties: true,
      omit_username: true,
    })) {
      const t = table as TableInfoLike;
      if (!t.name) continue;
      collected.push({
        name: t.name,
        fullName: t.full_name ?? `${catalogName}.${schemaName}.${t.name}`,
        catalogName: t.catalog_name ?? catalogName,
        schemaName: t.schema_name ?? schemaName,
        tableType: t.table_type ?? null,
        dataSourceFormat: t.data_source_format ?? null,
        comment: t.comment ?? null,
        tags: {},
      });
    }
  } catch (err) {
    logger.error({ err, catalogName, schemaName }, 'wc.tables.list failed');
    throw new CatalogServiceError(
      `Failed to list tables in ${catalogName}.${schemaName}: ${(err as Error).message}`,
      isPermissionDenied(err) ? 403 : 502,
    );
  }
  let filtered = collected;
  if (tagFilter) {
    try {
      filtered = await filterTablesByTag(wc, collected.filter(isTaggableDeltaTable), tagFilter);
    } catch (err) {
      logger.error(
        { err, catalogName, schemaName, tagName: tagFilter.tagName },
        'table tag lookup failed',
      );
      throw new CatalogServiceError(
        `Failed to filter tables by tag: ${(err as Error).message}`,
        isPermissionDenied(err) ? 403 : 502,
      );
    }
  }
  filtered.sort((a, b) => tableSortKey(a).localeCompare(tableSortKey(b)));
  return filtered;
}

async function filterTablesByTag(
  wc: WorkspaceClient,
  tables: CatalogTableSummary[],
  filter: TableTagFilter,
): Promise<CatalogTableSummary[]> {
  const matches: CatalogTableSummary[] = [];
  for (let offset = 0; offset < tables.length; offset += TAG_LOOKUP_CONCURRENCY) {
    const batch = tables.slice(offset, offset + TAG_LOOKUP_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (table) => {
        const fullName = table.fullName!;
        try {
          const assignment = (await wc.apiClient.request({
            path: `/api/2.1/unity-catalog/entity-tag-assignments/tables/${encodeURIComponent(fullName)}/tags/${encodeURIComponent(filter.tagName)}`,
            method: 'GET',
            headers: new Headers({ Accept: 'application/json' }),
            raw: false,
          })) as EntityTagAssignmentLike;
          return assignment.tag_value === filter.tagValue
            ? { ...table, tags: { [filter.tagName]: filter.tagValue } }
            : null;
        } catch (err) {
          if (isNotFound(err)) return null;
          throw err;
        }
      }),
    );
    matches.push(...results.filter((table): table is CatalogTableSummary => table !== null));
  }
  return matches;
}

export class CatalogServiceError extends WorkspaceServiceError {}

function tableSortKey(table: CatalogTableSummary): string {
  const lowerName = table.name.toLowerCase();
  const recommended =
    lowerName.startsWith('gcp_billing_export_resource_v1_') ||
    lowerName === 'usage_in_currency_daily'
      ? '0'
      : '1';
  return `${recommended}:${table.name}`;
}

interface ProvisionOptions {
  createIfMissing?: boolean;
  warehouseId?: string;
  schemaNames?: Partial<Record<MedallionSchema, string>>;
  catalogUserGroup?: string;
}

interface ProvisionCatalogDeps {
  executor: StatementExecutor;
}

const PRICING_SCHEMA_GRANT_PRIVILEGES = 'USE SCHEMA, SELECT, CREATE TABLE';
const DOWNLOADS_VOLUME_SP_PRIVILEGES = 'READ VOLUME, WRITE VOLUME';
const DOWNLOADS_VOLUME_USER_PRIVILEGES = 'READ VOLUME';

type GrantStatus = ProvisionResult['grants'][keyof ProvisionResult['grants']];

/**
 * Provisions the medallion layout under
 * `catalog`, optionally creating the catalog itself, and grants the App
 * Service Principal the access it needs to run the FOCUS pipeline:
 * USE/SELECT on medallion schemas and CREATE TABLE / CREATE MATERIALIZED VIEW
 * on the focus/analytics outputs by default.
 *
 * All DDL/GRANT statements are run **as the calling user** (OBO) so the SP
 * does not need any prior privileges. Schema creates and GRANTs are
 * collected as best-effort: a single GRANT failure does not abort the
 * remaining ones — the per-step status is captured in the result instead.
 */
export async function provisionCatalog(
  env: Env,
  userToken: string | undefined,
  catalog: string,
  opts: ProvisionOptions = {},
): Promise<ProvisionResult> {
  const executor = await buildDefaultUserExecutor(env, userToken, opts.warehouseId);
  if (!executor) {
    throw new CatalogServiceError(
      'OBO access token + DATABRICKS_HOST + an accessible SQL warehouse required to provision a catalog.',
      400,
    );
  }
  return provisionCatalogWithDeps(env, catalog, opts, {
    executor,
  });
}

export async function provisionCatalogWithDeps(
  env: Env,
  catalog: string,
  opts: ProvisionOptions = {},
  deps: ProvisionCatalogDeps,
): Promise<ProvisionResult> {
  // Fail fast on bad identifiers so we never interpolate them into SQL.
  const catalogIdent = quoteIdent(catalog);
  const schemaIdents = MEDALLION_SCHEMAS.map((s) => {
    const schema = opts.schemaNames?.[s]?.trim() || MEDALLION_SCHEMA_DEFAULTS[s];
    return { layer: s, schema, ident: quoteIdent(schema) };
  });
  const bronzeSchema = schemaIdents.find((s) => s.layer === 'bronze')!;
  const pricingSchemaIdent = quoteIdent(PRICING_SCHEMA_DEFAULT);
  const downloadsVolumeIdent = quoteIdent(DOWNLOADS_VOLUME_DEFAULT);
  const executor = deps.executor;

  const sp = (env.DATABRICKS_CLIENT_ID ?? '').trim();
  const warnings: string[] = [];

  let catalogCreated = false;
  if (opts.createIfMissing) {
    try {
      const before = await catalogExists(executor, catalog);
      await executor.run(`CREATE CATALOG IF NOT EXISTS ${catalogIdent}`, [], z.unknown());
      catalogCreated = !before;
    } catch (err) {
      throw new CatalogServiceError(
        `CREATE CATALOG failed for ${catalogIdent}: ${(err as Error).message}`,
        isPermissionDenied(err) ? 403 : 500,
      );
    }
  }

  // Schemas: medallion + pricing schemas are independent — issue concurrently.
  // Promise.all preserves input order so warnings are collected deterministically.
  const schemaStmts = [
    ...schemaIdents.map(({ layer, ident }) => ({
      key: layer,
      sql: `CREATE SCHEMA IF NOT EXISTS ${catalogIdent}.${ident}`,
    })),
    {
      key: 'pricing' as const,
      sql: `CREATE SCHEMA IF NOT EXISTS ${catalogIdent}.${pricingSchemaIdent}`,
    },
  ];
  const schemaResults = await Promise.all(schemaStmts.map((s) => ensureSchema(executor, s.sql)));
  const schemasEnsured = {} as Record<(typeof MEDALLION_SCHEMAS)[number], SchemaEnsureStatus>;
  let pricingSchemaEnsured: SchemaEnsureStatus = 'error';
  schemaStmts.forEach((s, i) => {
    const r = schemaResults[i]!;
    if (s.key === 'pricing') pricingSchemaEnsured = r.status;
    else schemasEnsured[s.key] = r.status;
    if (r.warning) warnings.push(r.warning);
  });

  // Downloads volume depends on the bronze schema existing — run after schemas.
  const { status: downloadsVolumeEnsured, warning: downloadsVolumeWarning } = await ensureSchema(
    executor,
    `CREATE VOLUME IF NOT EXISTS ${catalogIdent}.${bronzeSchema.ident}.${downloadsVolumeIdent}`,
  );
  if (downloadsVolumeWarning) warnings.push(downloadsVolumeWarning);

  const catalogUserGroup = opts.catalogUserGroup?.trim() || CATALOG_USER_GROUP_DEFAULT;
  const catalogUserGroupIdent = quotePrincipal(catalogUserGroup);
  const grantStmts: Array<{ key: keyof ProvisionResult['grants']; sql: string }> = [
    {
      key: 'usersCatalog',
      sql: `GRANT BROWSE, USE CATALOG, USE SCHEMA, SELECT ON CATALOG ${catalogIdent} TO ${catalogUserGroupIdent}`,
    },
    {
      key: 'usersDownloadsVolume',
      sql: `GRANT ${DOWNLOADS_VOLUME_USER_PRIVILEGES} ON VOLUME ${catalogIdent}.${bronzeSchema.ident}.${downloadsVolumeIdent} TO ${catalogUserGroupIdent}`,
    },
  ];
  if (sp.length > 0) {
    const spIdent = quotePrincipal(sp);
    grantStmts.push(
      { key: 'catalog', sql: `GRANT USE CATALOG ON CATALOG ${catalogIdent} TO ${spIdent}` },
      ...schemaIdents.map(({ layer, ident }) => ({
        key: layer,
        sql: `GRANT ${schemaGrantPrivileges(layer)} ON SCHEMA ${catalogIdent}.${ident} TO ${spIdent}`,
      })),
      {
        key: 'pricingSchema',
        sql: `GRANT ${PRICING_SCHEMA_GRANT_PRIVILEGES} ON SCHEMA ${catalogIdent}.${pricingSchemaIdent} TO ${spIdent}`,
      },
      {
        key: 'downloadsVolume',
        sql: `GRANT ${DOWNLOADS_VOLUME_SP_PRIVILEGES} ON VOLUME ${catalogIdent}.${bronzeSchema.ident}.${downloadsVolumeIdent} TO ${spIdent}`,
      },
    );
  } else {
    warnings.push('DATABRICKS_CLIENT_ID is not set — App Service Principal grants were skipped.');
  }
  const skipReason: GrantStatus =
    sp.length > 0 ? 'skipped:not_attempted' : 'skipped:sp_id_not_configured';
  const grants: ProvisionResult['grants'] = {
    catalog: skipReason,
    usersCatalog: 'skipped:not_attempted',
    bronze: skipReason,
    silver: skipReason,
    gold: skipReason,
    pricingSchema: skipReason,
    downloadsVolume: skipReason,
    usersDownloadsVolume: 'skipped:not_attempted',
  };
  const grantResults = await Promise.all(grantStmts.map((g) => grant(executor, g.sql)));
  grantStmts.forEach((g, i) => {
    grants[g.key] = grantResults[i]!.status as GrantStatus;
  });
  for (const r of grantResults) {
    if (r.warning) warnings.push(r.warning);
  }

  return {
    catalog,
    catalogCreated,
    schemasEnsured,
    pricingSchemaEnsured,
    downloadsVolumeEnsured,
    grants,
    servicePrincipalId: sp.length > 0 ? sp : null,
    warnings,
  };
}

async function catalogExists(executor: StatementExecutor, catalog: string): Promise<boolean> {
  try {
    const escaped = catalog.replace(/'/g, "''").replace(/[%_]/g, '\\$&');
    const rows = await executor.run(
      `SHOW CATALOGS LIKE '${escaped}' ESCAPE '\\\\'`,
      [],
      z.object({ catalog: z.string().optional() }),
    );
    return rows.some((r) => r.catalog === catalog);
  } catch {
    return false;
  }
}

async function ensureSchema(
  executor: StatementExecutor,
  sql: string,
): Promise<{ status: SchemaEnsureStatus; warning: string | null }> {
  try {
    await executor.run(sql, [], z.unknown());
    return { status: 'ensured', warning: null };
  } catch (err) {
    return { status: 'error', warning: `${sql} failed: ${(err as Error).message}` };
  }
}

async function grant(
  executor: StatementExecutor,
  sql: string,
): Promise<{ status: string; warning: string | null }> {
  try {
    await executor.run(sql, [], z.unknown());
    return { status: 'granted', warning: null };
  } catch (err) {
    const msg = (err as Error).message;
    return { status: `error:${msg}`, warning: `${sql} failed: ${msg}` };
  }
}
