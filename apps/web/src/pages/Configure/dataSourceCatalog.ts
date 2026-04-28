import type { SetupStepId } from '@lakecost/shared';

export type DataSourceVendor = 'Databricks' | 'AWS' | 'Azure' | 'GCP' | 'Snowflake' | 'Custom';

export interface DataSourceTemplate {
  /** Stable key used only for static i18n lookups + brand metadata. Never persisted. */
  templateId: string;
  /** `providerName` written onto new `data_sources` rows created from this template. */
  providerName: string;
  vendor: DataSourceVendor;
  name: string;
  description: string;
  subtitle: string;
  /** Sensible default for `data_sources.table_name`. User can edit later. */
  defaultTableName: string;
  /** Setup steps shown for this provider's tile (informational badges only). */
  setupSteps: SetupStepId[];
  /** When false, the template is shown under "Add data source" with a coming-soon panel. */
  available: boolean;
  brandColor: string;
  brandTextColor?: string;
}

export const DATA_SOURCE_TEMPLATES: DataSourceTemplate[] = [
  {
    templateId: 'databricks-system-tables',
    providerName: 'Databricks',
    vendor: 'Databricks',
    name: 'Databricks (FOCUS 1.3)',
    description: 'Databricks usage and list prices normalized to FOCUS 1.3',
    subtitle: '',
    defaultTableName: 'databricks_billing',
    setupSteps: ['systemTables', 'permissions'],
    available: true,
    brandColor: '#FF3621',
  },
  {
    templateId: 'aws-cur',
    providerName: 'AWS',
    vendor: 'AWS',
    name: 'AWS Cost & Usage Report',
    description: 'EC2 / EBS / S3 spend ingested via CUR 2.0 to S3',
    subtitle: 'by Amazon Web Services',
    defaultTableName: 'aws_cur',
    setupSteps: ['awsCur'],
    available: true,
    brandColor: '#FF9900',
    brandTextColor: '#232F3E',
  },
  {
    templateId: 'azure-cost-management',
    providerName: 'Azure',
    vendor: 'Azure',
    name: 'Azure Cost Management',
    description: 'Daily export of Azure Cost Management data to ADLS Gen2',
    subtitle: 'by Microsoft Azure',
    defaultTableName: 'azure_costs',
    setupSteps: ['azureExport'],
    available: true,
    brandColor: '#0078D4',
  },
  {
    templateId: 'tagging-policy',
    providerName: 'Databricks',
    vendor: 'Databricks',
    name: 'Tagging policy',
    description: 'Cost-attribution tags enforced via compute & budget policies',
    subtitle: '',
    defaultTableName: 'tagging_policy',
    setupSteps: ['tagging'],
    available: true,
    brandColor: '#1B3139',
  },
  {
    templateId: 'gcp-cloud-billing',
    providerName: 'GCP',
    vendor: 'GCP',
    name: 'GCP Cloud Billing',
    description: 'Google Cloud billing export to BigQuery, federated into the warehouse',
    subtitle: 'by Google Cloud',
    defaultTableName: 'gcp_billing',
    setupSteps: [],
    available: false,
    brandColor: '#4285F4',
  },
  {
    templateId: 'snowflake-credits',
    providerName: 'Snowflake',
    vendor: 'Snowflake',
    name: 'Snowflake credits',
    description: 'Compare warehouse credit consumption against Databricks DBUs',
    subtitle: 'by Snowflake',
    defaultTableName: 'snowflake_credits',
    setupSteps: [],
    available: false,
    brandColor: '#29B5E8',
  },
  {
    templateId: 'custom-source',
    providerName: 'Custom',
    vendor: 'Custom',
    name: 'Custom data source',
    description: 'Bring your own cost feed via Auto Loader or Lakeflow Connect',
    subtitle: 'by your team',
    defaultTableName: 'custom_source',
    setupSteps: [],
    available: false,
    brandColor: '#475467',
  },
];

export function findTemplateById(templateId: string): DataSourceTemplate | undefined {
  return DATA_SOURCE_TEMPLATES.find((t) => t.templateId === templateId);
}

/** Matches a DB row to its template using defaultTableName as disambiguator. */
export function findTemplateForRow(row: {
  providerName: string;
  tableName: string;
}): DataSourceTemplate | undefined {
  const leaf = row.tableName.split('.').pop() ?? row.tableName;
  const candidates = DATA_SOURCE_TEMPLATES.filter((t) => t.providerName === row.providerName);
  if (candidates.length <= 1) return candidates[0];
  return candidates.find((t) => t.defaultTableName === leaf) ?? candidates[0];
}

/** Legacy names that should be treated as the template's canonical name. */
export const LEGACY_TEMPLATE_NAMES: Record<string, string[]> = {
  'databricks-system-tables': ['Databricks System Tables'],
};

/** Legacy descriptions that should be treated as the template's canonical description. */
export const LEGACY_TEMPLATE_DESCRIPTIONS: Record<string, string[]> = {
  'databricks-system-tables': [
    'DBU consumption from system.billing.usage and system.billing.list_prices',
    'Databricks usage and list prices normalized to FOCUS 1.3',
    'system.billing.usage および system.billing.list_prices からの DBU 消費量',
  ],
};

export function displayNameForRow(row: { name: string }, template: DataSourceTemplate): string {
  const defaultNames = [template.name, ...(LEGACY_TEMPLATE_NAMES[template.templateId] ?? [])];
  return defaultNames.includes(row.name) ? template.name : row.name;
}

export function displayDescriptionForRow(
  row: { description: string | null },
  template: DataSourceTemplate,
): string | undefined {
  const description = row.description?.trim();
  if (!description) return undefined;
  const defaultDescriptions = [
    template.description,
    ...(LEGACY_TEMPLATE_DESCRIPTIONS[template.templateId] ?? []),
  ];
  return defaultDescriptions.includes(description) ? undefined : description;
}
