import { useState } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@databricks/appkit-ui/react';
import { AlertCircle, Plus, X } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { useBudgets, useCreateBudget } from '../api/hooks';
import type { CreateBudgetInput } from '@lakecost/shared';
import { useCurrencyUsd, useI18n } from '../i18n';

export function Budgets() {
  const { t } = useI18n();
  const formatUsd = useCurrencyUsd();
  const list = useBudgets();
  const create = useCreateBudget();
  const [showForm, setShowForm] = useState(false);

  const [name, setName] = useState('');
  const [amountUsd, setAmountUsd] = useState(1000);
  const [scopeType, setScopeType] = useState<CreateBudgetInput['scopeType']>('workspace');
  const [scopeValue, setScopeValue] = useState('*');
  const [period, setPeriod] = useState<CreateBudgetInput['period']>('monthly');

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await create.mutateAsync({
      workspaceId: null,
      name,
      scopeType,
      scopeValue,
      amountUsd,
      period,
      thresholdsPct: [80, 100],
      notifyEmails: [],
    });
    setShowForm(false);
    setName('');
  };

  return (
    <>
      <PageHeader title={t('budgets.title')} subtitle={t('budgets.subtitle')} />
      <Card className="mb-4">
        <CardContent>
          <Button
            type="button"
            variant={showForm ? 'outline' : 'default'}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? (
              <>
                <X /> {t('common.cancel')}
              </>
            ) : (
              <>
                <Plus /> {t('budgets.newBudget')}
              </>
            )}
          </Button>
          {showForm ? (
            <form onSubmit={onSubmit} className="mt-4 max-w-lg">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="budget-name">{t('budgets.namePlaceholder')}</FieldLabel>
                  <Input
                    id="budget-name"
                    required
                    placeholder={t('budgets.namePlaceholder')}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="budget-amount">{t('budgets.amountPlaceholder')}</FieldLabel>
                  <Input
                    id="budget-amount"
                    required
                    type="number"
                    min={1}
                    placeholder={t('budgets.amountPlaceholder')}
                    value={amountUsd}
                    onChange={(e) => setAmountUsd(Number(e.target.value))}
                  />
                </Field>

                <Field>
                  <FieldLabel>{t('budgets.columns.scope')}</FieldLabel>
                  <Select
                    value={scopeType}
                    onValueChange={(v) => setScopeType(v as CreateBudgetInput['scopeType'])}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="account">{t('budgets.scope.account')}</SelectItem>
                      <SelectItem value="workspace">{t('budgets.scope.workspace')}</SelectItem>
                      <SelectItem value="sku">{t('budgets.scope.sku')}</SelectItem>
                      <SelectItem value="tag">{t('budgets.scope.tag')}</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel htmlFor="budget-scope-value">
                    {t('budgets.scope.valuePlaceholder')}
                  </FieldLabel>
                  <Input
                    id="budget-scope-value"
                    required
                    placeholder={t('budgets.scope.valuePlaceholder')}
                    value={scopeValue}
                    onChange={(e) => setScopeValue(e.target.value)}
                  />
                </Field>

                <Field>
                  <FieldLabel>{t('budgets.columns.period')}</FieldLabel>
                  <Select
                    value={period}
                    onValueChange={(v) => setPeriod(v as CreateBudgetInput['period'])}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">{t('budgets.period.monthly')}</SelectItem>
                      <SelectItem value="quarterly">{t('budgets.period.quarterly')}</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>

                <Button type="submit" disabled={create.isPending}>
                  {create.isPending ? (
                    <>
                      <Spinner /> {t('common.saving')}
                    </>
                  ) : (
                    t('budgets.create')
                  )}
                </Button>
                {create.isError ? (
                  <Alert variant="destructive">
                    <AlertCircle />
                    <AlertDescription>{(create.error as Error).message}</AlertDescription>
                  </Alert>
                ) : null}
              </FieldGroup>
            </form>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <h3 className="text-muted-foreground mt-0 mb-3 text-sm font-medium">
            {t('budgets.existing')}
          </h3>
          {list.isLoading ? (
            <div className="text-muted-foreground inline-flex items-center gap-2 text-sm">
              <Spinner /> {t('common.loading')}
            </div>
          ) : !list.data || list.data.items.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t('budgets.empty')}</EmptyTitle>
                <EmptyDescription>{t('budgets.subtitle')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('budgets.columns.name')}</TableHead>
                  <TableHead>{t('budgets.columns.scope')}</TableHead>
                  <TableHead>{t('budgets.columns.period')}</TableHead>
                  <TableHead className="text-right">{t('budgets.columns.amount')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.items.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.name}</TableCell>
                    <TableCell>
                      {b.scopeType}: {b.scopeValue}
                    </TableCell>
                    <TableCell>{t(`budgets.period.${b.period}`)}</TableCell>
                    <TableCell className="text-right">{formatUsd(b.amountUsd)}</TableCell>
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
