import { useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { useUsageTopWorkloads } from '../api/hooks';
import { useCurrencyUsd, useI18n } from '../i18n';

export function CostExplorer() {
  const { t } = useI18n();
  const formatUsd = useCurrencyUsd();
  const [days, setDays] = useState(30);
  const range = useMemo(() => {
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    return { start: start.toISOString(), end: end.toISOString() };
  }, [days]);
  const top = useUsageTopWorkloads(range);

  return (
    <>
      <PageHeader title={t('costExplorer.title')} subtitle={t('costExplorer.subtitle')} />
      <div className="card" style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 13, color: 'var(--muted)' }}>
          {t('costExplorer.timeWindow')}&nbsp;
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            style={{
              background: 'var(--bg)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              padding: '6px 10px',
              borderRadius: 6,
            }}
          >
            <option value={7}>{t('costExplorer.last7Days')}</option>
            <option value={30}>{t('costExplorer.last30Days')}</option>
            <option value={90}>{t('costExplorer.last90Days')}</option>
          </select>
        </label>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0, fontSize: 14, color: 'var(--muted)' }}>
          {t('costExplorer.topWorkloads')}
        </h3>
        {top.isLoading ? (
          <div className="banner unknown">{t('common.loading')}</div>
        ) : !top.data || top.data.rows.length === 0 ? (
          <div className="banner unknown">{t('costExplorer.noData')}</div>
        ) : (
          <table className="simple">
            <thead>
              <tr>
                <th>{t('costExplorer.type')}</th>
                <th>{t('costExplorer.id')}</th>
                <th style={{ textAlign: 'right' }}>{t('costExplorer.costUsd')}</th>
              </tr>
            </thead>
            <tbody>
              {top.data.rows.map((r) => (
                <tr key={`${r.workloadType}:${r.workloadId}`}>
                  <td>{r.workloadType}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    {r.workloadId ?? '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>{formatUsd(r.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
