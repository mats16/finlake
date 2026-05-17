import {
  useRef,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from '@databricks/appkit-ui/react';
import {
  AlertCircle,
  Check,
  Construction,
  DollarSign,
  ExternalLink,
  Gauge,
  Info,
  ListChecks,
  RefreshCcw,
  Server,
} from 'lucide-react';
import {
  buildDatabricksClusterUtilizationStatement,
  buildDatabricksRecommendationsStatement,
  buildDatabricksServicesStatement,
  buildDatabricksSummaryStatement,
  buildDatabricksTrendStatement,
  buildDatabricksWorkspacesStatement,
  resolveDatabricksOptimizeSources,
  type DatabricksClusterUtilizationRow,
  type DatabricksOptimizationRecommendation,
  type DatabricksOptimizationServiceRow,
  type DatabricksOptimizationSummary,
  type DatabricksOptimizationWorkspace,
  type DatabricksTrendGrain,
} from '@finlake/shared';
import { useAppSettings, useDataSources, useMe, useSqlStatement } from '../../api/hooks';
import { useCurrencyUsd, useI18n } from '../../i18n';
import { stableTomorrow } from '../../lib/dateRanges';

const PERIODS = ['last30', 'last90', 'last180', 'last12m'] as const;
const DATABRICKS_OPTIMIZE_TABS = ['serverless', 'query'] as const;
type Period = (typeof PERIODS)[number];
type DatabricksOptimizeTab = (typeof DATABRICKS_OPTIMIZE_TABS)[number];
type DeltaDisplay = 'currency' | 'percent';
type ServerlessMode = 'performance' | 'standard';
type RecommendationServiceGroup = 'JOBS' | 'SQL' | 'ALL_PURPOSE';

const SERVERLESS_COLOR = '#49A078';
const NON_SERVERLESS_COLOR = '#E4572E';
const UNKNOWN_COLOR = '#718096';
const RATIO_COLOR = '#3B82F6';
const DEFAULT_SERVICE_RATIO_FILTERS = ['SQL', 'ALL_PURPOSE', 'DLT', 'JOBS'];
const RECOMMENDATION_SERVICE_GROUPS: RecommendationServiceGroup[] = ['JOBS', 'SQL', 'ALL_PURPOSE'];
const RECOMMENDATION_GROUP_SERVICES: Record<RecommendationServiceGroup, string[]> = {
  JOBS: ['JOBS', 'DLT', 'LAKEFLOW_CONNECT'],
  SQL: ['SQL'],
  ALL_PURPOSE: ['ALL_PURPOSE', 'INTERACTIVE'],
};
const SERVERLESS_STANDARD_COST_RATIO = 0.6;
const RESOURCE_DEFAULT_COLUMN_WIDTH = 260;
const COMPACT_RECOMMENDATION_COLUMN_WIDTH = 120;
const DBU_COST_COLUMN_WIDTH = 100;
const TOTAL_COST_COLUMN_WIDTH = 180;
const ESTIMATED_SERVERLESS_COST_COLUMN_WIDTH = 230;
const DELTA_COLUMN_WIDTH = 100;

type RecommendationColumnKey =
  | 'priority'
  | 'resource'
  | 'service'
  | 'instanceType'
  | 'nonServerlessSpend'
  | 'estimatedCurrentTotal'
  | 'estimatedServerlessCost'
  | 'serverlessDelta';

const RECOMMENDATION_COLUMN_ORDER: RecommendationColumnKey[] = [
  'priority',
  'resource',
  'service',
  'instanceType',
  'nonServerlessSpend',
  'estimatedCurrentTotal',
  'estimatedServerlessCost',
  'serverlessDelta',
];

const DEFAULT_RECOMMENDATION_COLUMN_WIDTHS: Record<RecommendationColumnKey, number> = {
  priority: 92,
  resource: RESOURCE_DEFAULT_COLUMN_WIDTH,
  service: 128,
  instanceType: COMPACT_RECOMMENDATION_COLUMN_WIDTH,
  nonServerlessSpend: DBU_COST_COLUMN_WIDTH,
  estimatedCurrentTotal: TOTAL_COST_COLUMN_WIDTH,
  estimatedServerlessCost: ESTIMATED_SERVERLESS_COST_COLUMN_WIDTH,
  serverlessDelta: DELTA_COLUMN_WIDTH,
};

const MIN_RECOMMENDATION_COLUMN_WIDTHS: Record<RecommendationColumnKey, number> = {
  priority: 72,
  resource: 0,
  service: 96,
  instanceType: COMPACT_RECOMMENDATION_COLUMN_WIDTH,
  nonServerlessSpend: DBU_COST_COLUMN_WIDTH,
  estimatedCurrentTotal: TOTAL_COST_COLUMN_WIDTH,
  estimatedServerlessCost: ESTIMATED_SERVERLESS_COST_COLUMN_WIDTH,
  serverlessDelta: DELTA_COLUMN_WIDTH,
};

interface DatabricksOptimizationTrendRow {
  period: string;
  totalCostUsd: number;
  serverlessCostUsd: number;
  nonServerlessCostUsd: number;
  unknownCostUsd: number;
  serverlessRatio: number | null;
}

type AllPurposeRecommendationRow = DatabricksOptimizationRecommendation & {
  cpuUtilizationPercent: number | null;
};

function rangeForPeriod(period: Period) {
  const end = stableTomorrow();
  const start = new Date(end);
  if (period === 'last12m') {
    start.setFullYear(end.getFullYear() - 1, end.getMonth(), 1);
    start.setHours(0, 0, 0, 0);
  } else {
    const days = period === 'last30' ? 30 : period === 'last90' ? 90 : 180;
    start.setDate(end.getDate() - days);
  }
  return { start: start.toISOString(), end: end.toISOString() };
}

function sqlError(tableName: string, error: unknown) {
  if (!error) return null;
  return { tableName, message: error instanceof Error ? error.message : String(error) };
}

export function DatabricksOptimize() {
  const { t, locale } = useI18n();
  const formatUsd = useCurrencyUsd();
  const [activeTab, setActiveTab] = useState<DatabricksOptimizeTab>('serverless');
  const [period, setPeriod] = useState<Period>('last30');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('all');
  const [selectedServiceRatioServices, setSelectedServiceRatioServices] = useState<string[]>(
    DEFAULT_SERVICE_RATIO_FILTERS,
  );
  const [recommendationServiceGroup, setRecommendationServiceGroup] =
    useState<RecommendationServiceGroup>('JOBS');
  const [serverlessMode, setServerlessMode] = useState<ServerlessMode>('standard');
  const [deltaDisplay, setDeltaDisplay] = useState<DeltaDisplay>('currency');
  const [recommendationColumnWidths, setRecommendationColumnWidths] = useState(
    DEFAULT_RECOMMENDATION_COLUMN_WIDTHS,
  );
  const baseRange = useMemo(() => rangeForPeriod(period), [period]);
  const trendGrain: DatabricksTrendGrain = period === 'last30' ? 'day' : 'month';
  const dataSources = useDataSources();
  const appSettings = useAppSettings();
  const me = useMe();
  const sourceTables = useMemo(
    () =>
      resolveDatabricksOptimizeSources(
        dataSources.data?.items ?? [],
        appSettings.data?.settings ?? {},
      ),
    [appSettings.data?.settings, dataSources.data?.items],
  );
  const sqlEnabled = activeTab === 'serverless' && dataSources.isSuccess && appSettings.isSuccess;
  const workspaceStatement = useMemo(
    () => buildDatabricksWorkspacesStatement(sourceTables, baseRange),
    [baseRange, sourceTables],
  );
  const workspacesQuery = useSqlStatement<DatabricksOptimizationWorkspace>(workspaceStatement, {
    enabled: sqlEnabled,
    requestKey: ['optimize', 'databricks', 'workspaces', baseRange, sourceTables],
  });
  const workspaceOptions = workspacesQuery.rows;
  const workspaceId =
    selectedWorkspaceId === 'all' ||
    workspaceOptions.some((w) => w.workspaceId === selectedWorkspaceId)
      ? selectedWorkspaceId
      : 'all';
  const scopedRange = useMemo(
    () => (workspaceId === 'all' ? baseRange : { ...baseRange, workspaceId }),
    [baseRange, workspaceId],
  );
  const summaryStatement = useMemo(
    () => buildDatabricksSummaryStatement(sourceTables, scopedRange),
    [scopedRange, sourceTables],
  );
  const trendStatement = useMemo(
    () => buildDatabricksTrendStatement(sourceTables, scopedRange, trendGrain),
    [scopedRange, sourceTables, trendGrain],
  );
  const servicesStatement = useMemo(
    () => buildDatabricksServicesStatement(sourceTables, scopedRange),
    [scopedRange, sourceTables],
  );
  const recommendationsStatement = useMemo(
    () => buildDatabricksRecommendationsStatement(sourceTables, scopedRange),
    [scopedRange, sourceTables],
  );
  const clusterUtilizationStatement = useMemo(
    () => buildDatabricksClusterUtilizationStatement(scopedRange),
    [scopedRange],
  );
  const summaryQuery = useSqlStatement<DatabricksOptimizationSummary>(summaryStatement, {
    enabled: sqlEnabled,
    requestKey: ['optimize', 'databricks', 'summary', scopedRange, sourceTables],
  });
  const trendQuery = useSqlStatement<DatabricksOptimizationTrendRow>(trendStatement, {
    enabled: sqlEnabled,
    requestKey: ['optimize', 'databricks', 'trend', trendGrain, scopedRange, sourceTables],
  });
  const servicesQuery = useSqlStatement<DatabricksOptimizationServiceRow>(servicesStatement, {
    enabled: sqlEnabled,
    requestKey: ['optimize', 'databricks', 'services', scopedRange, sourceTables],
  });
  const recommendationsQuery = useSqlStatement<DatabricksOptimizationRecommendation>(
    recommendationsStatement,
    {
      enabled: sqlEnabled,
      requestKey: ['optimize', 'databricks', 'recommendations', scopedRange, sourceTables],
    },
  );
  const clusterUtilizationQuery = useSqlStatement<DatabricksClusterUtilizationRow>(
    clusterUtilizationStatement,
    {
      enabled: sqlEnabled && recommendationServiceGroup === 'ALL_PURPOSE',
      requestKey: ['optimize', 'databricks', 'cluster-utilization', scopedRange],
    },
  );
  const summary = summaryQuery.rows[0]
    ? {
        ...summaryQuery.rows[0],
        serverlessRatio: normalizeRatio(summaryQuery.rows[0].serverlessRatio),
      }
    : undefined;
  const loading =
    dataSources.isLoading ||
    appSettings.isLoading ||
    summaryQuery.isLoading ||
    workspacesQuery.isLoading ||
    trendQuery.isLoading ||
    servicesQuery.isLoading ||
    recommendationsQuery.isLoading;
  const errors = [
    sqlError('summary', summaryQuery.error),
    sqlError('workspaces', workspacesQuery.error),
    sqlError('trend', trendQuery.error),
    sqlError('services', servicesQuery.error),
    sqlError('recommendations', recommendationsQuery.error),
  ].filter((error): error is { tableName: string; message: string } => Boolean(error));

  const monthly = useMemo(
    () =>
      trendQuery.rows.map((row) => ({
        ...row,
        serverlessRatio: normalizeRatio(row.serverlessRatio),
        label: trendLabel(row.period, trendGrain, locale),
      })),
    [locale, trendGrain, trendQuery.rows],
  );
  const serviceRows = useMemo(
    () =>
      servicesQuery.rows.map((row) => ({
        ...row,
        serverlessRatio: normalizeRatio(row.serverlessRatio),
      })),
    [servicesQuery.rows],
  );
  const serviceRatioOptions = useMemo(
    () => serviceRows.map((row) => row.serviceName),
    [serviceRows],
  );
  const selectedServiceRatioSet = useMemo(
    () =>
      new Set(
        selectedServiceRatioServices.filter((serviceName) =>
          serviceRatioOptions.includes(serviceName),
        ),
      ),
    [selectedServiceRatioServices, serviceRatioOptions],
  );
  const filteredServiceRows = useMemo(
    () =>
      selectedServiceRatioSet.size === 0
        ? serviceRows
        : serviceRows.filter((row) => selectedServiceRatioSet.has(row.serviceName)),
    [serviceRows, selectedServiceRatioSet],
  );
  const recommendationRows = recommendationsQuery.rows;
  const recommendationGroupCounts = useMemo(() => {
    const counts = Object.fromEntries(
      RECOMMENDATION_SERVICE_GROUPS.map((group) => [group, 0]),
    ) as Record<RecommendationServiceGroup, number>;
    for (const row of recommendationRows) {
      const group = recommendationServiceGroupFor(row.serviceName);
      if (group) counts[group] += 1;
    }
    return counts;
  }, [recommendationRows]);
  const filteredRecommendationRows = useMemo(
    () =>
      recommendationRows.filter(
        (row) => recommendationServiceGroupFor(row.serviceName) === recommendationServiceGroup,
      ),
    [recommendationRows, recommendationServiceGroup],
  );
  const clusterUtilizationByResource = useMemo(() => {
    const rows = new Map<string, number | null>();
    for (const row of clusterUtilizationQuery.rows) {
      rows.set(
        clusterUtilizationKey(row.workspaceId, row.clusterId),
        normalizeRatio(row.cpuUtilizationPercent),
      );
    }
    return rows;
  }, [clusterUtilizationQuery.rows]);
  const allPurposeRecommendationRows = useMemo<AllPurposeRecommendationRow[]>(
    () =>
      filteredRecommendationRows.map((row) => ({
        ...row,
        cpuUtilizationPercent:
          clusterUtilizationByResource.get(
            clusterUtilizationKey(row.workspaceId, row.resourceId),
          ) ?? null,
      })),
    [clusterUtilizationByResource, filteredRecommendationRows],
  );
  const showMigrationEstimateColumns = recommendationServiceGroup !== 'ALL_PURPOSE';
  const showServerlessModeToggle = recommendationServiceGroup === 'JOBS';
  const effectiveServerlessMode = showServerlessModeToggle ? serverlessMode : 'standard';
  const hasData = Boolean(summary && summary.totalCostUsd > 0);

  const resizingColRef = useRef<{ column: RecommendationColumnKey; colEl: HTMLElement } | null>(
    null,
  );

  const startRecommendationColumnResize = (
    column: RecommendationColumnKey,
    event: ReactPointerEvent,
  ) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = recommendationColumnWidths[column];
    const minWidth = MIN_RECOMMENDATION_COLUMN_WIDTHS[column];
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    // Find the <col> element to update width directly during drag (avoids re-renders)
    const table = (event.target as HTMLElement).closest('table');
    const colEl = table?.querySelectorAll('col')[RECOMMENDATION_COLUMN_ORDER.indexOf(column)] as
      | HTMLElement
      | undefined;
    if (colEl) resizingColRef.current = { column, colEl };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.max(minWidth, startWidth + moveEvent.clientX - startX);
      if (colEl) colEl.style.width = `${nextWidth}px`;
    };
    const stopResize = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      // Commit final width to React state
      const finalWidth = colEl ? parseFloat(colEl.style.width) || startWidth : startWidth;
      setRecommendationColumnWidths((current) => ({
        ...current,
        [column]: finalWidth,
      }));
      resizingColRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize, { once: true });
  };

  const refresh = () => {
    summaryQuery.refetch();
    workspacesQuery.refetch();
    trendQuery.refetch();
    servicesQuery.refetch();
    recommendationsQuery.refetch();
    clusterUtilizationQuery.refetch();
  };

  const header = (
    <header className="page-header optimize-page-header">
      <div className="optimize-page-header-row">
        <div className="page-header-content">
          <h2>{t('optimize.databricks.title')}</h2>
        </div>
        {activeTab === 'serverless' ? (
          <div className="page-header-actions">
            <div className="flex flex-wrap justify-end gap-2">
              <Select value={workspaceId} onValueChange={setSelectedWorkspaceId}>
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('optimize.databricks.workspaces.all')}</SelectItem>
                  {workspaceOptions.map((workspace) => {
                    const value = workspace.workspaceId ?? '';
                    if (!value) return null;
                    return (
                      <SelectItem key={value} value={value}>
                        {workspace.workspaceName || value}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <Select value={period} onValueChange={(value) => setPeriod(value as Period)}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERIODS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {t(`optimize.databricks.period.${option}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={refresh} disabled={loading}>
                <RefreshCcw /> {t('dashboard.refresh')}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
      <nav className="upper-tabs" role="tablist" aria-label={t('optimize.databricks.title')}>
        {DATABRICKS_OPTIMIZE_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            className={activeTab === tab ? 'active' : ''}
            onClick={() => setActiveTab(tab)}
          >
            {t(`optimize.databricks.tabs.${tab}`)}
          </button>
        ))}
      </nav>
    </header>
  );

  if (activeTab === 'query') {
    return (
      <>
        {header}
        <Card>
          <CardContent>
            <Alert>
              <Construction />
              <AlertTitle>{t('optimize.underConstructionTitle')}</AlertTitle>
              <AlertDescription>{t('optimize.underConstructionDesc')}</AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      {header}

      {errors.length > 0 ? (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle />
          <AlertDescription>
            {t('optimize.databricks.failedToLoad')}{' '}
            {errors.map((error) => `${error.tableName}: ${error.message}`).join('; ')}
          </AlertDescription>
        </Alert>
      ) : null}

          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              icon={DollarSign}
              label={t('optimize.databricks.kpi.totalCost')}
              value={summary ? formatUsd(summary.totalCostUsd) : ''}
              detail={t('optimize.databricks.kpi.effectiveCost')}
              loading={loading}
            />
            <KpiCard
              icon={Server}
              label={t('optimize.databricks.kpi.nonServerlessSpend')}
              value={summary ? formatUsd(summary.nonServerlessCostUsd) : ''}
              detail={t('optimize.databricks.kpi.spendToReview')}
              loading={loading}
              tone={summary && summary.nonServerlessCostUsd > 0 ? 'bad' : 'good'}
            />
            <KpiCard
              icon={Gauge}
              label={t('optimize.databricks.kpi.serverlessRatio')}
              value={formatRatio(summary?.serverlessRatio)}
              detail={t('optimize.databricks.kpi.knownSpendOnly')}
              loading={loading}
              tone={ratioTone(summary?.serverlessRatio)}
            />
            <KpiCard
              icon={ListChecks}
              label={t('optimize.databricks.kpi.candidates')}
              value={summary ? String(summary.candidateResourceCount) : ''}
              detail={t('optimize.databricks.kpi.resourceLevel')}
              loading={loading}
            />
          </div>

          {!loading && !hasData && errors.length === 0 ? (
            <Card className="mb-4">
              <CardContent>
                <EmptyState
                  title={t('optimize.databricks.empty.noData')}
                  description={t('optimize.databricks.empty.enableFocus')}
                />
              </CardContent>
            </Card>
          ) : null}

          <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{t('optimize.databricks.monthly.title')}</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-80 w-full" />
                ) : monthly.length === 0 ? (
                  <EmptyState
                    title={t('optimize.databricks.empty.noMonthly')}
                    description={t('optimize.databricks.empty.adjustFilters')}
                  />
                ) : (
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={monthly}
                        margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                        <YAxis
                          yAxisId="cost"
                          tick={{ fontSize: 12 }}
                          tickFormatter={(value) => compactUsd(Number(value))}
                        />
                        <YAxis
                          yAxisId="ratio"
                          orientation="right"
                          domain={[0, 100]}
                          allowDataOverflow
                          tick={{ fontSize: 12 }}
                          tickFormatter={(value) => `${Math.round(Number(value))}%`}
                        />
                        <RechartsTooltip
                          content={
                            <MonthlyTooltip formatUsd={formatUsd} formatRatio={formatRatio} />
                          }
                        />
                        <Legend />
                        <Bar
                          yAxisId="cost"
                          dataKey="serverlessCostUsd"
                          stackId="cost"
                          name={t('optimize.databricks.legend.serverless')}
                          fill={SERVERLESS_COLOR}
                        />
                        <Bar
                          yAxisId="cost"
                          dataKey="nonServerlessCostUsd"
                          stackId="cost"
                          name={t('optimize.databricks.legend.nonServerless')}
                          fill={NON_SERVERLESS_COLOR}
                        />
                        <Bar
                          yAxisId="cost"
                          dataKey="unknownCostUsd"
                          stackId="cost"
                          name={t('optimize.databricks.legend.other')}
                          fill={UNKNOWN_COLOR}
                        />
                        <Line
                          yAxisId="ratio"
                          type="monotone"
                          dataKey="serverlessRatio"
                          name={t('optimize.databricks.legend.ratio')}
                          stroke={RATIO_COLOR}
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle className="text-sm">
                    {t('optimize.databricks.services.title')}
                  </CardTitle>
                  <ServiceRatioFilterMenu
                    options={serviceRatioOptions}
                    selected={selectedServiceRatioServices}
                    onChange={setSelectedServiceRatioServices}
                  />
                </div>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="grid gap-3">
                    {Array.from({ length: 6 }).map((_, index) => (
                      <Skeleton key={index} className="h-12 w-full" />
                    ))}
                  </div>
                ) : serviceRows.length === 0 ? (
                  <EmptyState
                    title={t('optimize.databricks.empty.noServices')}
                    description={t('optimize.databricks.empty.adjustFilters')}
                  />
                ) : (
                  <div className="grid gap-4">
                    {filteredServiceRows.map((row) => (
                      <ServiceRatioRow
                        key={`${row.serviceCategory}-${row.serviceName}`}
                        row={row}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                {t('optimize.databricks.recommendations.title')}
              </CardTitle>
              <CardDescription>{t('optimize.databricks.recommendations.desc')}</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-72 w-full" />
              ) : (
                <div className="grid gap-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <RecommendationServiceGroupToggle
                      value={recommendationServiceGroup}
                      counts={recommendationGroupCounts}
                      onChange={setRecommendationServiceGroup}
                    />
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {showServerlessModeToggle ? (
                        <ServerlessModeToggle value={serverlessMode} onChange={setServerlessMode} />
                      ) : null}
                      <DeltaDisplayToggle value={deltaDisplay} onChange={setDeltaDisplay} />
                    </div>
                  </div>
                  {filteredRecommendationRows.length === 0 ? (
                    <EmptyState
                      title={t('optimize.databricks.empty.noRecommendations')}
                      description={t('optimize.databricks.empty.noNonServerless')}
                    />
                  ) : !showMigrationEstimateColumns ? (
                    <AllPurposeRecommendationTable
                      rows={allPurposeRecommendationRows}
                      deltaDisplay={deltaDisplay}
                      workspaceUrl={me.data?.workspaceUrl ?? null}
                      currentWorkspaceId={me.data?.workspaceId ?? null}
                    />
                  ) : (
                    <div className="overflow-x-auto">
                      <Table className="table-fixed" style={{ width: '100%' }}>
                        <colgroup>
                          {RECOMMENDATION_COLUMN_ORDER.map((column) => (
                            <col
                              key={column}
                              style={
                                column === 'resource'
                                  ? undefined
                                  : { width: recommendationColumnWidths[column] }
                              }
                            />
                          ))}
                        </colgroup>
                        <TableHeader>
                          <TableRow>
                            <ResizableRecommendationHead
                              onResizeStart={(event) =>
                                startRecommendationColumnResize('priority', event)
                              }
                            >
                              {t('optimize.databricks.table.priority')}
                            </ResizableRecommendationHead>
                            <ResizableRecommendationHead
                              onResizeStart={(event) =>
                                startRecommendationColumnResize('resource', event)
                              }
                            >
                              {t('optimize.databricks.table.resource')}
                            </ResizableRecommendationHead>
                            <ResizableRecommendationHead
                              onResizeStart={(event) =>
                                startRecommendationColumnResize('service', event)
                              }
                            >
                              {t('optimize.databricks.table.service')}
                            </ResizableRecommendationHead>
                            <ResizableRecommendationHead
                              onResizeStart={(event) =>
                                startRecommendationColumnResize('instanceType', event)
                              }
                            >
                              {t('optimize.databricks.table.instanceType')}
                            </ResizableRecommendationHead>
                            <ResizableRecommendationHead
                              align="right"
                              onResizeStart={(event) =>
                                startRecommendationColumnResize('nonServerlessSpend', event)
                              }
                            >
                              {t('optimize.databricks.table.nonServerlessSpend')}
                            </ResizableRecommendationHead>
                            <ResizableRecommendationHead
                              align="right"
                              onResizeStart={(event) =>
                                startRecommendationColumnResize('estimatedCurrentTotal', event)
                              }
                            >
                              <div className="grid gap-0.5">
                                <div className="flex min-w-0 items-center justify-end gap-1">
                                  <span>
                                    {t('optimize.databricks.table.estimatedCurrentTotal')}
                                  </span>
                                  <InfoTooltip
                                    label={t('optimize.databricks.table.estimatedValue')}
                                  />
                                </div>
                                <span className="text-muted-foreground text-xs font-normal">
                                  {t('optimize.databricks.table.estimatedEc2CostParen')}
                                </span>
                              </div>
                            </ResizableRecommendationHead>
                            <ResizableRecommendationHead
                              align="right"
                              onResizeStart={(event) =>
                                startRecommendationColumnResize('estimatedServerlessCost', event)
                              }
                            >
                              <div className="flex min-w-0 items-center justify-end gap-1">
                                <span>
                                  {t('optimize.databricks.table.estimatedServerlessCost')}
                                </span>
                                <InfoTooltip
                                  label={t('optimize.databricks.table.estimatedValue')}
                                />
                              </div>
                            </ResizableRecommendationHead>
                            <ResizableRecommendationHead
                              align="right"
                              onResizeStart={(event) =>
                                startRecommendationColumnResize('serverlessDelta', event)
                              }
                            >
                              <div className="flex min-w-0 items-center justify-end gap-1">
                                <span>{t('optimize.databricks.table.serverlessDelta')}</span>
                                <InfoTooltip
                                  label={t('optimize.databricks.table.estimatedValue')}
                                />
                              </div>
                            </ResizableRecommendationHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredRecommendationRows.map((row) => (
                            <RecommendationRow
                              key={`${row.rank}-${row.resourceId}`}
                              row={row}
                              serverlessMode={effectiveServerlessMode}
                              deltaDisplay={deltaDisplay}
                              workspaceUrl={me.data?.workspaceUrl ?? null}
                              currentWorkspaceId={me.data?.workspaceId ?? null}
                            />
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}

function RecommendationServiceGroupToggle({
  value,
  counts,
  onChange,
}: {
  value: RecommendationServiceGroup;
  counts: Record<RecommendationServiceGroup, number>;
  onChange: (value: RecommendationServiceGroup) => void;
}) {
  const { t } = useI18n();

  return (
    <div
      className="bg-muted inline-flex max-w-full flex-wrap gap-1 rounded-full p-1"
      role="group"
      aria-label={t('optimize.databricks.recommendations.serviceFilter.label')}
    >
      {RECOMMENDATION_SERVICE_GROUPS.map((option) => {
        const active = value === option;
        return (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={active ? 'secondary' : 'ghost'}
            className={cn(
              'h-8 rounded-full px-3 text-sm',
              active ? 'bg-background shadow-sm' : 'text-muted-foreground',
            )}
            aria-pressed={active}
            onClick={() => onChange(option)}
          >
            <span>{option}</span>
            <span
              className={cn(
                'ml-1.5 text-xs',
                active ? 'text-muted-foreground' : 'text-muted-foreground/80',
              )}
            >
              {counts[option]}
            </span>
          </Button>
        );
      })}
    </div>
  );
}

function recommendationServiceGroupFor(serviceName: string): RecommendationServiceGroup | null {
  for (const group of RECOMMENDATION_SERVICE_GROUPS) {
    if (RECOMMENDATION_GROUP_SERVICES[group].includes(serviceName)) return group;
  }
  return null;
}

function DeltaDisplayToggle({
  value,
  onChange,
}: {
  value: DeltaDisplay;
  onChange: (value: DeltaDisplay) => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className="bg-muted inline-flex rounded-full p-1"
      role="group"
      aria-label={t('optimize.databricks.recommendations.deltaDisplay.label')}
    >
      {(['currency', 'percent'] as const).map((option) => {
        const active = value === option;
        return (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={active ? 'secondary' : 'ghost'}
            className={cn(
              'h-8 min-w-8 rounded-full px-2.5 text-sm',
              active ? 'bg-background shadow-sm' : 'text-muted-foreground',
            )}
            aria-pressed={active}
            onClick={() => onChange(option)}
          >
            {option === 'currency' ? '$' : '%'}
          </Button>
        );
      })}
    </div>
  );
}

function ServiceRatioFilterMenu({
  options,
  selected,
  onChange,
}: {
  options: string[];
  selected: string[];
  onChange: (value: string[]) => void;
}) {
  const { t } = useI18n();
  const availableSelected = selected.filter((serviceName) => options.includes(serviceName));
  const selectedSet = new Set(availableSelected);
  const allSelected = options.length > 0 && availableSelected.length === options.length;
  const label =
    availableSelected.length === 0 || allSelected
      ? t('optimize.databricks.services.filter.all')
      : availableSelected.length <= 2
        ? availableSelected.join(', ')
        : `${availableSelected[0]} +${availableSelected.length - 1}`;

  const toggle = (serviceName: string) => {
    if (selectedSet.has(serviceName)) {
      onChange(availableSelected.filter((value) => value !== serviceName));
      return;
    }
    onChange([...availableSelected, serviceName]);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 max-w-[280px] gap-1.5 px-3 text-sm"
          aria-label={t('optimize.databricks.services.filter.label')}
        >
          <span className="text-muted-foreground">
            {t('optimize.databricks.services.filter.label')}
          </span>
          <span className="text-primary truncate font-medium">{label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[360px] w-[260px] overflow-y-auto p-2">
        <DropdownMenuItem onClick={() => onChange([...options])}>
          <Check className={cn('size-3.5', allSelected ? 'opacity-100' : 'opacity-0')} />
          {t('optimize.databricks.services.filter.all')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {options.map((serviceName) => (
          <DropdownMenuItem key={serviceName} onClick={() => toggle(serviceName)}>
            <Check
              className={cn('size-3.5', selectedSet.has(serviceName) ? 'opacity-100' : 'opacity-0')}
            />
            <span className="truncate">{serviceName}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ServerlessModeToggle({
  value,
  onChange,
}: {
  value: ServerlessMode;
  onChange: (value: ServerlessMode) => void;
}) {
  const { t } = useI18n();
  const options: ServerlessMode[] = ['performance', 'standard'];
  return (
    <div
      className="bg-muted inline-flex rounded-full p-1"
      role="group"
      aria-label={t('optimize.databricks.recommendations.serverlessMode.label')}
    >
      {options.map((option) => {
        const active = value === option;
        return (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={active ? 'secondary' : 'ghost'}
            className={cn(
              'h-8 rounded-full px-3 text-sm',
              active ? 'bg-background shadow-sm' : 'text-muted-foreground',
            )}
            aria-pressed={active}
            onClick={() => onChange(option)}
          >
            {t(`optimize.databricks.recommendations.serverlessMode.${option}`)}
          </Button>
        );
      })}
    </div>
  );
}

function ResizableRecommendationHead({
  children,
  align = 'left',
  onResizeStart,
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <TableHead
      className={cn(
        'group relative overflow-hidden pr-4 select-none',
        align === 'right' && 'text-right',
      )}
    >
      <div className={cn('min-w-0 truncate', align === 'right' && 'text-right')}>{children}</div>
      <button
        type="button"
        className="absolute inset-y-0 right-0 w-2 cursor-col-resize border-r border-transparent transition group-hover:border-primary/60 focus-visible:border-primary focus-visible:outline-none"
        aria-label="Resize column"
        onPointerDown={onResizeStart}
      />
    </TableHead>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = 'neutral',
  loading,
}: {
  icon: typeof DollarSign;
  label: string;
  value: string;
  detail: string;
  tone?: 'good' | 'bad' | 'neutral';
  loading: boolean;
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
        <div className="flex items-center gap-2">
          <Icon className="text-muted-foreground h-4 w-4 shrink-0" />
          <CardDescription className="text-[11px] tracking-wider uppercase">
            {label}
          </CardDescription>
        </div>
        <CardTitle className="text-2xl font-semibold">
          {loading ? <Skeleton className="h-8 w-24" /> : value}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`m-0 text-xs ${toneClass}`}>{detail}</p>
      </CardContent>
    </Card>
  );
}

function ServiceRatioRow({ row }: { row: DatabricksOptimizationServiceRow }) {
  const { t } = useI18n();
  const formatUsd = useCurrencyUsd();
  const knownCost = row.serverlessCostUsd + row.nonServerlessCostUsd;
  const denominator = Math.max(knownCost, 1);
  const serverlessWidth = knownCost > 0 ? (row.serverlessCostUsd / denominator) * 100 : 0;
  const nonServerlessWidth = knownCost > 0 ? (row.nonServerlessCostUsd / denominator) * 100 : 0;
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <p className="m-0 whitespace-nowrap font-medium">{row.serviceName}</p>
        <p className="m-0 shrink-0 font-medium">{formatRatio(row.serverlessRatio)}</p>
      </div>
      <p className="text-muted-foreground m-0 whitespace-nowrap text-right text-xs">
        {formatUsd(row.serverlessCostUsd)} / {formatUsd(row.totalCostUsd)}
      </p>
      <div
        className="bg-muted flex h-3 overflow-hidden rounded-sm"
        aria-label={t('optimize.databricks.services.title')}
      >
        <span style={{ width: `${serverlessWidth}%`, background: SERVERLESS_COLOR }} />
        <span style={{ width: `${nonServerlessWidth}%`, background: NON_SERVERLESS_COLOR }} />
      </div>
      <Progress value={row.serverlessRatio ?? 0} className="sr-only" />
    </div>
  );
}

function RecommendationRow({
  row,
  serverlessMode,
  deltaDisplay,
  workspaceUrl,
  currentWorkspaceId,
}: {
  row: DatabricksOptimizationRecommendation;
  serverlessMode: ServerlessMode;
  deltaDisplay: DeltaDisplay;
  workspaceUrl: string | null;
  currentWorkspaceId: string | null;
}) {
  const { t } = useI18n();
  const formatUsd = useCurrencyUsd();
  const estimatedCurrentTotal = isFiniteNumber(row.estimatedCurrentTotalCostUsd)
    ? row.estimatedCurrentTotalCostUsd
    : null;
  const estimatedEc2Cost = isFiniteNumber(row.estimatedEc2CostUsd) ? row.estimatedEc2CostUsd : null;
  const performanceServerlessCost = isFiniteNumber(row.estimatedServerlessCostUsd)
    ? row.estimatedServerlessCostUsd
    : null;
  const estimatedServerlessCost =
    performanceServerlessCost === null
      ? null
      : serverlessMode === 'standard'
        ? performanceServerlessCost * SERVERLESS_STANDARD_COST_RATIO
        : performanceServerlessCost;
  const { delta: estimatedServerlessDelta, deltaPercent: estimatedServerlessDeltaPercent } =
    computeServerlessDelta(estimatedServerlessCost, estimatedCurrentTotal);
  return (
    <TableRow>
      <TableCell className="overflow-hidden">
        <PriorityBadge priority={row.priority} />
      </TableCell>
      <ResourceInfoCell
        row={row}
        workspaceUrl={workspaceUrl}
        currentWorkspaceId={currentWorkspaceId}
      />
      <TableCell className="overflow-hidden">
        <span className="block truncate">{row.serviceName}</span>
      </TableCell>
      <TableCell className="overflow-hidden truncate">
        {row.instanceType || t('dashboard.notAvailable')}
      </TableCell>
      <TableCell className="overflow-hidden text-right font-medium">
        {formatUsd(row.nonServerlessCostUsd)}
      </TableCell>
      <EstimatedTotalCell
        estimatedTotal={estimatedCurrentTotal}
        estimatedEc2Cost={estimatedEc2Cost}
      />
      <TableCell className="overflow-hidden text-right">
        {estimatedServerlessCost !== null ? (
          <span className="font-medium">{formatUsd(estimatedServerlessCost)}</span>
        ) : (
          t('dashboard.notAvailable')
        )}
      </TableCell>
      <TableCell className="overflow-hidden text-right">
        {estimatedServerlessDelta !== null ? (
          <span className={estimatedServerlessDelta <= 0 ? 'text-(--success)' : 'text-(--danger)'}>
            {deltaDisplay === 'currency'
              ? formatSignedUsd(estimatedServerlessDelta, formatUsd)
              : formatSignedPercent(estimatedServerlessDeltaPercent)}
          </span>
        ) : (
          t('dashboard.notAvailable')
        )}
      </TableCell>
    </TableRow>
  );
}

function AllPurposeRecommendationTable({
  rows,
  deltaDisplay,
  workspaceUrl,
  currentWorkspaceId,
}: {
  rows: AllPurposeRecommendationRow[];
  deltaDisplay: DeltaDisplay;
  workspaceUrl: string | null;
  currentWorkspaceId: string | null;
}) {
  const { t } = useI18n();
  const formatUsd = useCurrencyUsd();
  return (
    <div className="overflow-x-auto">
      <Table className="table-fixed" style={{ width: '100%' }}>
        <colgroup>
          <col />
          <col style={{ width: COMPACT_RECOMMENDATION_COLUMN_WIDTH }} />
          <col style={{ width: COMPACT_RECOMMENDATION_COLUMN_WIDTH }} />
          <col style={{ width: COMPACT_RECOMMENDATION_COLUMN_WIDTH }} />
          <col style={{ width: TOTAL_COST_COLUMN_WIDTH }} />
          <col style={{ width: TOTAL_COST_COLUMN_WIDTH }} />
          <col style={{ width: ESTIMATED_SERVERLESS_COST_COLUMN_WIDTH }} />
          <col style={{ width: DELTA_COLUMN_WIDTH }} />
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead>{t('optimize.databricks.table.resource')}</TableHead>
            <TableHead>{t('optimize.databricks.table.service')}</TableHead>
            <TableHead>{t('optimize.databricks.table.instanceType')}</TableHead>
            <TableHead className="text-right">
              <div className="flex min-w-0 items-center justify-end gap-1">
                <span>{t('optimize.databricks.table.utilization')}</span>
                <InfoTooltip label={t('optimize.databricks.table.utilizationDescription')} />
              </div>
            </TableHead>
            <TableHead className="text-right">
              {t('optimize.databricks.table.nonServerlessSpend')}
            </TableHead>
            <TableHead className="text-right">
              <div className="grid gap-0.5">
                <div className="flex min-w-0 items-center justify-end gap-1">
                  <span>{t('optimize.databricks.table.estimatedCurrentTotal')}</span>
                  <InfoTooltip label={t('optimize.databricks.table.estimatedValue')} />
                </div>
                <span className="text-muted-foreground text-xs font-normal">
                  {t('optimize.databricks.table.estimatedEc2CostParen')}
                </span>
              </div>
            </TableHead>
            <TableHead className="text-right">
              <div className="flex min-w-0 items-center justify-end gap-1">
                <span>{t('optimize.databricks.table.estimatedServerlessCost')}</span>
                <InfoTooltip
                  label={t('optimize.databricks.table.allPurposeServerlessEstimateDescription')}
                />
              </div>
            </TableHead>
            <TableHead className="text-right">
              <div className="flex min-w-0 items-center justify-end gap-1">
                <span>{t('optimize.databricks.table.serverlessDelta')}</span>
                <InfoTooltip label={t('optimize.databricks.table.estimatedValue')} />
              </div>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const estimatedCurrentTotal = isFiniteNumber(row.estimatedCurrentTotalCostUsd)
              ? row.estimatedCurrentTotalCostUsd
              : null;
            const estimatedEc2Cost = isFiniteNumber(row.estimatedEc2CostUsd)
              ? row.estimatedEc2CostUsd
              : null;
            const estimatedServerlessCost = estimatedAllPurposeServerlessCost(row);
            const {
              delta: estimatedServerlessDelta,
              deltaPercent: estimatedServerlessDeltaPercent,
            } = computeServerlessDelta(estimatedServerlessCost, estimatedCurrentTotal);
            return (
              <TableRow key={`${row.rank}-${row.resourceId}`}>
                <ResourceInfoCell
                  row={row}
                  workspaceUrl={workspaceUrl}
                  currentWorkspaceId={currentWorkspaceId}
                />
                <TableCell className="overflow-hidden">
                  <span className="block truncate">{row.serviceName}</span>
                </TableCell>
                <TableCell className="overflow-hidden truncate">
                  {row.instanceType || t('dashboard.notAvailable')}
                </TableCell>
                <TableCell
                  className={cn(
                    'overflow-hidden text-right font-medium',
                    utilizationToneClass(row.cpuUtilizationPercent),
                  )}
                >
                  {formatRatio(row.cpuUtilizationPercent)}
                </TableCell>
                <TableCell className="overflow-hidden text-right font-medium">
                  {formatUsd(row.nonServerlessCostUsd)}
                </TableCell>
                <EstimatedTotalCell
                  estimatedTotal={estimatedCurrentTotal}
                  estimatedEc2Cost={estimatedEc2Cost}
                />
                <TableCell className="overflow-hidden text-right font-medium">
                  {estimatedServerlessCost !== null
                    ? formatUsd(estimatedServerlessCost)
                    : t('dashboard.notAvailable')}
                </TableCell>
                <TableCell className="overflow-hidden text-right">
                  {estimatedServerlessDelta !== null ? (
                    <span
                      className={
                        estimatedServerlessDelta <= 0 ? 'text-(--success)' : 'text-(--danger)'
                      }
                    >
                      {deltaDisplay === 'currency'
                        ? formatSignedUsd(estimatedServerlessDelta, formatUsd)
                        : formatSignedPercent(estimatedServerlessDeltaPercent)}
                    </span>
                  ) : (
                    t('dashboard.notAvailable')
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function ResourceInfoCell({
  row,
  workspaceUrl,
  currentWorkspaceId,
}: {
  row: DatabricksOptimizationRecommendation;
  workspaceUrl: string | null;
  currentWorkspaceId: string | null;
}) {
  const { t } = useI18n();
  const resourceName = row.resourceName || row.resourceId;
  const resourceUrl = databricksResourceUrl(row, workspaceUrl, currentWorkspaceId);
  const resourceWorkspace = `${row.workspaceName || t('dashboard.notAvailable')} | ${
    row.workspaceId || t('dashboard.notAvailable')
  }`;
  return (
    <TableCell className="min-w-0 overflow-hidden">
      <div className="grid min-w-0 gap-0.5">
        <ResourceNameLink href={resourceUrl} name={resourceName} />
        <span className="text-muted-foreground truncate text-xs">{row.resourceId}</span>
        <span className="text-muted-foreground truncate text-xs">{resourceWorkspace}</span>
      </div>
    </TableCell>
  );
}

function EstimatedTotalCell({
  estimatedTotal,
  estimatedEc2Cost,
}: {
  estimatedTotal: number | null;
  estimatedEc2Cost: number | null;
}) {
  const { t } = useI18n();
  const formatUsd = useCurrencyUsd();
  if (estimatedTotal === null) {
    return (
      <TableCell className="overflow-hidden text-right">{t('dashboard.notAvailable')}</TableCell>
    );
  }
  return (
    <TableCell className="overflow-hidden text-right">
      <div className="grid gap-0.5">
        <span className="font-medium">{formatUsd(estimatedTotal)}</span>
        {estimatedEc2Cost !== null ? (
          <span className="text-muted-foreground text-xs">{formatUsd(estimatedEc2Cost)}</span>
        ) : null}
      </div>
    </TableCell>
  );
}

function InfoTooltip({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="text-muted-foreground size-3.5 shrink-0" aria-label={label} />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function ResourceNameLink({ href, name }: { href: string | null; name: string }) {
  if (!href) {
    return <span className="truncate font-medium">{name}</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-primary inline-flex max-w-full min-w-0 items-center gap-1 font-medium hover:underline"
    >
      <span className="min-w-0 truncate">{name}</span>
      <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
    </a>
  );
}

function databricksResourceUrl(
  row: DatabricksOptimizationRecommendation,
  workspaceUrl: string | null,
  currentWorkspaceId: string | null,
): string | null {
  if (!workspaceUrl || !row.workspaceId || row.workspaceId !== currentWorkspaceId) return null;
  const path = databricksResourcePath(row.serviceName, row.resourceId);
  return path ? `${workspaceUrl}${path}` : null;
}

function databricksResourcePath(serviceName: string, resourceId: string): string | null {
  const id = encodeURIComponent(resourceId);
  switch (serviceName) {
    case 'ALL_PURPOSE':
      return `/compute/clusters/${id}`;
    case 'JOBS':
      return `/jobs/${id}`;
    case 'DLT':
      return `/pipelines/${id}`;
    case 'SQL':
      return `/sql/warehouses/${id}`;
    default:
      return null;
  }
}

function PriorityBadge({
  priority,
}: {
  priority: DatabricksOptimizationRecommendation['priority'];
}) {
  const { t } = useI18n();
  if (priority === 'high') {
    return <Badge variant="destructive">{t('optimize.databricks.priority.high')}</Badge>;
  }
  if (priority === 'medium') {
    return <Badge variant="outline">{t('optimize.databricks.priority.medium')}</Badge>;
  }
  return <Badge variant="secondary">{t('optimize.databricks.priority.low')}</Badge>;
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

function MonthlyTooltip({
  active,
  payload,
  label,
  formatUsd,
  formatRatio: formatTooltipRatio,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string; dataKey?: string }>;
  label?: string;
  formatUsd: (value: number) => string;
  formatRatio: (value: number | null | undefined) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover text-popover-foreground border-border rounded-md border px-3 py-2 text-xs shadow-md">
      <p className="m-0 mb-1 font-medium">{label}</p>
      {payload
        .filter((item) => item.value !== null && item.value !== undefined)
        .map((item) => (
          <p
            key={`${item.dataKey}-${item.name}`}
            className="m-0 flex items-center justify-between gap-5"
          >
            <span className="inline-flex items-center gap-2">
              <span className="h-2 w-2 rounded-sm" style={{ background: item.color }} />
              {item.name}
            </span>
            <span>
              {item.dataKey === 'serverlessRatio'
                ? formatTooltipRatio(Number(item.value))
                : formatUsd(Number(item.value ?? 0))}
            </span>
          </p>
        ))}
    </div>
  );
}

function ratioTone(value: number | null | undefined): 'good' | 'bad' | 'neutral' {
  const ratio = normalizeRatio(value);
  if (ratio === null) return 'neutral';
  if (ratio >= 70) return 'good';
  if (ratio < 30) return 'bad';
  return 'neutral';
}

function formatRatio(value: number | null | undefined): string {
  const ratio = normalizeRatio(value);
  if (ratio === null) return 'N/A';
  return `${Math.round(ratio)}%`;
}

function normalizeRatio(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clusterUtilizationKey(workspaceId: string | null | undefined, clusterId: string): string {
  return `${workspaceId ?? ''}:${clusterId}`;
}

function utilizationToneClass(value: number | null | undefined): string {
  const ratio = normalizeRatio(value);
  if (ratio === null) return '';
  if (ratio >= 70) return 'text-(--success)';
  if (ratio >= 30) return 'text-(--warning)';
  return 'text-(--danger)';
}

function estimatedAllPurposeServerlessCost(row: AllPurposeRecommendationRow): number | null {
  const dbuQuantity = isFiniteNumber(row.dbuQuantityEstimate) ? row.dbuQuantityEstimate : null;
  const utilizationRatio = normalizeRatio(row.cpuUtilizationPercent);
  const serverlessUnitPrice = isFiniteNumber(row.serverlessUnitPriceUsd)
    ? row.serverlessUnitPriceUsd
    : null;
  if (dbuQuantity === null || utilizationRatio === null || serverlessUnitPrice === null) {
    return null;
  }
  return dbuQuantity * (utilizationRatio / 100) * serverlessUnitPrice;
}

function formatSignedUsd(value: number, formatUsd: (value: number) => string): string {
  if (value === 0) return formatUsd(0);
  return `${value > 0 ? '+' : '-'}${formatUsd(Math.abs(value))}`;
}

function computeServerlessDelta(
  estimatedServerlessCost: number | null,
  estimatedCurrentTotal: number | null,
): { delta: number | null; deltaPercent: number | null } {
  const delta =
    estimatedServerlessCost !== null && estimatedCurrentTotal !== null
      ? estimatedServerlessCost - estimatedCurrentTotal
      : null;
  const deltaPercent =
    delta !== null && estimatedCurrentTotal !== null && estimatedCurrentTotal > 0
      ? (delta / estimatedCurrentTotal) * 100
      : null;
  return { delta, deltaPercent };
}

function formatSignedPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'N/A';
  if (Math.abs(value) < 0.05) return '0%';
  const absValue = Math.abs(value);
  const formatted = absValue < 10 ? absValue.toFixed(1) : String(Math.round(absValue));
  return `${value > 0 ? '+' : '-'}${formatted}%`;
}

function compactUsd(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${Math.round(value / 1_000_000)}M`;
  if (Math.abs(value) >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value)}`;
}

function trendLabel(key: string, grain: 'day' | 'month', locale: string): string {
  const parts = key.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const safeYear = Number.isFinite(year) ? year : new Date().getFullYear();
  const safeMonth = Number.isFinite(month) ? month : 1;
  const safeDay = Number.isFinite(day) ? day : 1;
  return new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    day: grain === 'day' ? 'numeric' : undefined,
    month: 'short',
    year: grain === 'month' ? '2-digit' : undefined,
  }).format(new Date(safeYear, safeMonth - 1, safeDay));
}
