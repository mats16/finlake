import type { ReactNode } from 'react';
import { Badge, Card, CardContent } from '@databricks/appkit-ui/react';
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

const BADGE_VARIANT: Record<TileBadge['variant'], React.ComponentProps<typeof Badge>['variant']> = {
  enabled: 'default',
  disabled: 'secondary',
  healthy: 'default',
  error: 'destructive',
  unknown: 'outline',
};

const BADGE_CLASSES: Record<TileBadge['variant'], string> = {
  enabled: 'bg-(--success)/15 text-(--success) border-(--success)/30',
  disabled: '',
  healthy: 'bg-(--success)/15 text-(--success) border-(--success)/30',
  error: '',
  unknown: 'bg-(--warning)/15 text-(--warning) border-(--warning)/30',
};

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
  const interactive = Boolean(onClick);

  return (
    <Card
      data-slot="card"
      onClick={onClick}
      onKeyDown={(e) => {
        if (!interactive) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : -1}
      aria-disabled={!interactive}
      className={[
        'flex flex-col gap-4 p-4 text-left transition-colors',
        interactive
          ? 'hover:border-primary focus-visible:border-primary cursor-pointer'
          : 'cursor-default',
        muted ? 'opacity-75' : '',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="m-0 text-base font-semibold">{source.name}</h4>
          <p className="text-muted-foreground mt-1 text-xs">{description}</p>
          <p className="text-muted-foreground mt-0.5 text-[11px]">{subtitle}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {badges.map((b) => (
            <Badge
              key={b.label}
              variant={BADGE_VARIANT[b.variant]}
              className={BADGE_CLASSES[b.variant]}
            >
              {b.label}
            </Badge>
          ))}
        </div>
      </div>

      <CardContent className="flex min-h-14 items-center justify-center px-0">
        <VendorLogo source={source} />
        {rightAccessory ? <div className="ml-auto">{rightAccessory}</div> : null}
      </CardContent>

      <div className="flex items-end justify-between text-xs">
        <div>
          {metric ? (
            <>
              <strong className="text-foreground block text-[13px] font-semibold">
                {metric.primary}
              </strong>
              {metric.secondary ? (
                <span className="text-muted-foreground text-[11px]">{metric.secondary}</span>
              ) : null}
            </>
          ) : (
            <span className="text-muted-foreground italic">{t('dataSources.tileNoHistory')}</span>
          )}
        </div>
        {metric?.sparkline ? <Sparkline values={metric.sparkline} /> : null}
      </div>
    </Card>
  );
}
