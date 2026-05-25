import { readFileSync } from 'node:fs';
import {
  GCP_DETAILED_BILLING_EXPORT_TABLE_PREFIX,
  IDENT_RE,
  isGcpDetailedBillingExportTable as sharedIsGcpDetailedBillingExportTable,
  quoteIdent,
} from '@finlake/shared';

export function buildGcpFocusSilverPipelineSql(opts: {
  tableName: string;
  sourceCatalog: string;
  sourceSchema: string;
  sourceTable: string;
}): string {
  if (!IDENT_RE.test(opts.tableName)) {
    throw new Error(`Invalid table identifier "${opts.tableName}"`);
  }
  if (!sharedIsGcpDetailedBillingExportTable(opts.sourceTable)) {
    throw new Error(
      `Google Cloud source table must be the resource-level detailed export table matching ${GCP_DETAILED_BILLING_EXPORT_TABLE_PREFIX}<BILLING_ACCOUNT_ID>`,
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
