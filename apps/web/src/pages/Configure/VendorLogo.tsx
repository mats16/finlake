import type { DataSourceTemplate, TemplateLogo } from './dataSourceCatalog';
import databricksSymbolUrl from '../../assets/databricks-symbol-color.png';

export function VendorLogo({
  source,
  logo,
  size = 56,
}: {
  source: DataSourceTemplate;
  logo?: TemplateLogo;
  size?: number;
}) {
  if (logo?.kind === 'databricks') {
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
        background: source.appearance.brandColor,
        color: source.appearance.brandTextColor ?? '#ffffff',
      }}
      aria-hidden
    >
      {logo?.kind === 'abbr' ? logo.label : source.id.slice(0, 3)}
    </div>
  );
}
