import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert,
  AlertDescription,
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
  Input,
  Spinner,
} from '@databricks/appkit-ui/react';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { useI18n } from '../i18n';
import { useAppSettings, useUpdateAppSettings } from '../api/hooks';

const MAIN_CATALOG_KEY = 'catalog_name';

export function Settings() {
  const { t } = useI18n();
  const settings = useAppSettings();
  const updateSettings = useUpdateAppSettings();

  const remoteCatalog = settings.data?.settings[MAIN_CATALOG_KEY] ?? '';
  const [catalog, setCatalog] = useState(remoteCatalog);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setCatalog(remoteCatalog);
  }, [remoteCatalog]);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    updateSettings.mutate(
      { [MAIN_CATALOG_KEY]: catalog.trim() },
      { onSuccess: () => setSavedAt(Date.now()) },
    );
  };

  const dirty = catalog.trim() !== remoteCatalog;
  const saving = updateSettings.isPending;
  const errorMessage =
    updateSettings.error && typeof updateSettings.error === 'object'
      ? ((updateSettings.error as { message?: string }).message ?? null)
      : null;

  return (
    <>
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />
      <form onSubmit={onSubmit}>
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>{t('settings.mainCatalogHeading')}</CardTitle>
            <CardDescription>{t('settings.mainCatalogDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="catalog-name">{t('settings.mainCatalogHeading')}</FieldLabel>
                <Input
                  id="catalog-name"
                  type="text"
                  value={catalog}
                  placeholder={t('settings.mainCatalogPlaceholder')}
                  onChange={(e) => setCatalog(e.target.value)}
                  disabled={settings.isLoading || saving}
                  className="max-w-md"
                />
                <FieldDescription>{t('settings.mainCatalogDesc')}</FieldDescription>
              </Field>
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={!dirty || saving}>
                  {saving ? (
                    <>
                      <Spinner /> {t('common.saving')}
                    </>
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
            </FieldGroup>
          </CardContent>
        </Card>
      </form>

      <Card>
        <CardContent>
          <p className="text-muted-foreground text-sm">{t('settings.body')}</p>
        </CardContent>
      </Card>
    </>
  );
}
