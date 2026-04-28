import { useEffect, useState } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Spinner,
} from '@databricks/appkit-ui/react';
import { Info } from 'lucide-react';
import {
  useAppSettings,
  useDataSource,
  useRunSetupCheck,
  useUpdateDataSource,
} from '../../api/hooks';
import { StepResult } from '../SetupWizard/StepResult';
import type { DataSourceDefinition } from './dataSourceCatalog';
import {
  ACCOUNT_PRICES_DEFAULT,
  CATALOG_SETTING_KEY,
  DATABRICKS_BILLING_SOURCE_ID,
  FOCUS_VIEW_SCHEMA_DEFAULT,
  FOCUS_VIEW_TABLE_DEFAULT,
  type SetupCheckResult,
  type SetupStepId,
} from '@lakecost/shared';
import { useI18n } from '../../i18n';

interface Props {
  source: DataSourceDefinition | null;
  onClose: () => void;
}

export function DataSourceDrawer({ source, onClose }: Props) {
  const { t } = useI18n();
  if (!source) return null;
  const description = t(`dataSources.catalog.${source.id}.description`);

  return (
    <Sheet open onOpenChange={(open) => (open ? null : onClose())}>
      <SheetContent side="right" className="w-full max-w-(--container-md) sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{source.name}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 overflow-auto px-4 pb-6">
          {source.available ? (
            <Configurator source={source} />
          ) : (
            <Alert>
              <Info />
              <AlertDescription>{t('dataSources.drawer.notImplemented')}</AlertDescription>
            </Alert>
          )}
        </div>
      </SheetContent>
    </Sheet>
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
            <Button type="button" disabled={check.isPending} onClick={() => run('systemTables')}>
              {check.isPending ? <Spinner /> : null}
              {t('dataSources.systemTables.verifySchemas')}
            </Button>
            <StepResult result={results.systemTables ?? null} />
          </Section>
          <Section title={t('dataSources.systemTables.step2')}>
            <Button type="button" disabled={check.isPending} onClick={() => run('permissions')}>
              {check.isPending ? <Spinner /> : null}
              {t('dataSources.systemTables.verifySelect')}
            </Button>
            <StepResult result={results.permissions ?? null} />
          </Section>
          <FocusViewSection
            results={results}
            onResult={(r) => setResults((prev) => ({ ...prev, focusView: r }))}
          />
        </>
      ) : null}

      {source.id === 'aws-cur' ? (
        <Section title={t('dataSources.awsCur.title')}>
          <div className="mb-2 flex items-center gap-2">
            <Input
              placeholder={t('dataSources.awsCur.placeholder')}
              value={bucket}
              onChange={(e) => setBucket(e.target.value)}
              className="flex-1"
            />
            <Button
              type="button"
              disabled={check.isPending}
              onClick={() => run('awsCur', { bucket: bucket || undefined })}
            >
              {check.isPending ? <Spinner /> : null}
              {t('dataSources.awsCur.verify')}
            </Button>
          </div>
          <StepResult result={results.awsCur ?? null} />
        </Section>
      ) : null}

      {source.id === 'azure-cost-management' ? (
        <Section title={t('dataSources.azure.title')}>
          <div className="mb-2 flex items-center gap-2">
            <Input
              placeholder={t('dataSources.azure.placeholder')}
              value={storageAccount}
              onChange={(e) => setStorageAccount(e.target.value)}
              className="flex-1"
            />
            <Button
              type="button"
              disabled={check.isPending}
              onClick={() => run('azureExport', { storageAccount: storageAccount || undefined })}
            >
              {check.isPending ? <Spinner /> : null}
              {t('dataSources.azure.verify')}
            </Button>
          </div>
          <StepResult result={results.azureExport ?? null} />
        </Section>
      ) : null}

      {source.id === 'tagging-policy' ? (
        <Section title={t('dataSources.tagging.title')}>
          <Button type="button" disabled={check.isPending} onClick={() => run('tagging')}>
            {check.isPending ? <Spinner /> : null}
            {t('dataSources.tagging.verify')}
          </Button>
          <StepResult result={results.tagging ?? null} />
        </Section>
      ) : null}
    </>
  );
}

interface FocusViewSectionProps {
  results: Partial<Record<SetupStepId, SetupCheckResult>>;
  onResult: (result: SetupCheckResult) => void;
}

function FocusViewSection({ results, onResult }: FocusViewSectionProps) {
  const { t } = useI18n();
  const settings = useAppSettings();
  const ds = useDataSource(DATABRICKS_BILLING_SOURCE_ID);
  const updateDs = useUpdateDataSource();
  const check = useRunSetupCheck();

  const remoteCatalog = settings.data?.settings[CATALOG_SETTING_KEY] ?? '';
  const remoteTier = ds.data?.tier ?? FOCUS_VIEW_SCHEMA_DEFAULT;
  const remoteTable = ds.data?.tableName ?? FOCUS_VIEW_TABLE_DEFAULT;
  const remoteAccountPrices =
    (ds.data?.config.accountPricesTable as string | undefined) ?? ACCOUNT_PRICES_DEFAULT;

  const [tier, setTier] = useState(remoteTier);
  const [tableName, setTableName] = useState(remoteTable);
  const [accountPrices, setAccountPrices] = useState(remoteAccountPrices);

  useEffect(() => setTier(remoteTier), [remoteTier]);
  useEffect(() => setTableName(remoteTable), [remoteTable]);
  useEffect(() => setAccountPrices(remoteAccountPrices), [remoteAccountPrices]);

  const fqn = remoteCatalog ? `${remoteCatalog}.${tier}.${tableName}` : `${tier}.${tableName}`;
  const dirty =
    tier !== remoteTier || tableName !== remoteTable || accountPrices !== remoteAccountPrices;
  const busy = check.isPending || updateDs.isPending;

  const onSave = async () => {
    if (!dirty) return;
    await updateDs.mutateAsync({
      id: DATABRICKS_BILLING_SOURCE_ID,
      body: {
        tier,
        tableName,
        config: { ...(ds.data?.config ?? {}), accountPricesTable: accountPrices },
      },
    });
  };

  const onCreateView = async () => {
    if (dirty) await onSave();
    const result = await check.mutateAsync({
      step: 'focusView',
      body: { catalog: remoteCatalog, tier, tableName, accountPricesTable: accountPrices },
    });
    onResult(result);
  };

  return (
    <Section title={t('dataSources.systemTables.step3')}>
      <p className="text-muted-foreground mb-3 text-xs">
        {t('dataSources.systemTables.focusViewDesc')}
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-xs">
          <span className="text-muted-foreground">{t('dataSources.systemTables.catalog')}</span>
          <Input value={remoteCatalog} disabled placeholder="main" />
        </label>
        <label className="grid gap-1 text-xs">
          <span className="text-muted-foreground">{t('dataSources.systemTables.tier')}</span>
          <Input
            value={tier}
            onChange={(e) => setTier(e.target.value)}
            placeholder={FOCUS_VIEW_SCHEMA_DEFAULT}
          />
        </label>
        <label className="grid gap-1 text-xs sm:col-span-2">
          <span className="text-muted-foreground">{t('dataSources.systemTables.tableName')}</span>
          <Input
            value={tableName}
            onChange={(e) => setTableName(e.target.value)}
            placeholder={FOCUS_VIEW_TABLE_DEFAULT}
          />
        </label>
        <label className="grid gap-1 text-xs sm:col-span-2">
          <span className="text-muted-foreground">
            {t('dataSources.systemTables.accountPrices')}
          </span>
          <Input
            value={accountPrices}
            onChange={(e) => setAccountPrices(e.target.value)}
            placeholder={ACCOUNT_PRICES_DEFAULT}
          />
        </label>
      </div>
      <p className="text-muted-foreground mt-2 text-xs">
        {t('dataSources.systemTables.focusViewTarget')}: <code>{fqn}</code>
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" disabled={busy} onClick={onCreateView}>
          {busy ? <Spinner /> : null}
          {t('dataSources.systemTables.createView')}
        </Button>
        {dirty ? (
          <Button type="button" variant="outline" disabled={busy} onClick={onSave}>
            {t('dataSources.systemTables.saveTarget')}
          </Button>
        ) : null}
      </div>
      {!remoteCatalog ? (
        <Alert className="mt-3">
          <Info />
          <AlertDescription>{t('dataSources.systemTables.catalogMissing')}</AlertDescription>
        </Alert>
      ) : null}
      <StepResult result={results.focusView ?? null} />
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
