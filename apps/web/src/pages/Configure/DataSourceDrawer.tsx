import { useEffect } from 'react';
import { useRunSetupCheck } from '../../api/hooks';
import { StepResult } from '../SetupWizard/StepResult';
import type { DataSourceDefinition } from './dataSourceCatalog';
import { useState } from 'react';
import type { SetupCheckResult, SetupStepId } from '@lakecost/shared';
import { useI18n } from '../../i18n';

interface Props {
  source: DataSourceDefinition | null;
  onClose: () => void;
}

export function DataSourceDrawer({ source, onClose }: Props) {
  const { t } = useI18n();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (source) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [source, onClose]);

  if (!source) return null;

  const description = t(`dataSources.catalog.${source.id}.description`);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} role="presentation" />
      <aside className="drawer" role="dialog" aria-label={source.name}>
        <header className="drawer-head">
          <div>
            <h3>{source.name}</h3>
            <p>{description}</p>
          </div>
          <button type="button" className="drawer-close" onClick={onClose}>
            {t('common.close')}
          </button>
        </header>
        <div className="drawer-body">
          {source.available ? (
            <Configurator source={source} />
          ) : (
            <div className="banner unknown">{t('dataSources.drawer.notImplemented')}</div>
          )}
        </div>
      </aside>
    </>
  );
}

function Configurator({ source }: { source: DataSourceDefinition }) {
  const { t } = useI18n();
  const [results, setResults] = useState<Partial<Record<SetupStepId, SetupCheckResult>>>({});
  const [bucket, setBucket] = useState('');
  const [storageAccount, setStorageAccount] = useState('');
  const check = useRunSetupCheck();

  const run = async (step: SetupStepId, body?: Record<string, unknown>) => {
    const result = await check.mutateAsync({ step, body });
    setResults((prev) => ({ ...prev, [step]: result }));
  };

  return (
    <>
      {source.id === 'databricks-system-tables' ? (
        <>
          <Section title={t('dataSources.systemTables.step1')}>
            <button
              type="button"
              className="btn"
              disabled={check.isPending}
              onClick={() => run('systemTables')}
            >
              {t('dataSources.systemTables.verifySchemas')}
            </button>
            <StepResult result={results.systemTables ?? null} />
          </Section>
          <Section title={t('dataSources.systemTables.step2')}>
            <button
              type="button"
              className="btn"
              disabled={check.isPending}
              onClick={() => run('permissions')}
            >
              {t('dataSources.systemTables.verifySelect')}
            </button>
            <StepResult result={results.permissions ?? null} />
          </Section>
        </>
      ) : null}

      {source.id === 'aws-cur' ? (
        <Section title={t('dataSources.awsCur.title')}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <input
              className="input-inline"
              placeholder={t('dataSources.awsCur.placeholder')}
              value={bucket}
              onChange={(e) => setBucket(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="btn"
              disabled={check.isPending}
              onClick={() => run('awsCur', { bucket: bucket || undefined })}
            >
              {t('dataSources.awsCur.verify')}
            </button>
          </div>
          <StepResult result={results.awsCur ?? null} />
        </Section>
      ) : null}

      {source.id === 'azure-cost-management' ? (
        <Section title={t('dataSources.azure.title')}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <input
              className="input-inline"
              placeholder={t('dataSources.azure.placeholder')}
              value={storageAccount}
              onChange={(e) => setStorageAccount(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="btn"
              disabled={check.isPending}
              onClick={() => run('azureExport', { storageAccount: storageAccount || undefined })}
            >
              {t('dataSources.azure.verify')}
            </button>
          </div>
          <StepResult result={results.azureExport ?? null} />
        </Section>
      ) : null}

      {source.id === 'tagging-policy' ? (
        <Section title={t('dataSources.tagging.title')}>
          <button
            type="button"
            className="btn"
            disabled={check.isPending}
            onClick={() => run('tagging')}
          >
            {t('dataSources.tagging.verify')}
          </button>
          <StepResult result={results.tagging ?? null} />
        </Section>
      ) : null}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <h4 style={{ margin: '0 0 12px', fontSize: 14 }}>{title}</h4>
      {children}
    </section>
  );
}
