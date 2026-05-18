import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Skeleton,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@databricks/appkit-ui/react';
import { type TransformationResource, type TransformationPipelineStatusDay } from '@finlake/shared';
import {
  AlertCircle,
  CheckCircle2,
  CircleSlash,
  ExternalLink,
  LoaderCircle,
  Play,
  RefreshCcw,
  XCircle,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useRunTransformationResource, useTransformationPipelines } from '../../api/hooks';
import { useI18n } from '../../i18n';
import { messageOf } from './utils';

export function Transformations() {
  const { t, locale } = useI18n();
  const pipelines = useTransformationPipelines();
  const runResource = useRunTransformationResource();
  const resources = pipelines.data?.resources ?? [];
  const error = messageOf(pipelines.error);
  const runError = messageOf(runResource.error);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="text-muted-foreground m-0 text-sm">{t('configure.transformations.desc')}</p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => pipelines.refetch()}
          disabled={pipelines.isFetching}
        >
          <RefreshCcw className={pipelines.isFetching ? 'animate-spin' : undefined} />
          {t('transformations.refresh')}
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle />
          <AlertTitle>{t('transformations.loadFailed')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {runError ? (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle />
          <AlertTitle>{t('transformations.runFailed')}</AlertTitle>
          <AlertDescription>{runError}</AlertDescription>
        </Alert>
      ) : null}

      {pipelines.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : resources.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t('transformations.emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('transformations.emptyDesc')}</EmptyDescription>
          </EmptyHeader>
          <Button asChild>
            <Link to="/integrations">{t('transformations.configureSources')}</Link>
          </Button>
        </Empty>
      ) : (
        <div className="grid gap-4">
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('transformations.columns.name')}</TableHead>
                  <TableHead>{t('transformations.columns.type')}</TableHead>
                  <TableHead>{t('transformations.columns.trigger')}</TableHead>
                  <TableHead>{t('transformations.columns.lastUpdate')}</TableHead>
                  <TableHead className="text-right">
                    {t('transformations.columns.status')}
                  </TableHead>
                  <TableHead className="text-right">
                    {t('transformations.columns.action')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resources.map((resource) => (
                  <ResourceRow
                    key={`${resource.resourceType}:${resource.resourceId}`}
                    resource={resource}
                    locale={locale}
                    onRun={() =>
                      runResource.mutate({
                        resourceType: resource.resourceType,
                        resourceId: resource.resourceId,
                      })
                    }
                    runPending={
                      runResource.isPending &&
                      runResource.variables?.resourceType === resource.resourceType &&
                      runResource.variables?.resourceId === resource.resourceId
                    }
                    runDisabled={runResource.isPending}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </>
  );
}

function ResourceRow({
  resource,
  locale,
  onRun,
  runPending,
  runDisabled,
}: {
  resource: TransformationResource;
  locale: 'en' | 'ja';
  onRun: () => void;
  runPending: boolean;
  runDisabled: boolean;
}) {
  const { t } = useI18n();
  const lastUpdateTime = resource.periodEndTime ?? resource.periodStartTime ?? resource.changeTime;

  return (
    <TableRow>
      <TableCell>
        <div className="min-w-64">
          {resource.url ? (
            <a
              href={resource.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium text-sky-400 hover:text-sky-300"
            >
              {resource.name}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : (
            <span className="font-medium">{resource.name}</span>
          )}
          <div className="text-muted-foreground mt-1 font-mono text-xs">{resource.resourceId}</div>
        </div>
      </TableCell>
      <TableCell>
        <span className="text-sm">
          {resource.resourceType === 'job'
            ? t('transformations.resourceTypes.job')
            : t('transformations.resourceTypes.pipeline')}
        </span>
      </TableCell>
      <TableCell>
        <span className="text-muted-foreground font-mono text-xs">
          {resource.cronExpression
            ? `${resource.cronExpression} (${resource.timezoneId ?? 'UTC'})`
            : '-'}
        </span>
      </TableCell>
      <TableCell>
        <div className="min-w-44">
          <div>{lastUpdateTime ? formatDateTime(lastUpdateTime, locale) : '-'}</div>
          <div className="text-muted-foreground mt-1 text-xs">
            {resource.durationSeconds !== null
              ? formatDuration(resource.durationSeconds, locale)
              : '-'}
          </div>
        </div>
      </TableCell>
      <TableCell className="text-right">
        <StatusDays days={resource.statusDays} />
      </TableCell>
      <TableCell className="text-right">
        <Button type="button" size="sm" variant="secondary" onClick={onRun} disabled={runDisabled}>
          {runPending ? <Spinner /> : <Play />}
          {runPending ? t('transformations.running') : t('transformations.run')}
        </Button>
      </TableCell>
    </TableRow>
  );
}

function StatusDays({ days }: { days: TransformationPipelineStatusDay[] }) {
  return (
    <div className="inline-flex min-w-32 items-center justify-end gap-2">
      {days.map((day) => (
        <StatusDayIcon key={day.date} day={day} />
      ))}
    </div>
  );
}

function StatusDayIcon({ day }: { day: TransformationPipelineStatusDay }) {
  const { t } = useI18n();
  const status = statusForDay(day);
  const Icon = status.icon;
  const title = t(status.titleKey, { date: day.date, count: day.updateCount });
  return (
    <span
      aria-label={title}
      title={title}
      className={`inline-flex h-5 w-5 items-center justify-center rounded-full ${status.className}`}
    >
      <Icon className="h-4 w-4" />
    </span>
  );
}

function statusForDay(day: TransformationPipelineStatusDay) {
  if (day.updateCount === 0) {
    return {
      icon: CircleSlash,
      className: 'text-muted-foreground',
      titleKey: 'transformations.statusDay.noRuns',
    };
  }
  if (day.resultState === 'COMPLETED') {
    return {
      icon: CheckCircle2,
      className: 'text-(--success)',
      titleKey: 'transformations.statusDay.completed',
    };
  }
  if (day.resultState === 'FAILED') {
    return {
      icon: XCircle,
      className: 'text-destructive',
      titleKey: 'transformations.statusDay.failed',
    };
  }
  if (day.resultState === 'CANCELED') {
    return {
      icon: XCircle,
      className: 'text-(--warning)',
      titleKey: 'transformations.statusDay.canceled',
    };
  }
  return {
    icon: LoaderCircle,
    className: 'text-muted-foreground animate-spin',
    titleKey: 'transformations.statusDay.running',
  };
}

function formatDateTime(value: string, locale: 'en' | 'ja'): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatDuration(seconds: number, locale: 'en' | 'ja'): string {
  if (seconds < 60) return locale === 'ja' ? `${seconds} 秒` : `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return locale === 'ja' ? `${minutes} 分 ${rest} 秒` : `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  const minuteRest = minutes % 60;
  return locale === 'ja' ? `${hours} 時間 ${minuteRest} 分` : `${hours}h ${minuteRest}m`;
}
