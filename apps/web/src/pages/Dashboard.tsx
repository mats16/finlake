import { useMemo } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PageHeader } from '../components/PageHeader';
import { useUsageBySku, useUsageDaily } from '../api/hooks';
import { useCurrencyUsd, useI18n } from '../i18n';

function defaultRange() {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function Dashboard() {
  const { t } = useI18n();
  const formatUsd = useCurrencyUsd();
  const range = useMemo(defaultRange, []);
  const daily = useUsageDaily(range);
  const bySku = useUsageBySku(range);

  const totalUsd = daily.data?.totalUsd ?? 0;
  const dailyChartData = useMemo(() => {
    if (!daily.data) return [];
    const byDate = new Map<string, number>();
    for (const row of daily.data.rows) {
      byDate.set(row.usageDate, (byDate.get(row.usageDate) ?? 0) + row.costUsd);
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, cost]) => ({ date, cost }));
  }, [daily.data]);

  const emDash = t('dashboard.emDash');

  return (
    <>
      <PageHeader title={t('dashboard.title')} subtitle={t('dashboard.subtitle')} />

      <div className="kpi-grid">
        <div className="card kpi-card">
          <div className="label">{t('dashboard.totalSpend')}</div>
          <div className="value">{formatUsd(totalUsd)}</div>
          <div className="delta">
            {daily.isLoading
              ? t('common.loading')
              : daily.data
                ? t('dashboard.usageRows', { count: daily.data.rows.length })
                : emDash}
          </div>
        </div>
        <div className="card kpi-card">
          <div className="label">{t('dashboard.distinctSkus')}</div>
          <div className="value">{bySku.data?.rows.length ?? emDash}</div>
          <div className="delta">
            {bySku.isLoading ? t('common.loading') : t('dashboard.systemBilling')}
          </div>
        </div>
        <div className="card kpi-card">
          <div className="label">{t('dashboard.activeBudgets')}</div>
          <div className="value">{emDash}</div>
          <div className="delta">{t('dashboard.configureInBudgets')}</div>
        </div>
        <div className="card kpi-card">
          <div className="label">{t('dashboard.setupStatus')}</div>
          <div className="value">{emDash}</div>
          <div className="delta">{t('dashboard.runSetupWizard')}</div>
        </div>
      </div>

      <div className="section-grid">
        <div className="card">
          <h3 style={{ marginTop: 0, fontSize: 14, color: 'var(--muted)' }}>
            {t('dashboard.dailySpend')}
          </h3>
          {daily.isError ? (
            <div className="banner error">{t('dashboard.failedToLoad')}</div>
          ) : dailyChartData.length === 0 ? (
            <div className="banner unknown">{t('dashboard.noData')}</div>
          ) : (
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <LineChart data={dailyChartData}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="date" stroke="var(--muted)" fontSize={11} />
                  <YAxis stroke="var(--muted)" fontSize={11} />
                  <Tooltip
                    contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)' }}
                    formatter={(value: number) => formatUsd(value)}
                  />
                  <Line
                    type="monotone"
                    dataKey="cost"
                    stroke="var(--accent)"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0, fontSize: 14, color: 'var(--muted)' }}>
            {t('dashboard.topSkus')}
          </h3>
          {bySku.data?.rows && bySku.data.rows.length > 0 ? (
            <table className="simple">
              <thead>
                <tr>
                  <th>{t('dashboard.sku')}</th>
                  <th style={{ textAlign: 'right' }}>{t('dashboard.cost')}</th>
                </tr>
              </thead>
              <tbody>
                {bySku.data.rows.slice(0, 10).map((row) => (
                  <tr key={row.skuName}>
                    <td>{row.skuName}</td>
                    <td style={{ textAlign: 'right' }}>{formatUsd(row.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="banner unknown">{t('dashboard.noSkuBreakdown')}</div>
          )}
        </div>
      </div>
    </>
  );
}
