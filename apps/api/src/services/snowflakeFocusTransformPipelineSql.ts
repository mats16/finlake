import { readFileSync } from 'node:fs';
import {
  SNOWFLAKE_ORGANIZATION_USAGE_SCHEMA,
  SNOWFLAKE_USAGE_IN_CURRENCY_DAILY_TABLE,
  UC_IDENTIFIER_PART_RE,
  isSnowflakeUsageInCurrencyDailySource,
  quoteIdent,
} from '@finlake/shared';

export function buildSnowflakeFocusSilverPipelineSql(opts: {
  tableName: string;
  sourceCatalog: string;
  sourceSchema: string;
  sourceTable: string;
}): string {
  if (!UC_IDENTIFIER_PART_RE.test(opts.tableName)) {
    throw new Error(`Invalid table identifier "${opts.tableName}"`);
  }
  if (!isSnowflakeUsageInCurrencyDailySource(opts.sourceSchema, opts.sourceTable)) {
    throw new Error(
      `Snowflake source table must be ${SNOWFLAKE_ORGANIZATION_USAGE_SCHEMA}.${SNOWFLAKE_USAGE_IN_CURRENCY_DAILY_TABLE}`,
    );
  }
  return snowflakeSilverTemplate
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

function readSnowflakeSilverTemplate(): string {
  const templateCandidates = [
    new URL('../sql/snowflakeFocusTransformPipeline.sql', import.meta.url),
    new URL('../../src/sql/snowflakeFocusTransformPipeline.sql', import.meta.url),
  ];
  for (const candidate of templateCandidates) {
    try {
      return readFileSync(candidate, 'utf8');
    } catch {
      // Try the next location. Dev may run from src, production from dist.
    }
  }
  throw new Error('snowflakeFocusTransformPipeline.sql template not found');
}

const snowflakeSilverTemplate = readSnowflakeSilverTemplate();
