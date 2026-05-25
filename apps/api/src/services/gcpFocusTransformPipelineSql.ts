import { readFileSync } from 'node:fs';
import { IDENT_RE, normalizeGcpBillingAccountId, quoteIdent } from '@finlake/shared';

const GCP_DETAILED_EXPORT_PREFIX = 'gcp_billing_export_resource_v1_';

export function isGcpDetailedBillingExportTable(tableName: string): boolean {
  return tableName.trim().startsWith(GCP_DETAILED_EXPORT_PREFIX);
}

export function gcpBillingAccountIdFromTableName(tableName: string): string {
  const trimmed = tableName.trim();
  const accountId = trimmed.startsWith(GCP_DETAILED_EXPORT_PREFIX)
    ? trimmed.slice(GCP_DETAILED_EXPORT_PREFIX.length)
    : trimmed;
  return normalizeGcpBillingAccountId(accountId);
}

export function gcpUsageTableName(accountId: string): string {
  const suffix = accountId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!suffix) return 'gcp_usage';
  return `gcp_${suffix}_usage`;
}

export function buildGcpFocusSilverPipelineSql(opts: {
  tableName: string;
  sourceCatalog: string;
  sourceSchema: string;
  sourceTable: string;
}): string {
  if (!IDENT_RE.test(opts.tableName)) {
    throw new Error(`Invalid table identifier "${opts.tableName}"`);
  }
  if (!isGcpDetailedBillingExportTable(opts.sourceTable)) {
    throw new Error(
      `Google Cloud source table must be the resource-level detailed export table matching ${GCP_DETAILED_EXPORT_PREFIX}<BILLING_ACCOUNT_ID>`,
    );
  }
  return gcpSilverTemplate
    .replaceAll('${table_name}', quoteIdent(opts.tableName))
    .replaceAll(
      '${source_fqn}',
      quotePossiblyQualified([opts.sourceCatalog, opts.sourceSchema, opts.sourceTable]),
    );
}

function quotePossiblyQualified(parts: string[]): string {
  return parts.map(quoteBacktickEscaped).join('.');
}

function quoteBacktickEscaped(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Source table identifier parts must not be empty.');
  return `\`${trimmed.replace(/`/g, '``')}\``;
}

function readGcpSilverTemplate(): string {
  const templateCandidates = [
    new URL('../sql/gcpFocusTransformPipeline.sql', import.meta.url),
    new URL('../../src/sql/gcpFocusTransformPipeline.sql', import.meta.url),
  ];
  for (const candidate of templateCandidates) {
    try {
      return readFileSync(candidate, 'utf8');
    } catch {
      // Try the next location. Dev may run from src, production from dist.
    }
  }
  throw new Error('gcpFocusTransformPipeline.sql template not found');
}

const gcpSilverTemplate = readGcpSilverTemplate();
