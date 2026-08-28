import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@databricks/appkit-ui/react';
import {
  ExternalLink,
  HardDrive,
  Info,
  KeyRound,
  MoreHorizontal,
  Plug,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  CATALOG_SETTING_KEY,
  GCP_SOURCE_KIND_TAGGED_DEMO,
  dataSourceKeyString,
  isAwsProvider,
  isCustomProvider,
  isDatabricksProvider,
  isGcpProvider,
  isSnowflakeProvider,
  medallionSchemaNamesFromSettings,
  normalizeGcpBillingAccountId,
  snowflakeSourceIdFromParts,
  toDataSourceKey,
  unquotedFqn,
  type DataSource,
  type ServiceCredentialSummary,
} from '@finlake/shared';
import {
  useAppSettings,
  useCreateServiceCredential,
  useCreateDataSource,
  useDataSources,
  useDeleteDataSource,
} from '../../api/hooks';
import { useI18n, type Locale } from '../../i18n';
import {
  AwsFocusSection,
  DataSourceConfigurator,
  FocusViewSection,
  GcpFocusSection,
  SnowflakeFocusSection,
  type GcpFocusDraft,
  type SnowflakeFocusDraft,
} from './DataSourceDrawer';
import { VendorLogo } from './VendorLogo';
import {
  AwsSetupModal,
  buildAwsSetupArtifacts,
  CreateCredentialModal,
  DEFAULT_CREDENTIAL_NAME,
  DEFAULT_ROLE_NAME,
} from '../ExternalData/Credentials';
import {
  findTemplateById,
  findTemplateForRow,
  getTemplateInputConfig,
  getTemplateRegistryEntry,
} from './dataSourceCatalog';
import { CustomDataSourceDialog } from './CustomDataSourceDialog';
import type { DatabricksFocusDraft } from './DataSources';
import type { AwsFocusDraft } from './useAwsFocusForm';
import { configString, messageOf, nextTableName } from './utils';

type AwsConnectAction = 'service-role' | 'external-location';

function providerRows(rows: DataSource[], templateId: string): DataSource[] {
  return rows.filter((row) => {
    if (templateId === 'aws') {
      return isAwsProvider(row.providerName);
    }
    if (templateId === 'databricks_focus13') {
      return isDatabricksProvider(row.providerName);
    }
    if (templateId === 'custom') {
      return isCustomProvider(row.providerName);
    }
    if (templateId === 'gcp') {
      return isGcpProvider(row.providerName);
    }
    if (templateId === 'snowflake') {
      return isSnowflakeProvider(row.providerName);
    }
    return findTemplateForRow(row)?.id === templateId;
  });
}

function isRegisteredAwsSource(row: DataSource): boolean {
  return ['awsAccountId', 'externalLocationName', 'exportName', 's3Prefix'].every(
    (key) => configString(row.config, key).trim().length > 0,
  );
}

function isRegisteredGcpSource(row: DataSource): boolean {
  const hasSource = ['sourceCatalog', 'sourceSchema', 'sourceTable'].every(
    (key) => configString(row.config, key).trim().length > 0,
  );
  if (!hasSource) return false;
  return configString(row.config, 'sourceKind') === GCP_SOURCE_KIND_TAGGED_DEMO
    ? configString(row.config, 'sourceId').trim().length > 0
    : configString(row.config, 'billingAccountId').trim().length > 0;
}

function isRegisteredSnowflakeSource(row: DataSource): boolean {
  return ['sourceCatalog', 'sourceSchema', 'sourceTable', 'sourceId'].every(
    (key) => configString(row.config, key).trim().length > 0,
  );
}

// `row.accountId` is the AWS account id under the new (provider_name, account_id)
// PK. We still read `config.awsAccountId` first to keep legacy rows (created
// before the migration) rendering correctly until they are re-saved.
function awsAccountIdFor(row: DataSource): string {
  return configString(row.config, 'awsAccountId') || row.accountId;
}

function gcpSourceIdFor(row: DataSource): string {
  if (configString(row.config, 'sourceKind') === GCP_SOURCE_KIND_TAGGED_DEMO) {
    return configString(row.config, 'sourceId') || row.accountId;
  }
  return normalizeGcpBillingAccountId(
    configString(row.config, 'billingAccountId') || row.accountId,
  );
}

function gcpSourceTableFor(row: DataSource): string {
  const sourceFqn = configString(row.config, 'sourceFqn');
  if (sourceFqn) return sourceFqn;
  const sourceCatalog = configString(row.config, 'sourceCatalog');
  const sourceSchema = configString(row.config, 'sourceSchema');
  const sourceTable = configString(row.config, 'sourceTable');
  return sourceCatalog && sourceSchema && sourceTable
    ? unquotedFqn(sourceCatalog, sourceSchema, sourceTable)
    : '-';
}

function snowflakeSourceIdFor(row: DataSource): string {
  const sourceId = configString(row.config, 'sourceId');
  if (sourceId) return sourceId;
  const sourceCatalog = configString(row.config, 'sourceCatalog');
  const sourceSchema = configString(row.config, 'sourceSchema');
  const sourceTable = configString(row.config, 'sourceTable');
  return sourceCatalog && sourceSchema && sourceTable
    ? snowflakeSourceIdFromParts(sourceCatalog, sourceSchema, sourceTable)
    : row.accountId;
}

function snowflakeSourceTableFor(row: DataSource): string {
  const sourceFqn = configString(row.config, 'sourceFqn');
  if (sourceFqn) return sourceFqn;
  const sourceCatalog = configString(row.config, 'sourceCatalog');
  const sourceSchema = configString(row.config, 'sourceSchema');
  const sourceTable = configString(row.config, 'sourceTable');
  return sourceCatalog && sourceSchema && sourceTable
    ? unquotedFqn(sourceCatalog, sourceSchema, sourceTable)
    : '-';
}

function formatUpdatedAt(value: string, locale: Locale): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

const EMPTY_SETTINGS: Record<string, string> = {};
const GCP_CLOUD_BILLING_URL = 'https://console.cloud.google.com/billing';
const GCP_BILLING_EXPORT_DOCS_URL =
  'https://docs.cloud.google.com/billing/docs/how-to/export-data-bigquery-setup';
const SNOWFLAKE_USAGE_DOCS_URL =
  'https://docs.snowflake.com/en/sql-reference/organization-usage/usage_in_currency_daily';

function dataSourceTableDisplayName(row: DataSource, settings: Record<string, string>): string {
  if (isCustomProvider(row.providerName) && row.tableName.includes('.')) return row.tableName;
  const catalog = settings[CATALOG_SETTING_KEY]?.trim();
  const silverSchema = medallionSchemaNamesFromSettings(settings).silver;
  return catalog
    ? unquotedFqn(catalog, silverSchema, row.tableName)
    : `${silverSchema}.${row.tableName}`;
}

function gcpBillingExportDocsUrl(locale: Locale): string {
  return locale === 'ja' ? `${GCP_BILLING_EXPORT_DOCS_URL}?hl=ja` : GCP_BILLING_EXPORT_DOCS_URL;
}

interface IntegrationDetailProps {
  backTo?: string;
  eyebrowKey?: string;
  backLabelKey?: string;
  modalLayout?: 'default' | 'onboarding';
}

function IntegrationHeader({
  templateId,
  backTo = '/integrations',
  eyebrowKey = 'dataSources.detail.eyebrow',
  backLabelKey = 'dataSources.detail.backToIntegrations',
}: {
  templateId: 'aws' | 'custom' | 'databricks_focus13' | 'gcp' | 'snowflake';
  backTo?: string;
  eyebrowKey?: string;
  backLabelKey?: string;
}) {
  const { locale, t } = useI18n();
  const template = findTemplateById(templateId);
  const registryEntry = template ? getTemplateRegistryEntry(template) : undefined;
  if (!template) return null;

  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-center gap-3">
        <VendorLogo source={template} logo={registryEntry?.logo} size={44} />
        <div>
          <Link
            to={backTo}
            aria-label={t(backLabelKey)}
            className="text-muted-foreground hover:text-foreground text-sm transition-colors"
          >
            {t(eyebrowKey)}
          </Link>
          <h3 className="m-0 text-xl font-semibold">{template.name}</h3>
        </div>
      </div>
      {templateId === 'aws' ? (
        <Button type="button" variant="outline" className="integration-docs-action gap-2" asChild>
          <a
            href="https://docs.aws.amazon.com/cur/latest/userguide/what-is-data-exports.html"
            target="_blank"
            rel="noreferrer"
          >
            {t('dataSources.detail.docs')}
            <ExternalLink className="size-4" aria-hidden="true" />
          </a>
        </Button>
      ) : templateId === 'gcp' ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" className="integration-docs-action gap-2" asChild>
            <a href={GCP_CLOUD_BILLING_URL} target="_blank" rel="noreferrer">
              {t('dataSources.detail.cloudBilling')}
              <ExternalLink className="size-4" aria-hidden="true" />
            </a>
          </Button>
          <Button type="button" variant="outline" className="integration-docs-action gap-2" asChild>
            <a href={gcpBillingExportDocsUrl(locale)} target="_blank" rel="noreferrer">
              {t('dataSources.detail.docs')}
              <ExternalLink className="size-4" aria-hidden="true" />
            </a>
          </Button>
        </div>
      ) : templateId === 'snowflake' ? (
        <Button type="button" variant="outline" className="integration-docs-action gap-2" asChild>
          <a href={SNOWFLAKE_USAGE_DOCS_URL} target="_blank" rel="noreferrer">
            {t('dataSources.detail.docs')}
            <ExternalLink className="size-4" aria-hidden="true" />
          </a>
        </Button>
      ) : null}
    </div>
  );
}

export function DatabricksIntegrationDetail(props: IntegrationDetailProps = {}) {
  const dataSources = useDataSources();
  const [createdRow, setCreatedRow] = useState<DataSource | null>(null);
  const rows = dataSources.data?.items ?? [];
  const dbRows = useMemo(() => providerRows(rows, 'databricks_focus13'), [rows]);
  const row = dbRows[0] ?? createdRow;
  const template = findTemplateById('databricks_focus13');
  const input = template ? getTemplateInputConfig(template) : undefined;
  const draft: DatabricksFocusDraft | undefined =
    template && input
      ? {
          templateId: template.id,
          name: template.name,
          providerName: input.providerName,
          tableName: input.defaultTableName,
        }
      : undefined;

  return (
    <>
      <IntegrationHeader templateId="databricks_focus13" {...props} />
      {row ? (
        <DataSourceConfigurator row={row} onClose={() => setCreatedRow(null)} />
      ) : draft ? (
        <FocusViewSection row={null} draft={draft} onCreated={setCreatedRow} />
      ) : null}
    </>
  );
}

export function CustomIntegrationDetail(props: IntegrationDetailProps = {}) {
  const { locale, t } = useI18n();
  const dataSources = useDataSources();
  const createDs = useCreateDataSource();
  const rows = dataSources.data?.items ?? [];
  const customRows = useMemo(() => providerRows(rows, 'custom'), [rows]);
  const [customDialogOpen, setCustomDialogOpen] = useState(false);

  return (
    <>
      <IntegrationHeader templateId="custom" {...props} />
      <div className="grid gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="m-0 text-base font-semibold">
              {t('dataSources.detail.customSourcesTitle')}
            </h4>
            <p className="text-muted-foreground mt-1 mb-0 text-sm">
              {t('dataSources.custom.addDesc')}
            </p>
          </div>
          <Button type="button" className="gap-2" onClick={() => setCustomDialogOpen(true)}>
            <Plug className="size-4" aria-hidden="true" />
            {t('dataSources.custom.addAction')}
          </Button>
        </div>
        <CustomDataSourcesTable rows={customRows} locale={locale} />
      </div>
      <CustomDataSourceDialog
        open={customDialogOpen}
        createPending={createDs.isPending}
        createError={messageOf(createDs.error)}
        registeredTableNames={customRows.map((row) => row.tableName)}
        onClose={() => setCustomDialogOpen(false)}
        onSubmit={async ({ name, pipelineId, tableName }) => {
          await createDs.mutateAsync({
            templateId: 'custom',
            name,
            providerName: 'custom',
            tableName,
            pipelineId: pipelineId ?? undefined,
            enabled: true,
          });
          setCustomDialogOpen(false);
        }}
      />
    </>
  );
}

export function AwsIntegrationDetail(props: IntegrationDetailProps = {}) {
  const { locale, t } = useI18n();
  const dataSources = useDataSources();
  const createCredential = useCreateServiceCredential();
  const rows = dataSources.data?.items ?? [];
  const awsRows = useMemo(() => providerRows(rows, 'aws'), [rows]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [connectChooserOpen, setConnectChooserOpen] = useState(false);
  const [connectAction, setConnectAction] = useState<AwsConnectAction | null>(null);
  const [createServiceRoleOpen, setCreateServiceRoleOpen] = useState(false);
  const [serviceAwsAccountId, setServiceAwsAccountId] = useState('');
  const [serviceRoleName, setServiceRoleName] = useState(DEFAULT_ROLE_NAME);
  const [serviceCredentialName, setServiceCredentialName] = useState(DEFAULT_CREDENTIAL_NAME);
  const [serviceCredentialNameEdited, setServiceCredentialNameEdited] = useState(false);
  const [setupModalCredential, setSetupModalCredential] = useState<ServiceCredentialSummary | null>(
    null,
  );
  const template = findTemplateById('aws');
  const input = template ? getTemplateInputConfig(template) : undefined;
  const hasExistingAwsSources = awsRows.length > 0;
  const draft =
    template && input
      ? {
          templateId: template.id,
          name: template.name,
          providerName: input.providerName,
          tableName: nextTableName(input.defaultTableName, rows),
        }
      : undefined;
  const registeredAccountIds = useMemo(
    () => Array.from(new Set(awsRows.map(awsAccountIdFor))),
    [awsRows],
  );
  const selectedRow = selectedKey
    ? (awsRows.find((row) => dataSourceKeyString(row) === selectedKey) ?? null)
    : null;
  const normalizedServiceAccountId = serviceAwsAccountId.trim();
  const normalizedServiceRoleName = serviceRoleName.trim();
  const normalizedServiceCredentialName = serviceCredentialName.trim();
  const validServiceAccountId = /^\d{12}$/.test(normalizedServiceAccountId);
  const validServiceRoleName = /^[A-Za-z0-9_+=,.@-]{1,64}$/.test(normalizedServiceRoleName);
  const validServiceCredentialName = /^[A-Za-z_][A-Za-z0-9_]*$/.test(
    normalizedServiceCredentialName,
  );
  const canCreateServiceCredential =
    validServiceAccountId &&
    validServiceRoleName &&
    validServiceCredentialName &&
    !createCredential.isPending;
  const createServiceCredentialError = messageOf(createCredential.error);
  const setupArtifacts = useMemo(
    () => (setupModalCredential ? buildAwsSetupArtifacts(setupModalCredential) : null),
    [setupModalCredential],
  );

  const closeConnectModal = useCallback(() => setConnectAction(null), []);
  const closeConnectChooser = useCallback(() => setConnectChooserOpen(false), []);
  const openConnectAction = (action: AwsConnectAction) => {
    setConnectChooserOpen(false);
    setConnectAction(action);
  };

  const onCreated = (_row: DataSource) => {
    setConnectAction(null);
  };
  const onServiceAccountIdChange = (value: string) => {
    setServiceAwsAccountId(value);
    if (!serviceCredentialNameEdited) {
      const trimmed = value.trim();
      setServiceCredentialName(
        trimmed ? `finlake_service_credential_${trimmed}` : DEFAULT_CREDENTIAL_NAME,
      );
    }
  };
  const openCreateServiceRole = () => {
    setConnectChooserOpen(false);
    createCredential.reset();
    setServiceCredentialNameEdited(false);
    setServiceCredentialName(
      normalizedServiceAccountId
        ? `finlake_service_credential_${normalizedServiceAccountId}`
        : DEFAULT_CREDENTIAL_NAME,
    );
    setCreateServiceRoleOpen(true);
  };
  const onSubmitServiceCredential = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canCreateServiceCredential) return;
    createCredential.reset();
    createCredential.mutate(
      {
        name: normalizedServiceCredentialName,
        awsAccountId: normalizedServiceAccountId,
        roleName: normalizedServiceRoleName,
      },
      {
        onSuccess: (data) => {
          setCreateServiceRoleOpen(false);
          setSetupModalCredential(data.serviceCredential);
        },
      },
    );
  };

  return (
    <>
      <IntegrationHeader templateId="aws" {...props} />
      {hasExistingAwsSources ? (
        <div className="grid gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="m-0 text-base font-semibold">
                {t('dataSources.detail.awsAccountsTitle')}
              </h4>
              <p className="text-muted-foreground mt-1 mb-0 text-sm">
                {t('dataSources.detail.connectIntro.description')}
              </p>
            </div>
            {draft ? (
              <Button type="button" className="gap-2" onClick={() => setConnectChooserOpen(true)}>
                <Plug className="size-4" aria-hidden="true" />
                {t('dataSources.detail.connectAccount')}
              </Button>
            ) : null}
          </div>
          <AwsAccountsTable
            rows={awsRows}
            locale={locale}
            onConfigure={(row) => setSelectedKey(dataSourceKeyString(row))}
            onRemoved={(row) => {
              if (selectedKey === dataSourceKeyString(row)) setSelectedKey(null);
            }}
          />
        </div>
      ) : draft ? (
        <div className="grid gap-5">
          <AwsConnectIntro
            onConnectWithServiceRole={() => openConnectAction('service-role')}
            onConnectWithExternalLocation={() => openConnectAction('external-location')}
            onCreateServiceRole={openCreateServiceRole}
          />
        </div>
      ) : null}
      <AwsConnectChooserModal
        open={connectChooserOpen}
        onConnectWithServiceRole={() => openConnectAction('service-role')}
        onConnectWithExternalLocation={() => openConnectAction('external-location')}
        onCreateServiceRole={openCreateServiceRole}
        onClose={closeConnectChooser}
      />
      {draft ? (
        <AwsConnectSetupModal
          action={connectAction}
          draft={draft}
          excludedAccountIds={registeredAccountIds}
          onCreated={onCreated}
          onClose={closeConnectModal}
        />
      ) : null}
      <CreateCredentialModal
        open={createServiceRoleOpen}
        awsAccountId={serviceAwsAccountId}
        roleName={serviceRoleName}
        createPending={createCredential.isPending}
        canSubmit={canCreateServiceCredential}
        validAccountId={validServiceAccountId}
        validRoleName={validServiceRoleName}
        validServiceCredentialName={validServiceCredentialName}
        createError={createServiceCredentialError}
        setServiceAwsAccountId={onServiceAccountIdChange}
        setServiceRoleName={setServiceRoleName}
        onSubmitService={onSubmitServiceCredential}
        onClose={() => setCreateServiceRoleOpen(false)}
      />
      <AwsSetupModal
        credential={setupModalCredential}
        artifacts={setupArtifacts}
        layout={props.modalLayout}
        onClose={() => setSetupModalCredential(null)}
      />
      {selectedRow ? (
        <AwsAccountSettingsSheet row={selectedRow} onClose={() => setSelectedKey(null)} />
      ) : null}
    </>
  );
}

export function GcpIntegrationDetail(props: IntegrationDetailProps = {}) {
  const { locale, t } = useI18n();
  const dataSources = useDataSources();
  const rows = dataSources.data?.items ?? [];
  const gcpRows = useMemo(() => providerRows(rows, 'gcp'), [rows]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const template = findTemplateById('gcp');
  const input = template ? getTemplateInputConfig(template) : undefined;
  const draft: GcpFocusDraft | undefined =
    template && input
      ? {
          templateId: template.id,
          name: template.name,
          providerName: input.providerName,
          tableName: nextTableName(input.defaultTableName, rows),
        }
      : undefined;
  const selectedRow = selectedKey
    ? (gcpRows.find((row) => dataSourceKeyString(row) === selectedKey) ?? null)
    : null;
  const registeredAccountIds = useMemo(
    () => Array.from(new Set(gcpRows.map(gcpSourceIdFor))),
    [gcpRows],
  );

  return (
    <>
      <IntegrationHeader templateId="gcp" {...props} />
      {gcpRows.length > 0 ? (
        <div className="grid gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="m-0 text-base font-semibold">
                {t('dataSources.detail.gcpAccountsTitle')}
              </h4>
              <p className="text-muted-foreground mt-1 mb-0 text-sm">
                {t('dataSources.gcp.connectDescription')}
              </p>
            </div>
            {draft ? (
              <Button type="button" className="gap-2" onClick={() => setConnectOpen(true)}>
                <Plug className="size-4" aria-hidden="true" />
                {t('dataSources.gcp.useExistingForeignCatalog')}
              </Button>
            ) : null}
          </div>
          <GcpAccountsTable
            rows={gcpRows}
            locale={locale}
            onConfigure={(row) => setSelectedKey(dataSourceKeyString(row))}
            onRemoved={(row) => {
              if (selectedKey === dataSourceKeyString(row)) setSelectedKey(null);
            }}
          />
        </div>
      ) : draft ? (
        <section className="grid max-w-5xl gap-5">
          <h4 className="m-0 text-2xl font-semibold">{t('dataSources.gcp.connectTitle')}</h4>
          <p className="text-muted-foreground m-0 text-base">
            {t('dataSources.gcp.connectDescription')}
          </p>
          <div>
            <Button type="button" className="gap-2" onClick={() => setConnectOpen(true)}>
              <Plug className="size-4" aria-hidden="true" />
              {t('dataSources.gcp.useExistingForeignCatalog')}
            </Button>
          </div>
        </section>
      ) : null}
      {draft ? (
        <GcpConnectSetupModal
          open={connectOpen}
          draft={draft}
          excludedAccountIds={registeredAccountIds}
          onCreated={() => setConnectOpen(false)}
          onClose={() => setConnectOpen(false)}
        />
      ) : null}
      {selectedRow ? (
        <GcpAccountSettingsSheet row={selectedRow} onClose={() => setSelectedKey(null)} />
      ) : null}
    </>
  );
}

function GcpConnectSetupModal({
  open,
  draft,
  excludedAccountIds,
  onCreated,
  onClose,
}: {
  open: boolean;
  draft: GcpFocusDraft;
  excludedAccountIds: string[];
  onCreated: (row: DataSource) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4"
      role="presentation"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="gcp-connect-setup-modal-title"
        className="bg-background border-border grid max-h-[88vh] w-full max-w-3xl grid-rows-[auto_1fr] rounded-lg border shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 p-5">
          <div className="min-w-0">
            <h3 id="gcp-connect-setup-modal-title" className="text-base font-semibold">
              {t('dataSources.gcp.useExistingForeignCatalog')}
            </h3>
            <p className="text-muted-foreground mt-1 mb-0 text-sm">
              {t('dataSources.gcp.modalDescription')}
            </p>
          </div>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground hover:bg-muted/40 grid size-8 place-items-center rounded-md transition-colors"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto p-5">
          <GcpFocusSection
            row={null}
            draft={draft}
            excludedAccountIds={excludedAccountIds}
            onCreated={onCreated}
          />
        </div>
      </div>
    </div>
  );
}

function GcpAccountSettingsSheet({ row, onClose }: { row: DataSource; onClose: () => void }) {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  const requestClose = useCallback(() => {
    setShown(false);
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(onClose, 180);
  }, [onClose]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setShown(true));
    return () => {
      window.cancelAnimationFrame(frame);
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  return (
    <div
      className={cn(
        'fixed inset-0 z-[60] flex items-end justify-center bg-black/50 px-4 pt-12 transition-opacity duration-200',
        shown ? 'opacity-100' : 'opacity-0',
      )}
      role="presentation"
      onMouseDown={requestClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="gcp-account-settings-sheet-title"
        className={cn(
          'bg-background border-border max-h-[86vh] w-full max-w-5xl overflow-y-auto rounded-t-xl border px-5 pt-5 pb-6 shadow-xl transition-transform duration-200 ease-out',
          shown ? 'translate-y-0' : 'translate-y-full',
        )}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h4 id="gcp-account-settings-sheet-title" className="m-0 text-base font-semibold">
              {t('dataSources.detail.gcpSelectedSettings', {
                account: gcpSourceIdFor(row),
              })}
            </h4>
          </div>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground hover:bg-muted/40 grid size-8 place-items-center rounded-md transition-colors"
            aria-label={t('common.close')}
            onClick={requestClose}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <DataSourceConfigurator row={row} onClose={requestClose} />
      </div>
    </div>
  );
}

function GcpAccountsTable({
  rows,
  locale,
  onConfigure,
  onRemoved,
}: {
  rows: DataSource[];
  locale: Locale;
  onConfigure: (row: DataSource) => void;
  onRemoved: (row: DataSource) => void;
}) {
  const { t } = useI18n();
  const deleteDs = useDeleteDataSource();
  const appSettings = useAppSettings();
  const settings = appSettings.data?.settings ?? EMPTY_SETTINGS;
  const deleteErrorMessage = messageOf(deleteDs.error);

  const onRemove = (row: DataSource) => {
    if (!window.confirm(t('dataSources.confirmDelete', { name: gcpSourceIdFor(row) }))) {
      return;
    }
    deleteDs.mutate(toDataSourceKey(row), { onSuccess: () => onRemoved(row) });
  };

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="text-muted-foreground py-8 text-sm">
          {t('dataSources.detail.gcpEmpty')}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-3">
      {deleteErrorMessage ? (
        <Alert variant="destructive">
          <Info />
          <AlertDescription>{deleteErrorMessage}</AlertDescription>
        </Alert>
      ) : null}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('dataSources.detail.columns.account')}</TableHead>
              <TableHead>{t('dataSources.gcp.sourceTable')}</TableHead>
              <TableHead>{t('dataSources.columns.table')}</TableHead>
              <TableHead>{t('dataSources.detail.columns.lastUpdated')}</TableHead>
              <TableHead>{t('dataSources.detail.columns.status')}</TableHead>
              <TableHead className="text-right" aria-label={t('dataSources.columns.actions')} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={dataSourceKeyString(row)}
                className="cursor-pointer"
                onClick={() => onConfigure(row)}
              >
                <TableCell>
                  <div className="flex min-w-40 flex-wrap items-center gap-2 font-medium">
                    {gcpSourceIdFor(row)}
                    {configString(row.config, 'sourceKind') === GCP_SOURCE_KIND_TAGGED_DEMO ? (
                      <span className="bg-warning/15 text-warning-foreground rounded px-1.5 py-0.5 text-xs">
                        {t('dataSources.gcp.syntheticDemoBadge')}
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-muted-foreground font-mono text-xs">
                    {gcpSourceTableFor(row)}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="text-muted-foreground font-mono text-xs">
                    {dataSourceTableDisplayName(row, settings)}
                  </span>
                </TableCell>
                <TableCell>{formatUpdatedAt(row.updatedAt, locale)}</TableCell>
                <TableCell>
                  {isRegisteredGcpSource(row) && row.enabled
                    ? t('dataSources.detail.connected')
                    : t('dataSources.badges.setupRequired')}
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-8"
                        aria-label={t('dataSources.detail.moreActions')}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <MoreHorizontal className="size-4" aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <a
                          href="https://console.cloud.google.com/bigquery"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t('dataSources.detail.openInGcp')}
                        </a>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={deleteDs.isPending}
                        onClick={(event) => {
                          event.stopPropagation();
                          onRemove(row);
                        }}
                      >
                        {t('dataSources.detail.remove')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function SnowflakeIntegrationDetail(props: IntegrationDetailProps = {}) {
  const { locale, t } = useI18n();
  const dataSources = useDataSources();
  const rows = dataSources.data?.items ?? [];
  const snowflakeRows = useMemo(() => providerRows(rows, 'snowflake'), [rows]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const template = findTemplateById('snowflake');
  const input = template ? getTemplateInputConfig(template) : undefined;
  const draft: SnowflakeFocusDraft | undefined =
    template && input
      ? {
          templateId: template.id,
          name: template.name,
          providerName: input.providerName,
          tableName: nextTableName(input.defaultTableName, rows),
        }
      : undefined;
  const selectedRow = selectedKey
    ? (snowflakeRows.find((row) => dataSourceKeyString(row) === selectedKey) ?? null)
    : null;
  const registeredSourceIds = useMemo(
    () => Array.from(new Set(snowflakeRows.map(snowflakeSourceIdFor))),
    [snowflakeRows],
  );

  return (
    <>
      <IntegrationHeader templateId="snowflake" {...props} />
      {snowflakeRows.length > 0 ? (
        <div className="grid gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="m-0 text-base font-semibold">
                {t('dataSources.detail.snowflakeSourcesTitle')}
              </h4>
              <p className="text-muted-foreground mt-1 mb-0 text-sm">
                {t('dataSources.snowflake.connectDescription')}
              </p>
            </div>
            {draft ? (
              <Button type="button" className="gap-2" onClick={() => setConnectOpen(true)}>
                <Plug className="size-4" aria-hidden="true" />
                {t('dataSources.snowflake.useExistingForeignCatalog')}
              </Button>
            ) : null}
          </div>
          <SnowflakeSourcesTable
            rows={snowflakeRows}
            locale={locale}
            onConfigure={(row) => setSelectedKey(dataSourceKeyString(row))}
            onRemoved={(row) => {
              if (selectedKey === dataSourceKeyString(row)) setSelectedKey(null);
            }}
          />
        </div>
      ) : draft ? (
        <section className="grid max-w-5xl gap-5">
          <h4 className="m-0 text-2xl font-semibold">{t('dataSources.snowflake.connectTitle')}</h4>
          <p className="text-muted-foreground m-0 text-base">
            {t('dataSources.snowflake.connectDescription')}
          </p>
          <div>
            <Button type="button" className="gap-2" onClick={() => setConnectOpen(true)}>
              <Plug className="size-4" aria-hidden="true" />
              {t('dataSources.snowflake.useExistingForeignCatalog')}
            </Button>
          </div>
        </section>
      ) : null}
      {draft ? (
        <SnowflakeConnectSetupModal
          open={connectOpen}
          draft={draft}
          excludedSourceIds={registeredSourceIds}
          onCreated={() => setConnectOpen(false)}
          onClose={() => setConnectOpen(false)}
        />
      ) : null}
      {selectedRow ? (
        <SnowflakeSourceSettingsSheet row={selectedRow} onClose={() => setSelectedKey(null)} />
      ) : null}
    </>
  );
}

function SnowflakeConnectSetupModal({
  open,
  draft,
  excludedSourceIds,
  onCreated,
  onClose,
}: {
  open: boolean;
  draft: SnowflakeFocusDraft;
  excludedSourceIds: string[];
  onCreated: (row: DataSource) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4"
      role="presentation"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="snowflake-connect-setup-modal-title"
        className="bg-background border-border grid max-h-[88vh] w-full max-w-3xl grid-rows-[auto_1fr] rounded-lg border shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 p-5">
          <div className="min-w-0">
            <h3 id="snowflake-connect-setup-modal-title" className="text-base font-semibold">
              {t('dataSources.snowflake.useExistingForeignCatalog')}
            </h3>
            <p className="text-muted-foreground mt-1 mb-0 text-sm">
              {t('dataSources.snowflake.modalDescription')}
            </p>
          </div>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground hover:bg-muted/40 grid size-8 place-items-center rounded-md transition-colors"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto p-5">
          <SnowflakeFocusSection
            row={null}
            draft={draft}
            excludedSourceIds={excludedSourceIds}
            onCreated={onCreated}
          />
        </div>
      </div>
    </div>
  );
}

function SnowflakeSourceSettingsSheet({ row, onClose }: { row: DataSource; onClose: () => void }) {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  const requestClose = useCallback(() => {
    setShown(false);
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(onClose, 180);
  }, [onClose]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setShown(true));
    return () => {
      window.cancelAnimationFrame(frame);
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  return (
    <div
      className={cn(
        'fixed inset-0 z-[60] flex items-end justify-center bg-black/50 px-4 pt-12 transition-opacity duration-200',
        shown ? 'opacity-100' : 'opacity-0',
      )}
      role="presentation"
      onMouseDown={requestClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="snowflake-source-settings-sheet-title"
        className={cn(
          'bg-background border-border max-h-[86vh] w-full max-w-5xl overflow-y-auto rounded-t-xl border px-5 pt-5 pb-6 shadow-xl transition-transform duration-200 ease-out',
          shown ? 'translate-y-0' : 'translate-y-full',
        )}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h4 id="snowflake-source-settings-sheet-title" className="m-0 text-base font-semibold">
              {t('dataSources.detail.snowflakeSelectedSettings', {
                source: snowflakeSourceTableFor(row),
              })}
            </h4>
          </div>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground hover:bg-muted/40 grid size-8 place-items-center rounded-md transition-colors"
            aria-label={t('common.close')}
            onClick={requestClose}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <DataSourceConfigurator row={row} onClose={requestClose} />
      </div>
    </div>
  );
}

function SnowflakeSourcesTable({
  rows,
  locale,
  onConfigure,
  onRemoved,
}: {
  rows: DataSource[];
  locale: Locale;
  onConfigure: (row: DataSource) => void;
  onRemoved: (row: DataSource) => void;
}) {
  const { t } = useI18n();
  const deleteDs = useDeleteDataSource();
  const appSettings = useAppSettings();
  const settings = appSettings.data?.settings ?? EMPTY_SETTINGS;
  const deleteErrorMessage = messageOf(deleteDs.error);

  const onRemove = (row: DataSource) => {
    if (!window.confirm(t('dataSources.confirmDelete', { name: snowflakeSourceTableFor(row) }))) {
      return;
    }
    deleteDs.mutate(toDataSourceKey(row), { onSuccess: () => onRemoved(row) });
  };

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="text-muted-foreground py-8 text-sm">
          {t('dataSources.detail.snowflakeEmpty')}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-3">
      {deleteErrorMessage ? (
        <Alert variant="destructive">
          <Info />
          <AlertDescription>{deleteErrorMessage}</AlertDescription>
        </Alert>
      ) : null}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('dataSources.detail.columns.source')}</TableHead>
              <TableHead>{t('dataSources.snowflake.sourceTable')}</TableHead>
              <TableHead>{t('dataSources.columns.table')}</TableHead>
              <TableHead>{t('dataSources.detail.columns.lastUpdated')}</TableHead>
              <TableHead>{t('dataSources.detail.columns.status')}</TableHead>
              <TableHead className="text-right" aria-label={t('dataSources.columns.actions')} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={dataSourceKeyString(row)}
                className="cursor-pointer"
                onClick={() => onConfigure(row)}
              >
                <TableCell>
                  <div className="min-w-40 font-medium">{snowflakeSourceIdFor(row)}</div>
                </TableCell>
                <TableCell>
                  <span className="text-muted-foreground font-mono text-xs">
                    {snowflakeSourceTableFor(row)}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="text-muted-foreground font-mono text-xs">
                    {dataSourceTableDisplayName(row, settings)}
                  </span>
                </TableCell>
                <TableCell>{formatUpdatedAt(row.updatedAt, locale)}</TableCell>
                <TableCell>
                  {isRegisteredSnowflakeSource(row)
                    ? t('dataSources.detail.connected')
                    : t('dataSources.badges.setupRequired')}
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-8"
                        aria-label={t('dataSources.detail.moreActions')}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <MoreHorizontal className="size-4" aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        disabled={deleteDs.isPending}
                        onClick={(event) => {
                          event.stopPropagation();
                          onRemove(row);
                        }}
                      >
                        {t('dataSources.detail.remove')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function AwsAccountSettingsSheet({ row, onClose }: { row: DataSource; onClose: () => void }) {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  const requestClose = useCallback(() => {
    setShown(false);
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(onClose, 180);
  }, [onClose]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setShown(true));
    return () => {
      window.cancelAnimationFrame(frame);
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        requestClose();
        return;
      }
      if (event.key === 'Tab') {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusable = dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [requestClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const first = dialog.querySelector<HTMLElement>(
      'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    first?.focus();
  }, []);

  return (
    <div
      className={cn(
        'fixed inset-0 z-[60] flex items-end justify-center bg-black/50 px-4 pt-12 transition-opacity duration-200',
        shown ? 'opacity-100' : 'opacity-0',
      )}
      role="presentation"
      onMouseDown={requestClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="aws-account-settings-sheet-title"
        className={cn(
          'bg-background border-border max-h-[86vh] w-full max-w-5xl overflow-y-auto rounded-t-xl border px-5 pt-5 pb-6 shadow-xl transition-transform duration-200 ease-out',
          shown ? 'translate-y-0' : 'translate-y-full',
        )}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h4 id="aws-account-settings-sheet-title" className="m-0 text-base font-semibold">
              {t('dataSources.detail.selectedSettings', {
                account: awsAccountIdFor(row),
              })}
            </h4>
          </div>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground hover:bg-muted/40 grid size-8 place-items-center rounded-md transition-colors"
            aria-label={t('common.close')}
            onClick={requestClose}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <DataSourceConfigurator row={row} onClose={requestClose} />
      </div>
    </div>
  );
}

function AwsConnectActions({
  onConnectWithServiceRole,
  onConnectWithExternalLocation,
  onCreateServiceRole,
}: {
  onConnectWithServiceRole: () => void;
  onConnectWithExternalLocation: () => void;
  onCreateServiceRole: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap gap-3">
      <Button type="button" className="gap-2" onClick={onConnectWithServiceRole}>
        <ShieldCheck className="size-4" aria-hidden="true" />
        {t('dataSources.detail.connectIntro.actions.serviceRole')}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="gap-2"
        onClick={onConnectWithExternalLocation}
      >
        <HardDrive className="size-4" aria-hidden="true" />
        {t('dataSources.detail.connectIntro.actions.externalLocation')}
      </Button>
      <Button type="button" variant="outline" className="gap-2" onClick={onCreateServiceRole}>
        <KeyRound className="size-4" aria-hidden="true" />
        {t('dataSources.detail.connectIntro.actions.createServiceRole')}
      </Button>
    </div>
  );
}

function AwsConnectIntro({
  onConnectWithServiceRole,
  onConnectWithExternalLocation,
  onCreateServiceRole,
}: {
  onConnectWithServiceRole: () => void;
  onConnectWithExternalLocation: () => void;
  onCreateServiceRole: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="grid max-w-5xl gap-5">
      <h4 className="m-0 text-2xl font-semibold">{t('dataSources.detail.connectIntro.title')}</h4>
      <p className="text-muted-foreground m-0 text-base">
        {t('dataSources.detail.connectIntro.description')}
      </p>
      <div className="grid gap-4">
        <section className="grid gap-2">
          <h5 className="text-foreground m-0 text-sm font-semibold">
            {t('dataSources.detail.connectIntro.serviceCredentialTitle')}
          </h5>
          <p className="text-muted-foreground m-0 text-sm">
            {t('dataSources.detail.connectIntro.serviceCredentialDesc')}
          </p>
        </section>
        <section className="grid gap-2">
          <h5 className="text-foreground m-0 text-sm font-semibold">
            {t('dataSources.detail.connectIntro.setupPathTitle')}
          </h5>
          <ul className="text-muted-foreground m-0 grid gap-1 pl-5 text-sm">
            <li>{t('dataSources.detail.connectIntro.setupPathServiceRole')}</li>
            <li>{t('dataSources.detail.connectIntro.setupPathExternalLocation')}</li>
          </ul>
          <p className="text-muted-foreground m-0 text-sm">
            <strong className="text-foreground">
              {t('dataSources.detail.connectIntro.noteLabel')}
            </strong>{' '}
            {t('dataSources.detail.connectIntro.note')}
          </p>
        </section>
        <section className="grid gap-2">
          <h5 className="text-foreground m-0 text-sm font-semibold">
            {t('dataSources.detail.connectIntro.afterSetupTitle')}
          </h5>
          <p className="text-muted-foreground m-0 text-sm">
            <strong className="text-foreground">
              {t('dataSources.detail.connectIntro.returnLabel')}
            </strong>{' '}
            {t('dataSources.detail.connectIntro.afterSetupDesc')}
          </p>
        </section>
      </div>
      <div className="mt-2">
        <AwsConnectActions
          onConnectWithServiceRole={onConnectWithServiceRole}
          onConnectWithExternalLocation={onConnectWithExternalLocation}
          onCreateServiceRole={onCreateServiceRole}
        />
      </div>
    </section>
  );
}

function AwsConnectChooserModal({
  open,
  onConnectWithServiceRole,
  onConnectWithExternalLocation,
  onCreateServiceRole,
  onClose,
}: {
  open: boolean;
  onConnectWithServiceRole: () => void;
  onConnectWithExternalLocation: () => void;
  onCreateServiceRole: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4"
      role="presentation"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="aws-connect-chooser-title"
        className="bg-background border-border grid w-full max-w-2xl gap-5 rounded-lg border p-5 shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 id="aws-connect-chooser-title" className="m-0 text-base font-semibold">
              {t('dataSources.detail.connectAccount')}
            </h3>
            <p className="text-muted-foreground mt-1 mb-0 text-sm">
              {t('dataSources.detail.connectIntro.description')}
            </p>
          </div>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground hover:bg-muted/40 grid size-8 place-items-center rounded-md transition-colors"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <AwsConnectActions
          onConnectWithServiceRole={onConnectWithServiceRole}
          onConnectWithExternalLocation={onConnectWithExternalLocation}
          onCreateServiceRole={onCreateServiceRole}
        />
      </div>
    </div>
  );
}

function AwsConnectSetupModal({
  action,
  draft,
  excludedAccountIds,
  onCreated,
  onClose,
}: {
  action: AwsConnectAction | null;
  draft: AwsFocusDraft;
  excludedAccountIds: string[];
  onCreated: (row: DataSource) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [createProgressOpen, setCreateProgressOpen] = useState(false);
  const [createProgressComplete, setCreateProgressComplete] = useState(false);

  useEffect(() => {
    if (!action) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !createProgressOpen) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [action, createProgressOpen, onClose]);

  useEffect(() => {
    if (!action) return;
    setCreateProgressOpen(false);
    setCreateProgressComplete(false);
  }, [action]);

  if (!action) return null;

  const setupMode = action === 'service-role' ? 'create' : 'existing';
  const titleKey =
    action === 'service-role'
      ? 'dataSources.detail.connectIntro.actions.serviceRole'
      : 'dataSources.detail.connectIntro.actions.externalLocation';
  const descriptionKey =
    action === 'service-role'
      ? 'dataSources.detail.connectIntro.actionDescriptions.serviceRole'
      : 'dataSources.detail.connectIntro.actionDescriptions.externalLocation';

  return (
    <div
      className={cn(
        'fixed inset-0 z-[60] flex items-center justify-center p-4',
        createProgressComplete ? 'bg-transparent' : 'bg-black/55',
      )}
      role="presentation"
      onMouseDown={createProgressOpen ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="aws-connect-setup-modal-title"
        className={cn(
          'bg-background border-border grid max-h-[88vh] w-full max-w-3xl grid-rows-[auto_1fr] rounded-lg border shadow-xl',
          createProgressComplete ? 'contents' : null,
        )}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div
          className={cn(
            'flex items-start justify-between gap-4 p-5',
            createProgressComplete ? 'hidden' : null,
          )}
        >
          <div className="min-w-0">
            <h3 id="aws-connect-setup-modal-title" className="text-base font-semibold">
              {t(titleKey)}
            </h3>
            <p className="text-muted-foreground mt-1 mb-0 text-sm">{t(descriptionKey)}</p>
          </div>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground hover:bg-muted/40 grid size-8 place-items-center rounded-md transition-colors"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div
          className={cn('min-h-0 overflow-y-auto p-5', createProgressComplete ? 'contents' : null)}
        >
          <AwsFocusSection
            key={action}
            row={null}
            draft={draft}
            excludedAccountIds={excludedAccountIds}
            initialSetupMode={setupMode}
            hideSetupMode
            onCreated={onCreated}
            onCreateProgressOpenChange={setCreateProgressOpen}
            onCreateProgressCompleteChange={setCreateProgressComplete}
          />
        </div>
      </div>
    </div>
  );
}

function CustomDataSourcesTable({ rows, locale }: { rows: DataSource[]; locale: Locale }) {
  const { t } = useI18n();
  const deleteDs = useDeleteDataSource();
  const appSettings = useAppSettings();
  const settings = appSettings.data?.settings ?? EMPTY_SETTINGS;
  const deleteErrorMessage = messageOf(deleteDs.error);

  const onRemove = (row: DataSource) => {
    if (!window.confirm(t('dataSources.confirmDelete', { name: row.name }))) return;
    deleteDs.mutate(toDataSourceKey(row));
  };

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="text-muted-foreground py-8 text-sm">
          {t('dataSources.detail.customEmpty')}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-3">
      {deleteErrorMessage ? (
        <Alert variant="destructive">
          <Info />
          <AlertDescription>{deleteErrorMessage}</AlertDescription>
        </Alert>
      ) : null}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('dataSources.custom.displayName')}</TableHead>
              <TableHead>{t('dataSources.columns.table')}</TableHead>
              <TableHead>{t('dataSources.custom.pipelineId')}</TableHead>
              <TableHead>{t('dataSources.detail.columns.lastUpdated')}</TableHead>
              <TableHead>{t('dataSources.detail.columns.status')}</TableHead>
              <TableHead className="text-right" aria-label={t('dataSources.columns.actions')} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={dataSourceKeyString(row)}>
                <TableCell>
                  <div className="min-w-48 font-medium">{row.name}</div>
                </TableCell>
                <TableCell>
                  <span className="text-muted-foreground font-mono text-xs">
                    {dataSourceTableDisplayName(row, settings)}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="text-muted-foreground font-mono text-xs">
                    {row.pipelineId ?? t('dataSources.custom.noPipeline')}
                  </span>
                </TableCell>
                <TableCell>{formatUpdatedAt(row.updatedAt, locale)}</TableCell>
                <TableCell>
                  {row.enabled ? t('dataSources.badges.enabled') : t('dataSources.badges.disabled')}
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-8"
                        aria-label={t('dataSources.detail.moreActions')}
                      >
                        <MoreHorizontal className="size-4" aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem disabled={deleteDs.isPending} onClick={() => onRemove(row)}>
                        {t('dataSources.detail.remove')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function AwsAccountsTable({
  rows,
  locale,
  onConfigure,
  onRemoved,
}: {
  rows: DataSource[];
  locale: Locale;
  onConfigure: (row: DataSource) => void;
  onRemoved: (row: DataSource) => void;
}) {
  const { t } = useI18n();
  const deleteDs = useDeleteDataSource();
  const appSettings = useAppSettings();
  const settings = appSettings.data?.settings ?? EMPTY_SETTINGS;
  const deleteErrorMessage = messageOf(deleteDs.error);

  const onRemove = (row: DataSource) => {
    if (!window.confirm(t('dataSources.confirmDelete', { name: awsAccountIdFor(row) }))) return;
    deleteDs.mutate(toDataSourceKey(row), { onSuccess: () => onRemoved(row) });
  };

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="text-muted-foreground py-8 text-sm">
          {t('dataSources.detail.awsEmpty')}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-3">
      {deleteErrorMessage ? (
        <Alert variant="destructive">
          <Info />
          <AlertDescription>{deleteErrorMessage}</AlertDescription>
        </Alert>
      ) : null}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('dataSources.detail.columns.account')}</TableHead>
              <TableHead>{t('dataSources.columns.table')}</TableHead>
              <TableHead>{t('dataSources.detail.columns.storageCredential')}</TableHead>
              <TableHead>{t('dataSources.detail.columns.lastUpdated')}</TableHead>
              <TableHead>{t('dataSources.detail.columns.status')}</TableHead>
              <TableHead className="text-right" aria-label={t('dataSources.columns.actions')} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={dataSourceKeyString(row)}
                className="cursor-pointer"
                onClick={() => onConfigure(row)}
              >
                <TableCell>
                  <div className="min-w-40 font-medium">{awsAccountIdFor(row)}</div>
                </TableCell>
                <TableCell>
                  <span className="text-muted-foreground font-mono text-xs">
                    {dataSourceTableDisplayName(row, settings)}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="text-muted-foreground font-mono text-xs">
                    {configString(row.config, 'storageCredentialName') || '-'}
                  </span>
                </TableCell>
                <TableCell>{formatUpdatedAt(row.updatedAt, locale)}</TableCell>
                <TableCell>
                  {isRegisteredAwsSource(row)
                    ? t('dataSources.detail.connected')
                    : t('dataSources.badges.setupRequired')}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="size-8"
                          aria-label={t('dataSources.detail.moreActions')}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <MoreHorizontal className="size-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <a
                            href="https://console.aws.amazon.com/"
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t('dataSources.detail.openInAws')}
                          </a>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={deleteDs.isPending}
                          onClick={(event) => {
                            event.stopPropagation();
                            onRemove(row);
                          }}
                        >
                          {t('dataSources.detail.remove')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
