import {
  IDENT_RE,
  MEDALLION_SCHEMAS,
  type CatalogSummary,
  type Env,
  type MedallionSchema,
  type ProvisionResult,
} from '@lakecost/shared';
import { logger } from '../config/logger.js';
import {
  buildUserExecutor,
  buildUserWorkspaceClient,
  type StatementExecutor,
} from './statementExecution.js';
import { z } from 'zod';

/** Catalogs hidden from the picker — not user-selectable for FOCUS provisioning. */
const HIDDEN_CATALOG_NAMES = new Set(['system', 'samples', '__databricks_internal']);
/** Catalog types that can't host customer-managed schemas / FOCUS materialized views. */
const HIDDEN_CATALOG_TYPES = new Set(['DELTASHARING_CATALOG']);

interface CatalogInfoLike {
  name?: string;
  catalog_type?: string;
  comment?: string;
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

/** Validates a catalog or schema name against the same identifier rule used by FOCUS targets. */
export function validateCatalogIdentifier(name: string): string {
  if (!IDENT_RE.test(name)) {
    throw new Error(
      `Invalid identifier "${name}": must match /^[A-Za-z_][A-Za-z0-9_]*$/ (no quoting required).`,
    );
  }
  return name;
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

export class CatalogServiceError extends Error {
  override readonly name = 'CatalogServiceError';
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function isPermissionDenied(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /PERMISSION_DENIED|not authorized/i.test(message);
}

interface ProvisionOptions {
  createIfMissing?: boolean;
}

/**
 * Provisions the medallion layout (`bronze` / `silver` / `gold`) under
 * `catalog`, optionally creating the catalog itself, and grants the App
 * Service Principal the minimum read access needed by `system.billing.*`
 * style aggregates.
 *
 * All DDL/GRANT statements are run **as the calling user** (OBO) so the SP
 * does not need any prior privileges. The user must have `CREATE CATALOG`
 * (when `createIfMissing`) and `CREATE SCHEMA` / ownership on the target
 * catalog.
 *
 * Failures of any single step are captured in the result rather than thrown
 * — the `app_settings` write should not roll back just because (e.g.) one
 * GRANT was rejected.
 */
export async function provisionCatalog(
  env: Env,
  userToken: string | undefined,
  catalog: string,
  opts: ProvisionOptions = {},
): Promise<ProvisionResult> {
  validateCatalogIdentifier(catalog);
  for (const s of MEDALLION_SCHEMAS) validateCatalogIdentifier(s);

  const executor = buildUserExecutor(env, userToken);
  if (!executor) {
    throw new CatalogServiceError(
      'OBO access token + DATABRICKS_HOST + SQL_WAREHOUSE_ID required to provision a catalog.',
      400,
    );
  }

  const sp = (env.DATABRICKS_CLIENT_ID ?? '').trim();
  const warnings: string[] = [];
  const result: ProvisionResult = {
    catalog,
    catalogCreated: false,
    schemasEnsured: { bronze: 'existed', silver: 'existed', gold: 'existed' },
    grants: {
      catalog: 'skipped:sp_id_not_configured',
      bronze: 'skipped:sp_id_not_configured',
      silver: 'skipped:sp_id_not_configured',
      gold: 'skipped:sp_id_not_configured',
    },
    servicePrincipalId: sp.length > 0 ? sp : null,
    warnings,
  };

  if (opts.createIfMissing) {
    const sql = `CREATE CATALOG IF NOT EXISTS \`${catalog}\``;
    try {
      const before = await catalogExists(executor, catalog);
      await executor.run(sql, [], z.unknown());
      const after = await catalogExists(executor, catalog);
      result.catalogCreated = !before && after;
    } catch (err) {
      throw new CatalogServiceError(
        `CREATE CATALOG failed for \`${catalog}\`: ${(err as Error).message}`,
        isPermissionDenied(err) ? 403 : 500,
      );
    }
  }

  for (const schema of MEDALLION_SCHEMAS) {
    result.schemasEnsured[schema] = await ensureSchema(executor, catalog, schema, warnings);
  }

  if (sp.length > 0) {
    result.grants.catalog = await grant(
      executor,
      `GRANT USE CATALOG ON CATALOG \`${catalog}\` TO \`${sp}\``,
      warnings,
    );
    for (const schema of MEDALLION_SCHEMAS) {
      result.grants[schema] = await grant(
        executor,
        `GRANT USE SCHEMA, SELECT ON SCHEMA \`${catalog}\`.\`${schema}\` TO \`${sp}\``,
        warnings,
      );
    }
  } else {
    warnings.push(
      'DATABRICKS_CLIENT_ID is not set — App Service Principal grants were skipped.',
    );
  }

  return result;
}

async function catalogExists(
  executor: StatementExecutor,
  catalog: string,
): Promise<boolean> {
  try {
    const rows = await executor.run(
      `SHOW CATALOGS LIKE '${catalog.replace(/'/g, "''")}'`,
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
  catalog: string,
  schema: MedallionSchema,
  warnings: string[],
): Promise<'created' | 'existed' | 'error'> {
  const before = await schemaExists(executor, catalog, schema);
  try {
    await executor.run(
      `CREATE SCHEMA IF NOT EXISTS \`${catalog}\`.\`${schema}\``,
      [],
      z.unknown(),
    );
  } catch (err) {
    warnings.push(
      `CREATE SCHEMA \`${catalog}\`.\`${schema}\` failed: ${(err as Error).message}`,
    );
    return 'error';
  }
  return before ? 'existed' : 'created';
}

async function schemaExists(
  executor: StatementExecutor,
  catalog: string,
  schema: string,
): Promise<boolean> {
  try {
    const rows = await executor.run(
      `SHOW SCHEMAS IN \`${catalog}\` LIKE '${schema.replace(/'/g, "''")}'`,
      [],
      z.object({
        databaseName: z.string().optional(),
        schemaName: z.string().optional(),
      }),
    );
    return rows.some((r) => (r.databaseName ?? r.schemaName) === schema);
  } catch {
    return false;
  }
}

async function grant(
  executor: StatementExecutor,
  sql: string,
  warnings: string[],
): Promise<string> {
  try {
    await executor.run(sql, [], z.unknown());
    return 'granted';
  } catch (err) {
    const msg = (err as Error).message;
    warnings.push(`${sql} failed: ${msg}`);
    return `error:${msg}`;
  }
}
