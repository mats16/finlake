import { useMemo, useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  EmptyHeader,
  EmptyTitle,
  Field,
  FieldLabel,
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
      <Card className="mb-4">
        <CardContent>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="time-window" className="text-sm">
              {t('costExplorer.timeWindow')}
            </FieldLabel>
            <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
              <SelectTrigger id="time-window" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">{t('costExplorer.last7Days')}</SelectItem>
                <SelectItem value="30">{t('costExplorer.last30Days')}</SelectItem>
                <SelectItem value="90">{t('costExplorer.last90Days')}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t('costExplorer.topWorkloads')}</CardTitle>
        </CardHeader>
        <CardContent>
          {top.isLoading ? (
            <div className="grid gap-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-3/4" />
            </div>
          ) : !top.data || top.data.rows.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t('costExplorer.noData')}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('costExplorer.type')}</TableHead>
                  <TableHead>{t('costExplorer.id')}</TableHead>
                  <TableHead className="text-right">{t('costExplorer.costUsd')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {top.data.rows.map((r) => (
                  <TableRow key={`${r.workloadType}:${r.workloadId}`}>
                    <TableCell>{r.workloadType}</TableCell>
                    <TableCell className="font-mono text-xs">{r.workloadId ?? '—'}</TableCell>
                    <TableCell className="text-right">{formatUsd(r.costUsd)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
