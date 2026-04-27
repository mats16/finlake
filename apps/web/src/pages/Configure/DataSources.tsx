import { useMemo, useState } from 'react';
import type { SetupCheckResult } from '@lakecost/shared';
import { Input, Separator } from '@databricks/appkit-ui/react';
import { ExternalLink } from 'lucide-react';
import { useSetupState } from '../../api/hooks';
import { DataSourceTile, type TileBadge, type TileMetric } from './DataSourceTile';
import { DataSourceDrawer } from './DataSourceDrawer';
import { DATA_SOURCE_CATALOG, type DataSourceDefinition } from './dataSourceCatalog';
import { useI18n } from '../../i18n';

export function DataSources() {
  const { t } = useI18n();
  const [filter, setFilter] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const setupState = useSetupState();

  const { current, candidates } = useMemo(() => {
    const matches = (s: DataSourceDefinition) =>
      filter ? s.name.toLowerCase().includes(filter.toLowerCase()) : true;
    return {
      current: DATA_SOURCE_CATALOG.filter((s) => s.available && matches(s)),
      candidates: DATA_SOURCE_CATALOG.filter((s) => !s.available && matches(s)),
    };
  }, [filter]);

  const open = openId ? (DATA_SOURCE_CATALOG.find((d) => d.id === openId) ?? null) : null;

  const badgesFor = (source: DataSourceDefinition): TileBadge[] => {
    const stepResults = (setupState.data?.steps ?? []).reduce<Record<string, SetupCheckResult>>(
      (acc, s) => {
        acc[s.step] = s;
        return acc;
      },
      {},
    );

    const relevant: SetupCheckResult[] = [];
    for (const step of source.setupSteps) {
      const r = stepResults[step];
      if (r) relevant.push(r);
    }

    if (relevant.length === 0) {
      return [
        { label: t('dataSources.badges.disabled'), variant: 'disabled' },
        { label: t('dataSources.badges.notVerified'), variant: 'unknown' },
      ];
    }

    const allOk = relevant.every((r) => r.status === 'ok');
    const anyError = relevant.some((r) => r.status === 'error');

    if (allOk) {
      return [
        { label: t('dataSources.badges.enabled'), variant: 'enabled' },
        { label: t('dataSources.badges.healthy'), variant: 'healthy' },
      ];
    }
    if (anyError) {
      return [
        { label: t('dataSources.badges.disabled'), variant: 'disabled' },
        { label: t('dataSources.badges.error'), variant: 'error' },
      ];
    }
    return [
      { label: t('dataSources.badges.disabled'), variant: 'disabled' },
      { label: t('dataSources.badges.unknown'), variant: 'unknown' },
    ];
  };

  const metricFor = (source: DataSourceDefinition): TileMetric | undefined => {
    // Placeholder metrics until Phase 1c wires real per-source telemetry.
    const presets: Record<string, TileMetric> = {
      'databricks-system-tables': {
        primary: t('dataSources.metric.eventsLast30d', { count: '24.4M' }),
        secondary: t('dataSources.metric.eventsLast24h', { count: '7.2K' }),
        sparkline: [4, 6, 5, 7, 6, 8, 9],
      },
      'aws-cur': {
        primary: t('dataSources.metric.eventsLast30d', { count: '8.1M' }),
        secondary: t('dataSources.metric.eventsLast24h', { count: '210K' }),
        sparkline: [3, 4, 4, 5, 5, 6, 7],
      },
      'azure-cost-management': {
        primary: t('dataSources.metric.eventsLast30d', { count: '0' }),
        secondary: t('dataSources.metric.notIngested'),
        sparkline: [0, 0, 0, 0, 0, 0, 1],
      },
      'tagging-policy': {
        primary: t('dataSources.metric.tagCoverage', { pct: 64 }),
        secondary: t('dataSources.metric.last30d'),
        sparkline: [3, 4, 5, 5, 6, 6, 6],
      },
    };
    return presets[source.id];
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h3 className="m-0 text-base font-semibold">{t('dataSources.currentTitle')}</h3>
        <div className="flex items-center gap-3">
          <a
            className="text-primary inline-flex items-center gap-1.5 text-sm hover:underline"
            href="#"
            onClick={(e) => e.preventDefault()}
          >
            {t('dataSources.viewGold')}
            <ExternalLink className="size-3.5" />
          </a>
          <Input
            placeholder={t('dataSources.filterPlaceholder')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-9 w-52"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {current.map((s) => (
          <DataSourceTile
            key={s.id}
            source={s}
            badges={badgesFor(s)}
            metric={metricFor(s)}
            onClick={() => setOpenId(s.id)}
          />
        ))}
      </div>

      <Separator className="my-8" />

      <h3 className="mb-4 text-base font-semibold">{t('dataSources.addTitle')}</h3>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {candidates.map((s) => (
          <DataSourceTile
            key={s.id}
            source={s}
            badges={[{ label: t('dataSources.badges.comingSoon'), variant: 'unknown' }]}
            onClick={() => setOpenId(s.id)}
            muted
          />
        ))}
      </div>

      <DataSourceDrawer source={open} onClose={() => setOpenId(null)} />
    </>
  );
}
