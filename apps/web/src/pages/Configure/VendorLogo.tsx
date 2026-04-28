import type { DataSourceTemplate, DataSourceVendor } from './dataSourceCatalog';
import databricksSymbolUrl from '../../assets/databricks-symbol-color.png';

const ABBR: Record<DataSourceVendor, string> = {
  Databricks: 'DBR',
  AWS: 'AWS',
  Azure: 'AZ',
  GCP: 'GCP',
  Snowflake: 'SF',
  Custom: 'src',
};

export function VendorLogo({ source, size = 56 }: { source: DataSourceTemplate; size?: number }) {
  if (source.vendor === 'Databricks') {
    return (
      <img
        src={databricksSymbolUrl}
        width={size}
        height={size}
        className="object-contain"
        alt=""
        aria-hidden
      />
    );
  }

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
