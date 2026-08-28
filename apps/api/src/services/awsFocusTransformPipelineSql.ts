import { readFileSync } from 'node:fs';
import { IDENT_RE } from '@finlake/shared';

function validateAwsFocusSource(
  tableName: string,
  s3Bucket: string,
  s3Prefix: string,
  exportName: string,
): void {
  if (!IDENT_RE.test(tableName)) {
    throw new Error(`Invalid table identifier "${tableName}"`);
  }
  if (!s3Bucket || s3Bucket.includes('/')) {
    throw new Error(`Invalid S3 bucket "${s3Bucket}"`);
  }
  if (!s3Prefix || s3Prefix.endsWith('/') || s3Prefix.endsWith('.')) {
    throw new Error(`Invalid S3 prefix "${s3Prefix}"`);
  }
  if (!exportName) {
    throw new Error(`AWS export name is required`);
  }
}

export function awsUsageTableName(accountId: string): string {
  if (!/^\d{12}$/.test(accountId)) {
    throw new Error(`Invalid AWS account id "${accountId}": expected 12 digits`);
  }
  return `aws_${accountId}_usage`;
}

export function buildAwsFocusSilverPipelineSource(opts: {
  tableName: string;
  s3Bucket: string;
  s3Prefix: string;
  exportName: string;
}): string {
  validateAwsFocusSource(opts.tableName, opts.s3Bucket, opts.s3Prefix, opts.exportName);
  const replacements: Record<string, string> = {
    __TABLE_NAME__: JSON.stringify(opts.tableName),
    __S3_BUCKET__: JSON.stringify(opts.s3Bucket),
    __S3_PREFIX__: JSON.stringify(opts.s3Prefix),
    __EXPORT_NAME__: JSON.stringify(opts.exportName),
  };
  return pipelineTemplate.replace(
    /__TABLE_NAME__|__S3_BUCKET__|__S3_PREFIX__|__EXPORT_NAME__/g,
    (placeholder) => replacements[placeholder]!,
  );
}

// Definite assignment: the guard below throws if no candidate is found.
let pipelineTemplate!: string;
const candidates = [
  new URL('../scripts/aws_focus_ingest.py', import.meta.url),
  new URL('../../src/scripts/aws_focus_ingest.py', import.meta.url),
];
for (const candidate of candidates) {
  try {
    pipelineTemplate = readFileSync(candidate, 'utf8');
    break;
  } catch {
    // Try the next location. Dev may run from src, production from dist.
  }
}
if (!pipelineTemplate) {
  throw new Error('aws_focus_ingest.py template not found');
}
