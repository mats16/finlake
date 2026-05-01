import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@databricks/appkit-ui/react';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Database,
  DollarSign,
  RefreshCcw,
  Sparkles,
  Tags,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import {
  type FocusOverviewDailyRow,
  type FocusOverviewResponse,
  type FocusOverviewServiceRow,
  type FocusOverviewSkuRow,
  useBudgets,
  useFocusOverview,
} from '../api/hooks';
import { useCurrencyUsd, useI18n } from '../i18n';

type ProviderKey = 'databricks' | 'aws' | 'azure' | 'gcp' | 'snowflake' | 'other';

interface ProviderMeta {
  key: ProviderKey;
  label: string;
  color: string;
  freshness: string;
  costBasis: string;
}

interface Recommendation {
  title: string;
  provider: ProviderMeta;
  savingsUsd: number | null;
  reason: string;
}

interface Anomaly {
  label: string;
  impactUsd: number;
  severity: 'high' | 'medium' | 'resolved';
  when: string;
}

const PROVIDERS: Record<ProviderKey, ProviderMeta> = {
  databricks: {
    key: 'databricks',
    label: 'Databricks',
    color: '#3B82F6',
    freshness: 'system tables, delayed by a few hours',
    costBasis: 'effective list price',
  },
  aws: {
    key: 'aws',
    label: 'AWS',
    color: '#49A078',
    freshness: 'CUR / Data Export, refreshed multiple times per day',
    costBasis: 'amortized cost',
  },
  azure: {
    key: 'azure',
    label: 'Azure',
    color: '#F2A72B',
    freshness: 'Cost Management export, daily',
    costBasis: 'effective cost',
  },
  gcp: {
    key: 'gcp',
    label: 'GCP',
    color: '#9B59B6',
    freshness: 'BigQuery billing export, daily',
    costBasis: 'effective cost',
  },
  snowflake: {
    key: 'snowflake',
    label: 'Snowflake',
    color: '#20C7A8',
    freshness: 'ACCOUNT_USAGE, daily',
    costBasis: 'usage cost',
  },
  other: {
    key: 'other',
    label: 'Other',
    color: '#718096',
    freshness: 'Configured source',
    costBasis: 'source native cost',
  },
};

const SKU_BUCKETS = [
  {
    label: 'All-Purpose',
    match: (s: string) => s.includes('ALL_PURPOSE') || s.includes('INTERACTIVE'),
  },
  { label: 'Jobs', match: (s: string) => s.includes('JOB') },
  { label: 'SQL Warehouse', match: (s: string) => s.includes('SQL') || s.includes('WAREHOUSE') },
  {
    label: 'ML / Model Serving',
    match: (s: string) =>
      s.includes('MODEL') || s.includes('SERVING') || s.includes('AI_') || s.includes('VECTOR'),
  },
  { label: 'Serverless', match: (s: string) => s.includes('SERVERLESS') },
];

const periodOptions = [
  { value: 'mtd', label: 'This Month' },
  { value: 'last30', label: 'Last 30 Days' },
] as const;

function overviewRange() {
  const now = new Date();
  const start = new Date(now.getFullYear() - 1, now.getMonth(), 1);
  return { start: start.toISOString(), end: now.toISOString() };
}

function monthToDateRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start: start.toISOString(), end: now.toISOString() };
}

function last30Range() {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function Dashboard() {
  const { t, locale } = useI18n();
  const formatUsd = useCurrencyUsd();
  const [period, setPeriod] = useState<(typeof periodOptions)[number]['value']>('mtd');
  const wideRange = useMemo(overviewRange, []);
  const mtdRange = useMemo(monthToDateRange, []);
  const rollingRange = useMemo(last30Range, []);
  const activeRange = period === 'mtd' ? mtdRange : rollingRange;

  const history = useFocusOverview(wideRange);
  const current = useFocusOverview(activeRange);
  const budgets = useBudgets();

  const sources = history.data?.sources ?? current.data?.sources ?? [];
  const activeProviders = useMemo(() => uniqueProviders(sources), [sources]);
  const dailyRows = history.data?.daily ?? [];
  const skuRows = current.data?.skus ?? [];
  const serviceRows = current.data?.services ?? [];
  const coverageRows = current.data?.coverage ?? [];

  const overview = useMemo(() => {
    const now = new Date();
    const currentMonthKey = monthKey(now);
    const previousMonthKey = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    const lastYearMonthKey = monthKey(new Date(now.getFullYear() - 1, now.getMonth(), 1));
    const monthlyDatabricks = monthlyTotals(dailyRows);
    const mtdTotal = monthlyDatabricks.get(currentMonthKey) ?? 0;
    const previousMonth = monthlyDatabricks.get(previousMonthKey) ?? 0;
    const lastYearMonth = monthlyDatabricks.get(lastYearMonthKey) ?? 0;
    const elapsedDays = Math.max(1, now.getDate());
    const daysInCurrentMonth = daysInMonth(now);
    const forecast = (mtdTotal / elapsedDays) * daysInCurrentMonth;
    const avgDaily = period === 'mtd' ? mtdTotal / elapsedDays : sumRecentDays(dailyRows, 30) / 30;
    const anomalies = detectAnomalies(dailyRows, locale);
    const recommendations = buildRecommendations(skuRows, activeProviders);
    const budgetTotal = budgets.data?.items.reduce((sum, b) => sum + b.amountUsd, 0) ?? 0;
    const budgetUtilization =
      budgetTotal > 0 ? Math.min(100, (forecast / budgetTotal) * 100) : null;

    return {
      mtdTotal,
      previousMonth,
      lastYearMonth,
      forecast,
      avgDaily,
      anomalies,
      recommendations,
      recommendationPotential: recommendations.reduce((sum, r) => sum + (r.savingsUsd ?? 0), 0),
      budgetTotal,
      budgetUtilization,
    };
  }, [activeProviders, budgets.data?.items, dailyRows, locale, period, skuRows]);

  const trendData = useMemo(
    () => buildTrendData(dailyRows, activeProviders, overview.forecast, locale),
    [activeProviders, dailyRows, locale, overview.forecast],
  );
  const providerBreakdown = useMemo(
    () => buildProviderBreakdown(activeProviders, dailyRows),
    [activeProviders, dailyRows],
  );
  const topServices = useMemo(
    () => buildTopServices(serviceRows, skuRows, activeProviders),
    [activeProviders, serviceRows, skuRows],
  );
  const skuBuckets = useMemo(() => bucketSkus(skuRows), [skuRows]);
  const lastUpdated = useMemo(
    () => formatLastUpdated(history.dataUpdatedAt, current.dataUpdatedAt, locale),
    [current.dataUpdatedAt, history.dataUpdatedAt, locale],
  );
  const hasAnyCostData = dailyRows.length > 0 || skuRows.length > 0;

  const loading = history.isLoading || current.isLoading;
  const costError = history.isError || current.isError;
  const sourceErrors = [...(history.data?.errors ?? []), ...(current.data?.errors ?? [])];
  const tagCoverage =
    coverageRows.length > 0
      ? coverageRows.reduce((sum, row) => sum + row.tagCoveragePct, 0) / coverageRows.length
      : null;

  return (
    <>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <PageHeader
          title={t('nav.overview')}
          subtitle="FinOps health across connected cost sources"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Select value={period} onValueChange={(value) => setPeriod(value as typeof period)}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {periodOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => window.location.reload()}>
            <RefreshCcw /> Refresh
          </Button>
        </div>
      </div>

      {history.isSuccess && sources.length === 0 ? (
        <Alert className="mb-4">
          <Database />
          <AlertDescription>
            No enabled data sources yet. Overview sections stay available, but cost charts will
            populate after a Databricks or cloud source is enabled in Configure.
          </AlertDescription>
        </Alert>
      ) : null}

      {costError ? (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle />
          <AlertDescription>
            Failed to load FOCUS daily rollup tables through the OBO token. Check SQL warehouse
            configuration and SELECT permissions on each gold *_daily table.
          </AlertDescription>
        </Alert>
      ) : null}

      {sourceErrors.length > 0 ? (
        <Alert className="mb-4">
          <AlertCircle />
          <AlertDescription>
            Some data sources could not be queried:{' '}
            {sourceErrors
              .slice(0, 3)
              .map((error) => `${error.name} (${error.tableName})`)
              .join(', ')}
          </AlertDescription>
        </Alert>
      ) : null}

      <SectionTitle title="Cost Summary" />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <KpiCard
          icon={DollarSign}
          label="Total Cost (MTD)"
          value={formatUsd(overview.mtdTotal)}
          delta={comparisonText(overview.mtdTotal, overview.previousMonth, 'vs last month')}
          tone={deltaTone(overview.mtdTotal, overview.previousMonth)}
          loading={loading}
        />
        <KpiCard
          icon={TrendingUp}
          label="Forecasted Month-End"
          value={formatUsd(overview.forecast)}
          delta={
            overview.budgetTotal > 0
              ? `${formatUsd(overview.budgetTotal)} budget`
              : 'No monthly budget configured'
          }
          badge={
            overview.budgetTotal > 0 && overview.forecast > overview.budgetTotal
              ? 'Over Budget'
              : undefined
          }
          tone={
            overview.budgetTotal > 0 && overview.forecast > overview.budgetTotal ? 'bad' : 'neutral'
          }
          loading={loading}
        />
        <KpiCard
          icon={CalendarDays}
          label="Avg Daily Cost"
          value={formatUsd(overview.avgDaily)}
          delta={comparisonText(
            overview.mtdTotal,
            overview.lastYearMonth,
            'vs same month last year',
          )}
          tone={deltaTone(overview.mtdTotal, overview.lastYearMonth)}
          loading={loading}
        />
        <KpiCard
          icon={CheckCircle2}
          label="Savings Realized (MTD)"
          value={formatUsd(0)}
          delta="Commitment discount feed not connected"
          tone="good"
          loading={history.isLoading}
        />
        <KpiCard
          icon={AlertCircle}
          label="Anomalies (Last 7d)"
          value={String(overview.anomalies.filter((a) => a.severity !== 'resolved').length)}
          delta={
            overview.anomalies.length > 0
              ? `${overview.anomalies.length} detected from daily spend`
              : 'No spike detected'
          }
          badge={overview.anomalies.some((a) => a.severity === 'high') ? 'Alert' : undefined}
          tone={overview.anomalies.length > 0 ? 'bad' : 'neutral'}
          loading={loading}
        />
        <KpiCard
          icon={Sparkles}
          label="Open Recommendations"
          value={String(overview.recommendations.length)}
          delta={`${formatUsd(overview.recommendationPotential)}/mo potential`}
          tone="good"
          loading={current.isLoading}
        />
      </div>

      <SectionTitle title="Cost Trends & Breakdown" />
      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              Monthly Cost by Provider (12 months + Forecast)
            </CardTitle>
            <CardDescription>
              Connected providers: {activeProviders.map((p) => p.label).join(', ') || 'none'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-80 w-full" />
            ) : !hasAnyCostData ? (
              <EmptyState
                title="No cost trend data"
                description="Enable a data source and run its refresh job."
              />
            ) : (
              <div className="h-80">
                <ResponsiveContainer>
                  <BarChart data={trendData}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={11} />
                    <YAxis
                      stroke="var(--muted-foreground)"
                      fontSize={11}
                      tickFormatter={shortUsd}
                    />
                    <RechartsTooltip content={<ChartTooltip formatUsd={formatUsd} />} />
                    {activeProviders.map((provider) => (
                      <Bar
                        key={provider.key}
                        dataKey={provider.key}
                        stackId="cost"
                        fill={provider.color}
                        radius={[3, 3, 0, 0]}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Provider Breakdown (MTD)</CardTitle>
            <CardDescription>Only providers with measured cost are included.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-80 w-full" />
            ) : providerBreakdown.length === 0 ? (
              <EmptyState
                title="No measured provider spend"
                description="Configured sources appear after cost facts are available."
              />
            ) : (
              <div className="grid gap-4 lg:grid-cols-[1fr_160px] xl:grid-cols-1 2xl:grid-cols-[1fr_160px]">
                <div className="relative h-56">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={providerBreakdown}
                        innerRadius={58}
                        outerRadius={88}
                        dataKey="cost"
                        nameKey="label"
                        stroke="var(--card)"
                        strokeWidth={2}
                      >
                        {providerBreakdown.map((entry) => (
                          <Cell key={entry.key} fill={entry.color} />
                        ))}
                      </Pie>
                      <RechartsTooltip content={<ChartTooltip formatUsd={formatUsd} />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                    <span className="text-lg font-semibold">{formatUsd(overview.mtdTotal)}</span>
                    <span className="text-muted-foreground text-xs">Total MTD</span>
                  </div>
                </div>
                <div className="grid content-center gap-2">
                  {providerBreakdown.map((provider) => (
                    <div
                      key={provider.key}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-sm"
                          style={{ background: provider.color }}
                        />
                        {provider.label}
                      </span>
                      <span className="font-medium">{provider.percent}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <SectionTitle title="Cost Allocation & Top Spenders" />
      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Top Services by Spend</CardTitle>
            <CardDescription>Aggregated from enabled FOCUS daily rollup tables.</CardDescription>
          </CardHeader>
          <CardContent>
            {current.isLoading ? (
              <Skeleton className="h-56 w-full" />
            ) : topServices.length === 0 ? (
              <EmptyState
                title="No services yet"
                description="Spend allocation appears after usage rows are loaded."
              />
            ) : (
              <div className="grid gap-3">
                {topServices.map((service) => (
                  <HorizontalSpendBar
                    key={service.name}
                    name={service.name}
                    value={service.costUsd}
                    max={topServices[0]?.costUsd ?? 1}
                    color={service.provider.color}
                    formatUsd={formatUsd}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Coverage & Utilization Rates</CardTitle>
            <CardDescription>
              Commitment and tagging metrics stay neutral until their feeds are connected.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Gauge label="RI/SP Coverage" value={null} color="#49A078" />
              <Gauge label="Tag Coverage" value={tagCoverage} color="#3B82F6" />
              <Gauge label="Budget Util." value={overview.budgetUtilization} color="#F2A72B" />
            </div>
          </CardContent>
        </Card>
      </div>

      <SectionTitle title="Optimization & Governance" />
      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              Top Recommendations
              {overview.recommendationPotential > 0
                ? ` - ${formatUsd(overview.recommendationPotential)}/mo potential savings`
                : ''}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {current.isLoading ? (
              <Skeleton className="h-56 w-full" />
            ) : overview.recommendations.length === 0 ? (
              <EmptyState
                title="No recommendations yet"
                description="Recommendations are generated from measured spend signals."
              />
            ) : (
              <div className="divide-border divide-y">
                {overview.recommendations.slice(0, 5).map((rec) => (
                  <div
                    key={rec.title}
                    className="grid grid-cols-[1fr_auto_auto] items-center gap-3 py-3"
                  >
                    <div>
                      <p className="m-0 text-sm font-medium">{rec.title}</p>
                      <p className="text-muted-foreground m-0 text-xs">{rec.reason}</p>
                    </div>
                    <Badge
                      variant="outline"
                      style={{ borderColor: rec.provider.color, color: rec.provider.color }}
                    >
                      {rec.provider.label}
                    </Badge>
                    <span className="text-sm font-semibold text-(--success)">
                      {rec.savingsUsd ? `${formatUsd(rec.savingsUsd)}/mo` : '--'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Anomaly Alerts (Last 7 days)</CardTitle>
          </CardHeader>
          <CardContent>
            {history.isLoading ? (
              <Skeleton className="h-56 w-full" />
            ) : overview.anomalies.length === 0 ? (
              <EmptyState
                title="No anomalies detected"
                description="Daily cost did not exceed the rolling baseline."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Severity</TableHead>
                    <TableHead>Signal</TableHead>
                    <TableHead className="text-right">Impact</TableHead>
                    <TableHead className="text-right">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overview.anomalies.map((anomaly) => (
                    <TableRow key={`${anomaly.label}-${anomaly.when}`}>
                      <TableCell>
                        <SeverityBadge severity={anomaly.severity} />
                      </TableCell>
                      <TableCell>{anomaly.label}</TableCell>
                      <TableCell className="text-right text-(--danger)">
                        +{formatUsd(anomaly.impactUsd)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right">
                        {anomaly.when}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <SectionTitle title="Databricks Cost Detail (DBU by SKU)" />
      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        {skuBuckets.map((bucket) => (
          <SkuCard
            key={bucket.label}
            label={bucket.label}
            costUsd={bucket.costUsd}
            percent={bucket.percent}
            color={PROVIDERS.databricks.color}
            formatUsd={formatUsd}
            loading={current.isLoading}
          />
        ))}
      </div>

      <SectionTitle title="Budget Tracking & Tagging Health" />
      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Team Budgets</CardTitle>
            <CardDescription>Actual budget records from FinLake budgets.</CardDescription>
          </CardHeader>
          <CardContent>
            {budgets.isLoading ? (
              <Skeleton className="h-56 w-full" />
            ) : !budgets.data || budgets.data.items.length === 0 ? (
              <EmptyState
                title="No budgets configured"
                description="Create budgets to track team-level burn rates."
              />
            ) : (
              <div className="grid gap-3 lg:grid-cols-3">
                {budgets.data.items.slice(0, 6).map((budget) => {
                  const utilization =
                    budget.amountUsd > 0
                      ? Math.min(100, (overview.forecast / budget.amountUsd) * 100)
                      : 0;
                  return (
                    <div
                      key={budget.id}
                      className="bg-muted/25 rounded-md border border-border p-4"
                    >
                      <div className="mb-4">
                        <p className="m-0 text-sm font-semibold">{budget.name}</p>
                        <p className="text-muted-foreground m-0 text-sm">
                          {formatUsd(Math.min(overview.forecast, budget.amountUsd))} /{' '}
                          {formatUsd(budget.amountUsd)}
                        </p>
                      </div>
                      <Progress value={utilization} />
                      <div className="mt-4 flex h-20 items-end gap-1">
                        {miniTrend(trendData).map((value, index) => (
                          <span
                            key={`${budget.id}-${index}`}
                            className="bg-primary/70 block flex-1 rounded-t-sm"
                            style={{ height: `${Math.max(8, value)}%` }}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Tagging Coverage</CardTitle>
            <CardDescription>Provider coverage requires tag inventory feeds.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3">
              {activeProviders.length === 0 ? (
                <EmptyState
                  title="No providers"
                  description="Enable data sources to monitor coverage."
                />
              ) : (
                activeProviders.map((provider) => {
                  const providerCoverage = coverageRows.find(
                    (row) => normalizeProvider(row.providerName) === provider.key,
                  );
                  return (
                    <div key={provider.key}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="inline-flex items-center gap-2">
                          <Tags className="h-3.5 w-3.5" />
                          {provider.label}
                        </span>
                        <span className="text-muted-foreground">
                          {providerCoverage
                            ? `${Math.round(providerCoverage.tagCoveragePct)}%`
                            : 'Not measured'}
                        </span>
                      </div>
                      <Progress value={providerCoverage?.tagCoveragePct ?? 0} />
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <footer className="text-muted-foreground border-border mt-6 flex flex-col gap-2 border-t pt-4 text-xs lg:flex-row lg:items-center lg:justify-between">
        <div>
          Data sources:{' '}
          {sources.length > 0
            ? sources
                .map((source) => `${source.name} (${providerForSource(source).label})`)
                .join(' | ')
            : 'none'}
        </div>
        <div>
          Last updated: {lastUpdated}. Cost source: enabled gold *_daily tables queried with the
          user OBO token. TCO joins should account for shared cluster mappings.
        </div>
      </footer>
    </>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <h3 className="mt-5 mb-2 text-base font-semibold">{title}</h3>;
}

function KpiCard({
  icon: Icon,
  label,
  value,
  delta,
  badge,
  tone = 'neutral',
  loading,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  delta: string;
  badge?: string;
  tone?: 'good' | 'bad' | 'neutral';
  loading?: boolean;
}) {
  const toneClass =
    tone === 'good'
      ? 'text-(--success)'
      : tone === 'bad'
        ? 'text-(--danger)'
        : 'text-muted-foreground';
  return (
    <Card className="relative overflow-hidden">
      <div
        className={`absolute inset-x-0 top-0 h-1 ${
          tone === 'good' ? 'bg-(--success)' : tone === 'bad' ? 'bg-(--danger)' : 'bg-primary'
        }`}
      />
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <Icon className="text-muted-foreground h-4 w-4" />
          {badge ? (
            <Badge variant={tone === 'bad' ? 'destructive' : 'secondary'}>{badge}</Badge>
          ) : null}
        </div>
        <CardDescription className="text-[11px] tracking-wider uppercase">{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold">
          {loading ? <Skeleton className="h-8 w-24" /> : value}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`m-0 text-xs ${toneClass}`}>{loading ? 'Loading...' : delta}</p>
      </CardContent>
    </Card>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  formatUsd,
}: {
  active?: boolean;
  payload?: Array<{
    name?: string;
    value?: number;
    color?: string;
    payload?: { provider?: ProviderMeta };
  }>;
  label?: string;
  formatUsd: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover text-popover-foreground border-border rounded-md border px-3 py-2 text-xs shadow-md">
      <p className="m-0 mb-1 font-medium">{label}</p>
      {payload
        .filter((item) => Number(item.value) > 0)
        .map((item) => (
          <p key={item.name} className="m-0 flex items-center justify-between gap-5">
            <span className="inline-flex items-center gap-2">
              <span className="h-2 w-2 rounded-sm" style={{ background: item.color }} />
              {item.payload?.provider?.label ?? providerLabel(item.name ?? '')}
            </span>
            <span>{formatUsd(Number(item.value ?? 0))}</span>
          </p>
        ))}
    </div>
  );
}

function HorizontalSpendBar({
  name,
  value,
  max,
  color,
  formatUsd,
}: {
  name: string;
  value: number;
  max: number;
  color: string;
  formatUsd: (value: number) => string;
}) {
  return (
    <div className="grid grid-cols-[minmax(120px,220px)_1fr_auto] items-center gap-3 text-sm">
      <span className="text-muted-foreground truncate">{name}</span>
      <div className="bg-muted h-3 overflow-hidden rounded-sm">
        <div
          className="h-full rounded-sm"
          style={{ width: `${Math.max(2, (value / Math.max(max, 1)) * 100)}%`, background: color }}
        />
      </div>
      <span className="font-medium">{formatUsd(value)}</span>
    </div>
  );
}

function Gauge({ label, value, color }: { label: string; value: number | null; color: string }) {
  const normalized = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="rounded-md border border-border p-4 text-center">
      <div
        className="mx-auto mb-3 h-24 w-24 rounded-full p-2"
        style={{
          background: `conic-gradient(${color} ${normalized * 3.6}deg, var(--muted) 0deg)`,
        }}
      >
        <div className="bg-card flex h-full w-full items-center justify-center rounded-full">
          <span className="text-lg font-semibold">
            {value === null ? 'N/A' : `${Math.round(normalized)}%`}
          </span>
        </div>
      </div>
      <p className="text-muted-foreground m-0 text-xs">{label}</p>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: Anomaly['severity'] }) {
  if (severity === 'resolved') return <Badge variant="secondary">Resolved</Badge>;
  if (severity === 'high') return <Badge variant="destructive">High</Badge>;
  return <Badge variant="outline">Medium</Badge>;
}

function SkuCard({
  label,
  costUsd,
  percent,
  color,
  formatUsd,
  loading,
}: {
  label: string;
  costUsd: number;
  percent: number;
  color: string;
  formatUsd: (value: number) => string;
  loading?: boolean;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="h-1" style={{ background: color }} />
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">
          {loading ? <Skeleton className="h-7 w-20" /> : formatUsd(costUsd)}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Progress value={percent} />
        <p className="text-muted-foreground mt-2 mb-0 text-right text-xs">{Math.round(percent)}%</p>
      </CardContent>
    </Card>
  );
}

function normalizeProvider(value: string): ProviderKey {
  const lower = value.toLowerCase();
  if (lower.includes('databricks')) return 'databricks';
  if (lower.includes('amazon') || lower === 'aws') return 'aws';
  if (lower.includes('azure') || lower.includes('microsoft')) return 'azure';
  if (lower.includes('google') || lower === 'gcp') return 'gcp';
  if (lower.includes('snowflake')) return 'snowflake';
  return 'other';
}

function providerForSource(source: FocusOverviewResponse['sources'][number]): ProviderMeta {
  return PROVIDERS[normalizeProvider(`${source.templateId} ${source.providerName}`)];
}

function uniqueProviders(sources: FocusOverviewResponse['sources']): ProviderMeta[] {
  const seen = new Set<ProviderKey>();
  const providers: ProviderMeta[] = [];
  for (const source of sources) {
    const provider = providerForSource(source);
    if (seen.has(provider.key)) continue;
    seen.add(provider.key);
    providers.push(provider);
  }
  return providers;
}

function providerLabel(key: string): string {
  return PROVIDERS[key as ProviderKey]?.label ?? key;
}

function providerForName(providerName: string, providers: ProviderMeta[]): ProviderMeta {
  const key = normalizeProvider(providerName);
  return providers.find((provider) => provider.key === key) ?? PROVIDERS[key];
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key: string, locale: string): string {
  const [year, month] = key.split('-').map(Number);
  const safeYear = year ?? new Date().getFullYear();
  const safeMonth = month ?? 1;
  return new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    month: 'short',
    year: '2-digit',
  }).format(new Date(safeYear, safeMonth - 1, 1));
}

function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function monthlyTotals(rows: FocusOverviewDailyRow[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = row.usageDate.slice(0, 7);
    totals.set(key, (totals.get(key) ?? 0) + row.costUsd);
  }
  return totals;
}

function buildTrendData(
  rows: FocusOverviewDailyRow[],
  providers: ProviderMeta[],
  forecast: number,
  locale: string,
) {
  const now = new Date();
  const totals = monthlyTotalsByProvider(rows);
  const months = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - 11 + index, 1);
    return monthKey(date);
  });
  const data = months.map((key) => {
    const record: Record<string, string | number | boolean> = {
      label: monthLabel(key, locale),
      forecast: false,
    };
    for (const provider of providers) {
      record[provider.key] = totals.get(`${key}:${provider.key}`) ?? 0;
    }
    return record;
  });
  const forecastRecord: Record<string, string | number | boolean> = {
    label: 'Forecast',
    forecast: true,
  };
  for (const provider of providers) {
    const currentMonthCost = totals.get(`${monthKey(now)}:${provider.key}`) ?? 0;
    const totalMtd = providers.reduce(
      (sum, item) => sum + (totals.get(`${monthKey(now)}:${item.key}`) ?? 0),
      0,
    );
    forecastRecord[provider.key] = totalMtd > 0 ? forecast * (currentMonthCost / totalMtd) : 0;
  }
  return [...data, forecastRecord];
}

function monthlyTotalsByProvider(rows: FocusOverviewDailyRow[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.usageDate.slice(0, 7)}:${normalizeProvider(row.providerName)}`;
    totals.set(key, (totals.get(key) ?? 0) + row.costUsd);
  }
  return totals;
}

function buildProviderBreakdown(providers: ProviderMeta[], dailyRows: FocusOverviewDailyRow[]) {
  const currentMonth = monthKey(new Date());
  const totals = monthlyTotalsByProvider(dailyRows);
  const breakdownRows = providers
    .map((provider) => ({
      ...provider,
      cost: totals.get(`${currentMonth}:${provider.key}`) ?? 0,
    }))
    .filter((provider) => provider.cost > 0);
  const total = breakdownRows.reduce((sum, row) => sum + row.cost, 0);
  return breakdownRows.map((row) => ({
    ...row,
    percent: total > 0 ? Math.round((row.cost / total) * 100) : 0,
  }));
}

function sumRecentDays(rows: FocusOverviewDailyRow[], days: number): number {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return rows
    .filter((row) => {
      const date = new Date(`${row.usageDate}T00:00:00`);
      return date >= start && date <= end;
    })
    .reduce((sum, row) => sum + row.costUsd, 0);
}

function comparisonText(current: number, previous: number, label: string): string {
  if (previous <= 0) return `No baseline ${label}`;
  const delta = ((current - previous) / previous) * 100;
  const direction = delta >= 0 ? 'up' : 'down';
  return `${Math.abs(delta).toFixed(1)}% ${direction} ${label}`;
}

function deltaTone(current: number, previous: number): 'good' | 'bad' | 'neutral' {
  if (previous <= 0) return 'neutral';
  if (current > previous * 1.05) return 'bad';
  if (current < previous * 0.95) return 'good';
  return 'neutral';
}

function buildTopServices(
  serviceRows: FocusOverviewServiceRow[],
  skuRows: FocusOverviewSkuRow[],
  providers: ProviderMeta[],
) {
  const services = serviceRows.slice(0, 7).map((row) => ({
    name: cleanSkuName(row.serviceName),
    costUsd: row.costUsd,
    provider: providerForName(row.providerName, providers),
  }));
  if (services.length > 0) return services;
  return skuRows.slice(0, 7).map((row) => ({
    name: cleanSkuName(row.skuName),
    costUsd: row.costUsd,
    provider: providerForName(row.providerName, providers),
  }));
}

function cleanSkuName(value: string): string {
  return value
    .replace(/^ENTERPRISE_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function bucketSkus(rows: FocusOverviewSkuRow[]) {
  const databricksRows = rows.filter((row) => normalizeProvider(row.providerName) === 'databricks');
  const total = databricksRows.reduce((sum, row) => sum + row.costUsd, 0);
  return SKU_BUCKETS.map((bucket) => {
    const costUsd = databricksRows
      .filter((row) => bucket.match(row.skuName.toUpperCase()))
      .reduce((sum, row) => sum + row.costUsd, 0);
    return {
      label: bucket.label,
      costUsd,
      percent: total > 0 ? (costUsd / total) * 100 : 0,
    };
  });
}

function buildRecommendations(
  rows: FocusOverviewSkuRow[],
  providers: ProviderMeta[],
): Recommendation[] {
  const recs: Recommendation[] = [];
  const total = rows.reduce((sum, row) => sum + row.costUsd, 0);
  const top = rows[0];
  if (top && top.costUsd > 0) {
    recs.push({
      title: `Review ${cleanSkuName(top.skuName)} spend`,
      provider: providerForName(top.providerName, providers),
      savingsUsd: top.costUsd * 0.12,
      reason: 'Largest measured Databricks SKU in the selected period',
    });
  }
  const jobs = rows
    .filter((row) => row.skuName.toUpperCase().includes('JOB'))
    .reduce((sum, row) => sum + row.costUsd, 0);
  if (jobs > 0) {
    recs.push({
      title: 'Right-size Databricks jobs clusters',
      provider: PROVIDERS.databricks,
      savingsUsd: jobs * 0.1,
      reason: 'Jobs spend is eligible for schedule and cluster policy review',
    });
  }
  const sql = rows
    .filter((row) => row.skuName.toUpperCase().includes('SQL'))
    .reduce((sum, row) => sum + row.costUsd, 0);
  if (sql > 0) {
    recs.push({
      title: 'Tune SQL warehouse sizing',
      provider: PROVIDERS.databricks,
      savingsUsd: sql * 0.08,
      reason: 'Warehouse cost can often be reduced with auto-stop and scaling policy changes',
    });
  }
  if (total > 0) {
    recs.push({
      title: 'Tag unallocated Databricks workloads',
      provider: PROVIDERS.databricks,
      savingsUsd: null,
      reason: 'Improves chargeback and budget routing',
    });
  }
  for (const provider of providers.filter((p) => p.key !== 'databricks')) {
    recs.push({
      title: `Complete ${provider.label} cost fact ingestion`,
      provider,
      savingsUsd: null,
      reason: 'Source is enabled, but measured provider cost is not available in Overview yet',
    });
  }
  return recs.slice(0, 5);
}

function detectAnomalies(rows: FocusOverviewDailyRow[], locale: string): Anomaly[] {
  const byDay = new Map<string, number>();
  for (const row of rows) byDay.set(row.usageDate, (byDay.get(row.usageDate) ?? 0) + row.costUsd);
  const entries = Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length < 8) return [];
  const baselineRows = entries.slice(
    Math.max(0, entries.length - 28),
    Math.max(0, entries.length - 7),
  );
  const recentRows = entries.slice(-7);
  const baseline =
    baselineRows.reduce((sum, [, cost]) => sum + cost, 0) / Math.max(1, baselineRows.length);
  if (baseline <= 0) return [];
  return recentRows
    .filter(([, cost]) => cost > baseline * 1.35 && cost - baseline > 10)
    .map(([date, cost]) => ({
      label: 'Daily spend spike',
      impactUsd: cost - baseline,
      severity: cost > baseline * 1.75 ? 'high' : 'medium',
      when: new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
        month: 'short',
        day: 'numeric',
      }).format(new Date(`${date}T00:00:00`)),
    }));
}

function miniTrend(trendData: Array<Record<string, string | number | boolean>>): number[] {
  const values = trendData
    .filter((row) => row.label !== 'Forecast')
    .map((row) => {
      let total = 0;
      for (const [key, val] of Object.entries(row)) {
        if (key !== 'label' && key !== 'forecast' && typeof val === 'number') total += val;
      }
      return total;
    })
    .slice(-12);
  const max = Math.max(...values, 1);
  return values.map((value) => (value / max) * 100);
}

function formatLastUpdated(historyUpdatedAt: number, currentUpdatedAt: number, locale: string) {
  const timestamp = Math.max(historyUpdatedAt || 0, currentUpdatedAt || 0);
  if (!timestamp) return 'never';
  return new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

function shortUsd(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${Math.round(value / 1_000_000)}M`;
  if (Math.abs(value) >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value)}`;
}
