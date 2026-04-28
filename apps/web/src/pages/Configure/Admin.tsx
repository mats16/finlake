import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Spinner,
} from '@databricks/appkit-ui/react';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { CATALOG_SETTING_KEY, MEDALLION_SCHEMAS, type ProvisionResult } from '@lakecost/shared';
import { useI18n } from '../../i18n';
import { useAppSettings, useCatalogs, useUpdateAppSettings } from '../../api/hooks';
import { CatalogCombobox, type CatalogSelection } from '../../components/CatalogCombobox';

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function Admin() {
  const { t } = useI18n();
  const settings = useAppSettings();
  const catalogs = useCatalogs();
  const updateSettings = useUpdateAppSettings();

  const remoteCatalog = settings.data?.settings[CATALOG_SETTING_KEY] ?? '';
  const [selection, setSelection] = useState<CatalogSelection>({
    name: remoteCatalog,
    create: false,
  });
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [provision, setProvision] = useState<ProvisionResult | null>(null);

  useEffect(() => {
    setSelection({ name: remoteCatalog, create: false });
  }, [remoteCatalog]);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = selection.name.trim();
    if (!name) return;
    setProvision(null);
    updateSettings.mutate(
      {
        settings: { [CATALOG_SETTING_KEY]: name },
        provision: { createIfMissing: selection.create },
      },
      {
        onSuccess: (data) => {
          setSavedAt(Date.now());
          setProvision(data.provision ?? null);
        },
      },
    );
  };

  const dirty = selection.name.trim() !== remoteCatalog;
  const saving = updateSettings.isPending;
  const errorMessage =
    updateSettings.error && typeof updateSettings.error === 'object'
      ? ((updateSettings.error as { message?: string }).message ?? null)
      : null;

  const catalogsError =
    catalogs.error && typeof catalogs.error === 'object'
      ? ((catalogs.error as { message?: string }).message ?? null)
      : null;

  const provisionMessages = useMemo(
    () => (provision ? buildProvisionMessages(provision, t) : null),
    [provision, t],
  );

  return (
    <form onSubmit={onSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.mainCatalogHeading')}</CardTitle>
          <CardDescription>{t('settings.mainCatalogDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="catalog-name">{t('settings.mainCatalogHeading')}</FieldLabel>
              <CatalogCombobox
                value={selection.name}
                onChange={setSelection}
                options={catalogs.data?.catalogs ?? []}
                loading={catalogs.isLoading}
                disabled={settings.isLoading || saving}
                placeholder={t('settings.catalogSelectPlaceholder')}
                searchPlaceholder={t('settings.catalogSearchPlaceholder')}
                emptyText={t('settings.catalogEmpty')}
                createLabel={(name) => t('settings.catalogCreateOption', { name })}
                validateName={(s) => IDENT_RE.test(s)}
              />
              <FieldDescription>{t('settings.mainCatalogDesc')}</FieldDescription>
            </Field>

            {catalogsError ? (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>{t('settings.catalogLoadFailed')}</AlertTitle>
                <AlertDescription>{catalogsError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={!dirty || saving || !selection.name.trim()}>
                {saving ? (
                  <>
                    <Spinner /> {t('common.saving')}
                  </>
                ) : selection.create ? (
                  t('settings.saveAndCreate')
                ) : (
                  t('settings.save')
                )}
              </Button>
              {savedAt && !dirty && !saving ? (
                <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
                  <CheckCircle2 className="size-3.5 text-(--success)" />
                  {t('settings.saved')}
                </span>
              ) : null}
            </div>

            {errorMessage ? (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            ) : null}

            {provisionMessages ? (
              <Alert variant={provisionMessages.variant}>
                {provisionMessages.variant === 'destructive' ? (
                  <AlertCircle />
                ) : provisionMessages.isWarning ? (
                  <Info />
                ) : (
                  <CheckCircle2 />
                )}
                <AlertTitle>{provisionMessages.title}</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4 text-xs">
                    {provisionMessages.lines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  {provisionMessages.remediation ? (
                    <pre className="bg-muted text-muted-foreground mt-2 overflow-auto rounded p-2 text-xs">
                      {provisionMessages.remediation}
                    </pre>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}
          </FieldGroup>
        </CardContent>
      </Card>
    </form>
  );
}

interface ProvisionMessages {
  variant: 'default' | 'destructive';
  isWarning: boolean;
  title: string;
  lines: string[];
  remediation: string | null;
}

function buildProvisionMessages(
  p: ProvisionResult,
  t: (key: string, params?: Record<string, string | number>) => string,
): ProvisionMessages {
  const lines: string[] = [];
  if (p.catalogCreated) {
    lines.push(t('settings.provisionCatalogCreated', { name: p.catalog }));
  }
  for (const s of MEDALLION_SCHEMAS) {
    const status = p.schemasEnsured[s];
    if (status === 'created') {
      lines.push(t('settings.provisionSchemaCreated', { schema: s }));
    } else if (status === 'error') {
      lines.push(t('settings.provisionSchemaFailed', { schema: s }));
    }
  }

  const grantEntries: Array<{ scope: string; status: string }> = [
    { scope: t('settings.provisionScopeCatalog'), status: p.grants.catalog },
    ...MEDALLION_SCHEMAS.map((s) => ({ scope: s, status: p.grants[s] })),
  ];
  const grantFailures = grantEntries.filter((e) => e.status.startsWith('error:'));
  const grantSkips = grantEntries.filter((e) => e.status.startsWith('skipped:'));
  const grantsOk = grantEntries.every((e) => e.status === 'granted');

  for (const f of grantFailures) {
    lines.push(
      t('settings.provisionGrantFailed', {
        scope: f.scope,
        message: f.status.slice('error:'.length),
      }),
    );
  }

  for (const w of p.warnings) lines.push(w);

  const isErr = grantFailures.length > 0 || Object.values(p.schemasEnsured).includes('error');
  const isWarn = !isErr && grantSkips.length > 0;

  let title: string;
  if (isErr) title = t('settings.provisionFailed');
  else if (isWarn) title = t('settings.provisionWarning');
  else title = t('settings.provisionSuccess');

  if (lines.length === 0 && grantsOk) {
    lines.push(t('settings.provisionAllOk', { name: p.catalog }));
  }

  const remediation =
    grantFailures.length > 0 && p.servicePrincipalId
      ? renderRemediationSql(p.catalog, p.servicePrincipalId)
      : null;

  return {
    variant: isErr ? 'destructive' : 'default',
    isWarning: isWarn,
    title,
    lines,
    remediation,
  };
}

function renderRemediationSql(catalog: string, sp: string): string {
  const lines: string[] = [];
  lines.push(`GRANT USE CATALOG ON CATALOG \`${catalog}\` TO \`${sp}\`;`);
  for (const s of MEDALLION_SCHEMAS) {
    lines.push(`GRANT USE SCHEMA, SELECT ON SCHEMA \`${catalog}\`.\`${s}\` TO \`${sp}\`;`);
  }
  return lines.join('\n');
}
