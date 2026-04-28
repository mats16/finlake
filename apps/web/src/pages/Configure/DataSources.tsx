import { useMemo, useState } from 'react';
import { CATALOG_SETTING_KEY, FOCUS_VIEW_SCHEMA_DEFAULT, type DataSource } from '@lakecost/shared';
import { Input, Separator } from '@databricks/appkit-ui/react';
import { useAppSettings, useCreateDataSource, useDataSources } from '../../api/hooks';
import { DataSourceTile, type TileBadge } from './DataSourceTile';
import { DataSourceDrawer } from './DataSourceDrawer';
import {
  DATA_SOURCE_TEMPLATES,
  displayDescriptionForRow,
  displayNameForRow,
  findTemplateForRow,
  type DataSourceTemplate,
} from './dataSourceCatalog';
import { tableLeafName } from '@lakecost/shared';
import { useI18n } from '../../i18n';

const FALLBACK_TEMPLATE: DataSourceTemplate = {
  templateId: 'custom-source',
  providerName: 'Custom',
  vendor: 'Custom',
  name: 'Custom data source',
  description: '',
  subtitle: '',
  defaultTableName: 'custom_source',
  setupSteps: [],
  available: true,
  brandColor: '#475467',
};

function templateForRow(row: DataSource): DataSourceTemplate {
  return findTemplateForRow(row) ?? FALLBACK_TEMPLATE;
}

function initialTableName(template: DataSourceTemplate, catalog: string): string {
  if (template.providerName !== 'Databricks' || !catalog) return template.defaultTableName;
  return `${catalog}.${FOCUS_VIEW_SCHEMA_DEFAULT}.${template.defaultTableName}`;
}

function rowMatchesTemplate(row: DataSource, template: DataSourceTemplate): boolean {
  return (
    row.providerName === template.providerName &&
    (row.name === template.name || tableLeafName(row.tableName) === template.defaultTableName)
  );
}

export function DataSources() {
  const { t } = useI18n();
  const [filter, setFilter] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const dataSources = useDataSources();
  const settings = useAppSettings();
  const createDs = useCreateDataSource();

  const rows = dataSources.data?.items ?? [];

  const filteredRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, filter]);

  const candidates = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return DATA_SOURCE_TEMPLATES.filter((tpl) => {
      if (
        tpl.providerName === 'Databricks' &&
        rows.some((row) => row.providerName === 'Databricks')
      ) {
        return false;
      }
      return q ? tpl.name.toLowerCase().includes(q) : true;
    });
  }, [filter, rows]);

  const badgesFor = (row: DataSource): TileBadge[] => {
    if (row.jobId !== null) {
      return [
        row.enabled
          ? { label: t('dataSources.badges.enabled'), variant: 'enabled' }
          : { label: t('dataSources.badges.disabled'), variant: 'disabled' },
      ];
    }
    return [
      { label: t('dataSources.badges.added'), variant: 'unknown' },
      { label: t('dataSources.badges.setupRequired'), variant: 'unknown' },
    ];
  };

  const onAddTemplate = async (tpl: DataSourceTemplate) => {
    if (!tpl.available) {
      return;
    }
    const existing = rows.find((row) => rowMatchesTemplate(row, tpl));
    if (existing) {
      setOpenId(existing.id);
      return;
    }
    const created = await createDs.mutateAsync({
      name: tpl.name,
      providerName: tpl.providerName,
      tableName: initialTableName(tpl, settings.data?.settings[CATALOG_SETTING_KEY]?.trim() ?? ''),
      description: tpl.description,
      enabled: false,
    });
    setOpenId(created.id);
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h3 className="m-0 text-base font-semibold">{t('dataSources.currentTitle')}</h3>
        <div className="flex items-center gap-3">
          <Input
            placeholder={t('dataSources.filterPlaceholder')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-9 w-52"
          />
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <p className="text-muted-foreground text-sm italic">{t('dataSources.empty')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filteredRows.map((row) => {
            const tpl = templateForRow(row);
            return (
              <DataSourceTile
                key={row.id}
                source={tpl}
                displayName={displayNameForRow(row, tpl)}
                displayDescription={displayDescriptionForRow(row, tpl)}
                badges={badgesFor(row)}
                onClick={() => setOpenId(row.id)}
              />
            );
          })}
        </div>
      )}

      <Separator className="my-8" />

      <h3 className="mb-4 text-base font-semibold">{t('dataSources.addTitle')}</h3>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {candidates.map((tpl) => {
          const existing = rows.find((row) => rowMatchesTemplate(row, tpl));
          return (
            <DataSourceTile
              key={tpl.templateId}
              source={tpl}
              badges={
                existing
                  ? badgesFor(existing)
                  : tpl.available
                    ? [{ label: t('dataSources.badges.add'), variant: 'unknown' }]
                    : [{ label: t('dataSources.badges.comingSoon'), variant: 'unknown' }]
              }
              onClick={tpl.available ? () => onAddTemplate(tpl) : undefined}
              muted={!tpl.available}
            />
          );
        })}
      </div>

      <DataSourceDrawer dataSourceId={openId} onClose={() => setOpenId(null)} />
    </>
  );
}
