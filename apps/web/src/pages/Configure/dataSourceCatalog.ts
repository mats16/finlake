import type { SetupStepId } from '@lakecost/shared';

export type DataSourceStatus = 'enabled' | 'disabled' | 'unconfigured';
export type DataSourceHealth = 'healthy' | 'error' | 'unknown';

export interface DataSourceDefinition {
  id: string;
  name: string;
  vendor: 'Databricks' | 'AWS' | 'Azure' | 'GCP' | 'Snowflake' | 'Custom';
  description: string;
  subtitle: string;
  /** Maps to one or more setup steps used to verify this source */
  setupSteps: SetupStepId[];
  /** When false, the source is shown under "Add data source" only */
  available: boolean;
  /** Brand color for the logo tile */
  brandColor: string;
  brandTextColor?: string;
}

export const DATA_SOURCE_CATALOG: DataSourceDefinition[] = [
  {
    id: 'databricks-system-tables',
    name: 'Databricks System Tables',
    vendor: 'Databricks',
    description: 'DBU consumption from system.billing.usage and system.billing.list_prices',
    subtitle: 'by Databricks',
    setupSteps: ['systemTables', 'permissions'],
    available: true,
    brandColor: '#FF3621',
  },
  {
    id: 'aws-cur',
    name: 'AWS Cost & Usage Report',
    vendor: 'AWS',
    description: 'EC2 / EBS / S3 spend ingested via CUR 2.0 to S3',
    subtitle: 'by Amazon Web Services',
    setupSteps: ['awsCur'],
    available: true,
    brandColor: '#FF9900',
    brandTextColor: '#232F3E',
  },
  {
    id: 'azure-cost-management',
    name: 'Azure Cost Management',
    vendor: 'Azure',
    description: 'Daily export of Azure Cost Management data to ADLS Gen2',
    subtitle: 'by Microsoft Azure',
    setupSteps: ['azureExport'],
    available: true,
    brandColor: '#0078D4',
  },
  {
    id: 'tagging-policy',
    name: 'Tagging policy',
    vendor: 'Databricks',
    description: 'Cost-attribution tags enforced via compute & budget policies',
    subtitle: 'by Databricks',
    setupSteps: ['tagging'],
    available: true,
    brandColor: '#1B3139',
  },
  {
    id: 'gcp-cloud-billing',
    name: 'GCP Cloud Billing',
    vendor: 'GCP',
    description: 'Google Cloud billing export to BigQuery, federated into the warehouse',
    subtitle: 'by Google Cloud',
    setupSteps: [],
    available: false,
    brandColor: '#4285F4',
  },
  {
    id: 'snowflake-credits',
    name: 'Snowflake credits',
    vendor: 'Snowflake',
    description: 'Compare warehouse credit consumption against Databricks DBUs',
    subtitle: 'by Snowflake',
    setupSteps: [],
    available: false,
    brandColor: '#29B5E8',
  },
  {
    id: 'custom-source',
    name: 'Custom data source',
    vendor: 'Custom',
    description: 'Bring your own cost feed via Auto Loader or Lakeflow Connect',
    subtitle: 'by your team',
    setupSteps: [],
    available: false,
    brandColor: '#475467',
  },
];

export function findDataSource(id: string): DataSourceDefinition | undefined {
  return DATA_SOURCE_CATALOG.find((d) => d.id === id);
}
