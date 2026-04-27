import { useMemo } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Alert,
  AlertDescription,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@databricks/appkit-ui/react';
import { AlertCircle } from 'lucide-react';
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

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label={t('dashboard.totalSpend')}
          value={formatUsd(totalUsd)}
          delta={
            daily.isLoading
              ? t('common.loading')
              : daily.data
                ? t('dashboard.usageRows', { count: daily.data.rows.length })
                : emDash
          }
          loading={daily.isLoading}
        />
        <KpiCard
          label={t('dashboard.distinctSkus')}
          value={bySku.data?.rows.length.toString() ?? emDash}
          delta={bySku.isLoading ? t('common.loading') : t('dashboard.systemBilling')}
          loading={bySku.isLoading}
        />
        <KpiCard
          label={t('dashboard.activeBudgets')}
          value={emDash}
          delta={t('dashboard.configureInBudgets')}
        />
        <KpiCard
          label={t('dashboard.setupStatus')}
          value={emDash}
          delta={t('dashboard.runSetupWizard')}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('dashboard.dailySpend')}</CardTitle>
          </CardHeader>
          <CardContent>
            {daily.isError ? (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription>{t('dashboard.failedToLoad')}</AlertDescription>
              </Alert>
            ) : daily.isLoading ? (
              <Skeleton className="h-72 w-full" />
            ) : dailyChartData.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{t('dashboard.noData')}</EmptyTitle>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="h-72 w-full">
                <ResponsiveContainer>
                  <LineChart data={dailyChartData}>
                    <CartesianGrid stroke="var(--border)" />
                    <XAxis dataKey="date" stroke="var(--muted-foreground)" fontSize={11} />
                    <YAxis stroke="var(--muted-foreground)" fontSize={11} />
                    <RechartsTooltip
                      contentStyle={{
                        background: 'var(--popover)',
                        border: '1px solid var(--border)',
                        color: 'var(--popover-foreground)',
                        borderRadius: 6,
                      }}
                      formatter={(value: number) => formatUsd(value)}
                    />
                    <Line
                      type="monotone"
                      dataKey="cost"
                      stroke="var(--primary)"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('dashboard.topSkus')}</CardTitle>
          </CardHeader>
          <CardContent>
            {bySku.isLoading ? (
              <div className="grid gap-2">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-3/4" />
              </div>
            ) : bySku.data?.rows && bySku.data.rows.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('dashboard.sku')}</TableHead>
                    <TableHead className="text-right">{t('dashboard.cost')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bySku.data.rows.slice(0, 10).map((row) => (
                    <TableRow key={row.skuName}>
                      <TableCell>{row.skuName}</TableCell>
                      <TableCell className="text-right">{formatUsd(row.costUsd)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{t('dashboard.noSkuBreakdown')}</EmptyTitle>
                  <EmptyDescription>{t('dashboard.systemBilling')}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function KpiCard({
  label,
  value,
  delta,
  loading,
}: {
  label: string;
  value: string;
  delta?: string;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="text-[11px] tracking-wider uppercase">{label}</CardDescription>
        <CardTitle className="text-3xl font-semibold">
          {loading ? <Skeleton className="h-8 w-24" /> : value}
        </CardTitle>
      </CardHeader>
      {delta ? (
        <CardContent>
          <p className="text-muted-foreground text-xs">{delta}</p>
        </CardContent>
      ) : null}
    </Card>
  );
}
