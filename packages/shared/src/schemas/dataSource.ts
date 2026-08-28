import { z } from 'zod';
import { IDENT_RE, UC_IDENTIFIER_PART_RE, type MedallionSchema } from '../sql/focusView.sql.js';

/** `app_settings` key holding the default Unity Catalog name. */
export const CATALOG_SETTING_KEY = 'catalog_name';

/** `app_settings` key holding the group that can read configured catalog data. */
export const CATALOG_USER_GROUP_SETTING_KEY = 'catalog_user_group';
export const CATALOG_USER_GROUP_DEFAULT = 'account users';

/** `app_settings` keys holding Unity Catalog schema names by medallion layer. */
export const MEDALLION_SCHEMA_SETTING_KEYS = {
  gold: 'gold_schema_name',
  silver: 'silver_schema_name',
  bronze: 'bronze_schema_name',
} as const;

export const MEDALLION_SCHEMA_DEFAULTS = {
  bronze: 'ingest',
  silver: 'focus',
  gold: 'analytics',
} as const satisfies Record<MedallionSchema, string>;

/** Fixed Unity Catalog objects used by instance price ingestion. */
export const PRICING_SCHEMA_DEFAULT = 'pricing';
export const DOWNLOADS_VOLUME_DEFAULT = 'downloads';
export const AWS_EC2_PRICING_TABLE_DEFAULT = 'aws_ec2';
export const AWS_RDS_PRICING_TABLE_DEFAULT = 'aws_rds';
export const DATABRICKS_LIST_PRICES_TABLE_DEFAULT = 'databricks_list_prices';
export const DATABRICKS_ACCOUNT_PRICES_TABLE_DEFAULT = 'databricks_account_prices';
export const PRICING_NOTEBOOK_WORKSPACE_PATH_SETTING_KEY = 'pricing_notebook_workspace_path';

/** Materialized View names FinLake creates in the gold schema. */
export const GOLD_USAGE_TABLES = {
  daily: 'usage_daily',
  monthly: 'usage_monthly',
} as const;

/** `app_settings` keys holding the shared Lakeflow pipeline/job identifiers. */
export const LAKEFLOW_PIPELINE_SETTING_KEYS = {
  pipelineId: 'lakeflow_pipeline_id',
  jobId: 'lakeflow_pipeline_job_id',
} as const;

export function medallionSchemaNamesFromSettings(
  settings: Record<string, string | undefined>,
): Record<MedallionSchema, string> {
  return {
    bronze:
      settings[MEDALLION_SCHEMA_SETTING_KEYS.bronze]?.trim() || MEDALLION_SCHEMA_DEFAULTS.bronze,
    silver:
      settings[MEDALLION_SCHEMA_SETTING_KEYS.silver]?.trim() || MEDALLION_SCHEMA_DEFAULTS.silver,
    gold: settings[MEDALLION_SCHEMA_SETTING_KEYS.gold]?.trim() || MEDALLION_SCHEMA_DEFAULTS.gold,
  };
}

export function catalogUserGroupFromSettings(settings: Record<string, string | undefined>): string {
  return settings[CATALOG_USER_GROUP_SETTING_KEY]?.trim() || CATALOG_USER_GROUP_DEFAULT;
}

export function catalogFromSettings(settings: Record<string, string | undefined>): string | null {
  return settings[CATALOG_SETTING_KEY]?.trim() || null;
}

export const DataSourceIdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(IDENT_RE, 'must match /^[A-Za-z_][A-Za-z0-9_]*$/');

export const DataSourceAccountIdSchema = z.string().min(1).max(128);

export const DEFAULT_DATABRICKS_ACCOUNT_ID = 'default';
export const PROVIDER_DATABRICKS = 'databricks';
export const PROVIDER_AWS = 'aws';
export const PROVIDER_CUSTOM = 'custom';
export const PROVIDER_GCP = 'gcp';
export const PROVIDER_SNOWFLAKE = 'snowflake';

export function normalizeProviderName(providerName: string): string {
  const lower = providerName.trim().toLowerCase();
  if (lower === 'databricks') return PROVIDER_DATABRICKS;
  if (lower === 'aws' || lower === 'amazon web services') return PROVIDER_AWS;
  if (lower === 'custom' || lower === 'custom data source') return PROVIDER_CUSTOM;
  if (lower === 'gcp' || lower === 'google cloud' || lower === 'google cloud platform') {
    return PROVIDER_GCP;
  }
  if (lower === 'snowflake') return PROVIDER_SNOWFLAKE;
  return providerName.trim();
}

export function isDatabricksProvider(providerName: string): boolean {
  return normalizeProviderName(providerName) === PROVIDER_DATABRICKS;
}

export function isAwsProvider(providerName: string): boolean {
  return normalizeProviderName(providerName) === PROVIDER_AWS;
}

export function isCustomProvider(providerName: string): boolean {
  return normalizeProviderName(providerName) === PROVIDER_CUSTOM;
}

export function isGcpProvider(providerName: string): boolean {
  return normalizeProviderName(providerName) === PROVIDER_GCP;
}

export function isSnowflakeProvider(providerName: string): boolean {
  return normalizeProviderName(providerName) === PROVIDER_SNOWFLAKE;
}

export function normalizeGcpBillingAccountId(accountId: string): string {
  return accountId.trim().replace(/_/g, '-');
}

export const GCP_DETAILED_BILLING_EXPORT_TABLE_PREFIX = 'gcp_billing_export_resource_v1_';
export const GCP_BILLING_EXPORT_RESOURCE_TABLE_PREFIX = 'gcp_billing_export_resource_';
export const GCP_DEMO_SOURCE_TAG_NAME = 'finlake_source_type';
export const GCP_DEMO_SOURCE_TAG_VALUE = 'gcp_billing_demo';
export const GCP_SOURCE_KIND_FOREIGN = 'foreign';
export const GCP_SOURCE_KIND_TAGGED_DEMO = 'tagged_delta_demo';
export const GCP_DEMO_ACCOUNT_ID = 'gcp_demo';
export const GCP_DEMO_USAGE_TABLE_NAME = 'gcp_demo_usage';

export function isGcpDetailedBillingExportTable(tableName: string): boolean {
  return tableName.trim().startsWith(GCP_DETAILED_BILLING_EXPORT_TABLE_PREFIX);
}

export function isGcpBillingExportResourceTable(tableName: string): boolean {
  return tableName.trim().startsWith(GCP_BILLING_EXPORT_RESOURCE_TABLE_PREFIX);
}

export function gcpBillingAccountIdFromTableName(tableName: string): string {
  const trimmed = tableName.trim();
  const accountId = trimmed.startsWith(GCP_DETAILED_BILLING_EXPORT_TABLE_PREFIX)
    ? trimmed.slice(GCP_DETAILED_BILLING_EXPORT_TABLE_PREFIX.length)
    : trimmed;
  return normalizeGcpBillingAccountId(accountId);
}

export function gcpUsageTableName(accountId: string): string {
  const suffix = accountId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return suffix ? `gcp_${suffix}_usage` : 'gcp_usage';
}

export function gcpDemoSourceIdFromParts(
  sourceCatalog: string,
  sourceSchema: string,
  sourceTable: string,
): string {
  const fqn = [sourceCatalog, sourceSchema, sourceTable].map((part) => part.trim()).join('.');
  const slug =
    fqn
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 96) || 'usage';
  return `gcp_demo_${slug}_${stableHash32(fqn)}`;
}

export const SNOWFLAKE_ORGANIZATION_USAGE_SCHEMA = 'ORGANIZATION_USAGE';
export const SNOWFLAKE_USAGE_IN_CURRENCY_DAILY_TABLE = 'USAGE_IN_CURRENCY_DAILY';

export function isSnowflakeUsageInCurrencyDailySource(
  sourceSchema: string,
  sourceTable: string,
): boolean {
  return (
    sourceSchema.trim().toUpperCase() === SNOWFLAKE_ORGANIZATION_USAGE_SCHEMA &&
    sourceTable.trim().toUpperCase() === SNOWFLAKE_USAGE_IN_CURRENCY_DAILY_TABLE
  );
}

export function snowflakeSourceIdFromParts(
  sourceCatalog: string,
  sourceSchema: string,
  sourceTable: string,
): string {
  const parts = [sourceCatalog, sourceSchema, sourceTable].map((part) => part.trim());
  const hashInput = parts.join('.');
  const normalized = hashInput.toLowerCase();
  const slug =
    normalized
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 96) || 'usage';
  return `snowflake_${slug}_${stableHash32(hashInput)}`;
}

function stableHash32(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export const DataSourceProviderNameSchema = z
  .string()
  .min(1)
  .max(64)
  .transform(normalizeProviderName);

export const DataSourceKeySchema = z.object({
  providerName: DataSourceProviderNameSchema,
  accountId: DataSourceAccountIdSchema,
});
export type DataSourceKey = z.infer<typeof DataSourceKeySchema>;

export function toDataSourceKey(source: {
  providerName: string;
  accountId: string;
}): DataSourceKey {
  return { providerName: source.providerName, accountId: source.accountId };
}

export function dataSourceKeyString(key: { providerName: string; accountId: string }): string {
  return `${key.providerName}:${key.accountId}`;
}

export function isDatabricksDefaultAccount(source: {
  providerName: string;
  accountId: string;
}): boolean {
  return (
    isDatabricksProvider(source.providerName) && source.accountId === DEFAULT_DATABRICKS_ACCOUNT_ID
  );
}

export const DataSourceTableNameSchema = z
  .string()
  .min(1)
  .max(384)
  .refine((value) => {
    const parts = value.split('.');
    return (
      parts.length >= 1 &&
      parts.length <= 3 &&
      parts.every((part) => UC_IDENTIFIER_PART_RE.test(part))
    );
  }, 'must be one to three dot-separated Unity Catalog identifiers');

const DataSourcePipelineIdInputSchema = z
  .string()
  .max(256)
  .transform((value) => value.trim())
  .refine((value) => value.length > 0, 'must be non-empty');

export const DataSourceSchema = z.object({
  name: z.string().min(1).max(256),
  providerName: DataSourceProviderNameSchema,
  accountId: DataSourceAccountIdSchema,
  tableName: DataSourceTableNameSchema,
  focusVersion: z.string().min(1).max(32).nullable(),
  pipelineId: z.string().min(1).nullable(),
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()),
  updatedAt: z.string().datetime(),
});
export type DataSource = z.infer<typeof DataSourceSchema>;

export const DataSourceCreateBodySchema = z.object({
  templateId: z.string().min(1).max(128),
  name: z.string().min(1).max(256),
  providerName: DataSourceProviderNameSchema,
  accountId: DataSourceAccountIdSchema.optional(),
  tableName: DataSourceTableNameSchema,
  pipelineId: DataSourcePipelineIdInputSchema.nullable().optional(),
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type DataSourceCreateBody = z.infer<typeof DataSourceCreateBodySchema>;

export const DataSourceUpdateBodySchema = z.object({
  name: z.string().min(1).max(256).optional(),
  tableName: DataSourceTableNameSchema.optional(),
  pipelineId: DataSourcePipelineIdInputSchema.nullable().optional(),
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type DataSourceUpdateBody = z.infer<typeof DataSourceUpdateBodySchema>;

export const CustomDataSourcePipelineOptionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  state: z.string().nullable(),
});
export type CustomDataSourcePipelineOption = z.infer<typeof CustomDataSourcePipelineOptionSchema>;

export const CustomDataSourceTableOptionSchema = z.object({
  catalog: z.string().min(1),
  schema: z.string().min(1),
  name: z.string().min(1),
  fullName: DataSourceTableNameSchema,
  tableType: z.string().nullable(),
});
export type CustomDataSourceTableOption = z.infer<typeof CustomDataSourceTableOptionSchema>;

export const CustomDataSourceOptionsResponseSchema = z.object({
  defaultCatalog: z.string().nullable(),
  defaultSchema: z.string(),
  pipelines: z.array(CustomDataSourcePipelineOptionSchema),
  tables: z.array(CustomDataSourceTableOptionSchema),
});
export type CustomDataSourceOptionsResponse = z.infer<typeof CustomDataSourceOptionsResponseSchema>;

export const DATABRICKS_FOCUS_VERSION = '1.3';
export const AWS_FOCUS_VERSION = '1.2';
export const GCP_FOCUS_VERSION = '1.2';
export const SNOWFLAKE_FOCUS_VERSION = '1.2';

export const DataSourceTemplateSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(256),
  description: z.string().max(2048),
  subtitle: z.string().max(256),
  focus_version: z.string().min(1).max(32).nullable(),
  available: z.boolean(),
  appearance: z.object({
    brandColor: z.string().min(1).max(32),
    brandTextColor: z.string().min(1).max(32).optional(),
  }),
});
export type DataSourceTemplate = z.infer<typeof DataSourceTemplateSchema>;

export const DATA_SOURCE_TEMPLATES = [
  {
    id: 'databricks_focus13',
    name: 'Databricks',
    description: 'System tables transformed to FOCUS format',
    subtitle: '',
    focus_version: DATABRICKS_FOCUS_VERSION,
    available: true,
    appearance: {
      brandColor: '#FF3621',
    },
  },
  {
    id: 'aws',
    name: 'AWS',
    description: 'Billing and Cost Management',
    subtitle: '',
    focus_version: AWS_FOCUS_VERSION,
    available: true,
    appearance: {
      brandColor: '#FF9900',
      brandTextColor: '#232F3E',
    },
  },
  {
    id: 'custom',
    name: 'Custom',
    description: 'Register an externally managed FOCUS table and Lakeflow pipeline',
    subtitle: 'by your team',
    focus_version: null,
    available: true,
    appearance: {
      brandColor: '#475467',
    },
  },
  {
    id: 'gcp',
    name: 'Google Cloud',
    description: 'BigQuery detailed billing export',
    subtitle: 'by Google Cloud',
    focus_version: GCP_FOCUS_VERSION,
    available: true,
    appearance: {
      brandColor: '#4285F4',
    },
  },
  {
    id: 'snowflake',
    name: 'Snowflake',
    description: 'Organization usage in currency',
    subtitle: 'by Snowflake',
    focus_version: SNOWFLAKE_FOCUS_VERSION,
    available: true,
    appearance: {
      brandColor: '#29B5E8',
    },
  },
] satisfies DataSourceTemplate[];

/**
 * Default Quartz cron for Databricks system.billing usage refresh — daily at
 * 21:00 UTC, which is 06:00 the next day in Japan Standard Time.
 */
export const FOCUS_REFRESH_CRON_DEFAULT = '0 0 21 * * ?';
export const FOCUS_REFRESH_TIMEZONE_DEFAULT = 'UTC';

export const DataSourceSetupBodySchema = z.object({
  tableName: DataSourceTableNameSchema.optional(),
  accountPricesTable: z.string().min(1).max(256).optional(),
  warehouseId: z.string().min(1).max(256).optional(),
});
export type DataSourceSetupBody = z.infer<typeof DataSourceSetupBodySchema>;

export const DataSourceSetupResultSchema = z.object({
  dataSourceKey: DataSourceKeySchema,
  jobId: z.number().int().positive(),
  pipelineId: z.string().min(1),
  fqn: z.string(),
  goldFqn: z.string(),
  cronExpression: z.string(),
  timezoneId: z.string(),
  createdView: z.boolean(),
});
export type DataSourceSetupResult = z.infer<typeof DataSourceSetupResultSchema>;

export const DataSourcePermissionStepSchema = z.object({
  label: z.string(),
  status: z.enum(['ok', 'warning', 'error']),
  message: z.string(),
});
export type DataSourcePermissionStep = z.infer<typeof DataSourcePermissionStepSchema>;

export const DataSourceSystemTableGrantsBodySchema = z.object({
  accountPricesTable: z.string().min(1).max(256).optional(),
  warehouseId: z.string().min(1).max(256).optional(),
});
export type DataSourceSystemTableGrantsBody = z.infer<typeof DataSourceSystemTableGrantsBodySchema>;

export const DataSourceSystemTableGrantsResultSchema = z.object({
  dataSourceKey: DataSourceKeySchema,
  servicePrincipalId: z.string().min(1).nullable(),
  tables: z.array(z.string()),
  steps: z.array(DataSourcePermissionStepSchema),
  remediationSql: z.string().nullable(),
  warnings: z.array(z.string()),
});
export type DataSourceSystemTableGrantsResult = z.infer<
  typeof DataSourceSystemTableGrantsResultSchema
>;

export const DataSourcePreflightBodySchema = DataSourceSetupBodySchema;
export type DataSourcePreflightBody = z.infer<typeof DataSourcePreflightBodySchema>;

export const DataSourcePreflightResultSchema = z.object({
  dataSourceKey: DataSourceKeySchema,
  servicePrincipalId: z.string().min(1).nullable(),
  ok: z.boolean(),
  steps: z.array(DataSourcePermissionStepSchema),
  remediationSql: z.string().nullable(),
  warnings: z.array(z.string()),
});
export type DataSourcePreflightResult = z.infer<typeof DataSourcePreflightResultSchema>;

export const DataSourceRunResultSchema = z.object({
  dataSourceKey: DataSourceKeySchema,
  pipelineId: z.string().min(1),
  updateId: z.string().min(1),
  requestId: z.string().min(1).nullable(),
});
export type DataSourceRunResult = z.infer<typeof DataSourceRunResultSchema>;

/** Extracts the last dot-separated segment of a qualified table name. */
export function tableLeafName(tableName: string): string {
  const parts = tableName.split('.');
  return parts[parts.length - 1] ?? tableName;
}

/** Joins catalog, schema, table into an unquoted fully-qualified name. */
export function unquotedFqn(catalog: string, schema: string, table: string): string {
  return `${catalog}.${schema}.${table}`;
}
