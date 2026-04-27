import type { ReactNode } from 'react';
import type { DataSourceDefinition } from './dataSourceCatalog';
import { VendorLogo } from './VendorLogo';
import { Sparkline } from './Sparkline';
import { useI18n } from '../../i18n';

export interface TileMetric {
  primary: string;
  secondary?: string;
  sparkline?: number[];
}

export interface TileBadge {
  label: string;
  variant: 'enabled' | 'disabled' | 'healthy' | 'error' | 'unknown';
}

interface Props {
  source: DataSourceDefinition;
  badges?: TileBadge[];
  metric?: TileMetric;
  onClick?: () => void;
  rightAccessory?: ReactNode;
  muted?: boolean;
}

export function DataSourceTile({
  source,
  badges = [],
  metric,
  onClick,
  rightAccessory,
  muted,
}: Props) {
  const { t } = useI18n();
  const description = t(`dataSources.catalog.${source.id}.description`);
  const subtitle = t(`dataSources.catalog.${source.id}.subtitle`);
  return (
    <button
      type="button"
      className={`tile ${muted ? 'tile-muted' : ''}`}
      onClick={onClick}
      disabled={!onClick}
    >
      <div className="tile-head">
        <div className="tile-title">
          <h4>{source.name}</h4>
          <p>{description}</p>
          <p className="muted">{subtitle}</p>
        </div>
        <div className="tile-badges">
          {badges.map((b) => (
            <span key={b.label} className={`pill pill-${b.variant}`}>
              {b.label}
            </span>
          ))}
        </div>
      </div>

      <div className="tile-body">
        <VendorLogo source={source} />
        {rightAccessory ? <div className="tile-accessory">{rightAccessory}</div> : null}
      </div>

      <div className="tile-foot">
        <div className="tile-metric">
          {metric ? (
            <>
              <strong>{metric.primary}</strong>
              {metric.secondary ? <span>{metric.secondary}</span> : null}
            </>
          ) : (
            <span className="muted">{t('dataSources.tileNoHistory')}</span>
          )}
        </div>
        {metric?.sparkline ? <Sparkline values={metric.sparkline} /> : null}
      </div>
    </button>
  );
}
