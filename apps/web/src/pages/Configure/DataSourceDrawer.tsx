import { useState } from 'react';
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
import { useRunSetupCheck } from '../../api/hooks';
import { StepResult } from '../SetupWizard/StepResult';
import type { DataSourceDefinition } from './dataSourceCatalog';
import type { SetupCheckResult, SetupStepId } from '@lakecost/shared';
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
