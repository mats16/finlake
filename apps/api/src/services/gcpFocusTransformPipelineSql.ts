import { readFileSync } from 'node:fs';
import {
  GCP_DETAILED_BILLING_EXPORT_TABLE_PREFIX,
  GCP_SOURCE_KIND_FOREIGN,
  GCP_SOURCE_KIND_TAGGED_DEMO,
  IDENT_RE,
  isGcpDetailedBillingExportTable,
  quoteIdent,
} from '@finlake/shared';

export function buildGcpFocusSilverPipelineSql(opts: {
  tableName: string;
  sourceCatalog: string;
  sourceSchema: string;
  sourceTable: string;
  sourceKind?: string;
}): string {
  if (!IDENT_RE.test(opts.tableName)) {
    throw new Error(`Invalid table identifier "${opts.tableName}"`);
  }
  const sourceKind = opts.sourceKind ?? GCP_SOURCE_KIND_FOREIGN;
  if (sourceKind !== GCP_SOURCE_KIND_FOREIGN && sourceKind !== GCP_SOURCE_KIND_TAGGED_DEMO) {
    throw new Error(`Unsupported Google Cloud source kind: ${sourceKind}`);
  }
  if (
    sourceKind === GCP_SOURCE_KIND_FOREIGN &&
    !isGcpDetailedBillingExportTable(opts.sourceTable)
  ) {
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
