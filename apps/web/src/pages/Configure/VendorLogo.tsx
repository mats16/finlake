import type { DataSourceDefinition } from './dataSourceCatalog';

const ABBR: Record<DataSourceDefinition['vendor'], string> = {
  Databricks: 'DBR',
  AWS: 'AWS',
  Azure: 'AZ',
  GCP: 'GCP',
  Snowflake: 'SF',
  Custom: 'src',
};

export function VendorLogo({ source, size = 56 }: { source: DataSourceDefinition; size?: number }) {
  return (
    <div
      className="vendor-logo"
      style={{
        width: size,
        height: size,
        background: source.brandColor,
        color: source.brandTextColor ?? '#ffffff',
      }}
      aria-hidden
    >
      {ABBR[source.vendor]}
    </div>
  );
}
