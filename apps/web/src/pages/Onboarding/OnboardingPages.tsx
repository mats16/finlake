import { useMemo, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { type DataSource, type PricingNotebookState } from '@finlake/shared';
import { Button, Skeleton } from '@databricks/appkit-ui/react';
import { ArrowRight, X } from 'lucide-react';
import { CatalogSettingsForm } from '../../components/CatalogSettingsForm';
import { useDataSources, useDataSourceTemplates, usePricingNotebook } from '../../api/hooks';
import { useI18n } from '../../i18n';
import { AwsIntegrationDetail, DatabricksIntegrationDetail } from '../Configure/IntegrationDetails';
import { Pricing } from '../Configure/Pricing';
import { DataSourceTile, type TileBadge } from '../Configure/DataSourceTile';
import {
  DATA_SOURCE_TEMPLATES,
  PRICING_AWS_TEMPLATE,
  PRICING_DATABRICKS_TEMPLATE,
  canCreateTemplate,
  getTemplateRegistryEntry,
  isRegisteredPricing,
  rowMatchesTemplate,
  type DataSourceTemplate,
} from '../Configure/dataSourceCatalog';

const INTEGRATION_BACK_PROPS = {
  backTo: '/onboarding/integration',
  eyebrowKey: 'onboarding.integration.eyebrow',
  backLabelKey: 'onboarding.integration.backToCatalog',
  modalLayout: 'onboarding' as const,
};

const PRICING_BACK_PROPS = {
  backTo: '/onboarding/pricing',
  eyebrowKey: 'onboarding.pricing.eyebrow',
  backLabelKey: 'onboarding.pricing.backToCatalog',
};

const PRICING_OPTIONS = [
  {
    key: 'aws',
    path: '/onboarding/pricing/aws',
    template: PRICING_AWS_TEMPLATE,
    logo: { kind: 'aws' as const },
    matches: (row: PricingNotebookState) => row.id.startsWith('aws_'),
  },
  {
    key: 'databricks',
    path: '/onboarding/pricing/databricks',
    template: PRICING_DATABRICKS_TEMPLATE,
    logo: { kind: 'databricks' as const },
    matches: (row: PricingNotebookState) => row.id.startsWith('databricks_'),
  },
] as const;

export function OnboardingCatalog() {
  return (
    <section className="onboarding-panel onboarding-catalog-panel">
      <CatalogSettingsForm variant="onboarding" />
    </section>
  );
}

export function OnboardingIntegration() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const dataSources = useDataSources();
  const templates = useDataSourceTemplates();
  const rows = dataSources.data?.items ?? [];
  const availableTemplates = useMemo(
    () => templates.data?.items ?? DATA_SOURCE_TEMPLATES,
    [templates.data?.items],
  );

  const detailPathForTemplate = (template: DataSourceTemplate): string | null => {
    if (template.id === 'databricks_focus13') return '/onboarding/integration/databricks';
    if (template.id === 'aws') return '/onboarding/integration/aws';
    return null;
  };

  return (
    <section className="onboarding-grid-section">
      {dataSources.isLoading || templates.isLoading ? <OnboardingTileSkeletons /> : null}
      {!dataSources.isLoading && !templates.isLoading ? (
        <div className="onboarding-provider-grid">
          {availableTemplates.map((template) => {
            const existing = rows.find((row) => rowMatchesTemplate(row, template));
            const registryEntry = getTemplateRegistryEntry(template);
            const detailPath = detailPathForTemplate(template);
            const canOpen = Boolean(detailPath) && canCreateTemplate(template);
            const badges = integrationBadges(existing, template, t);

            return (
              <DataSourceTile
                key={template.id}
                source={template}
                logo={registryEntry?.logo}
                badges={badges}
                muted={!canOpen}
                onClick={canOpen ? () => navigate(detailPath!) : undefined}
              />
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

export function OnboardingDatabricksIntegration() {
  return (
    <OnboardingDetailPanel backTo="/onboarding/integration">
      <DatabricksIntegrationDetail {...INTEGRATION_BACK_PROPS} />
    </OnboardingDetailPanel>
  );
}

export function OnboardingAwsIntegration() {
  return (
    <OnboardingDetailPanel backTo="/onboarding/integration">
      <AwsIntegrationDetail {...INTEGRATION_BACK_PROPS} />
    </OnboardingDetailPanel>
  );
}

export function OnboardingPricing() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const pricing = usePricingNotebook();
  const pricingRows = pricing.data?.items ?? [];

  return (
    <section className="onboarding-grid-section">
      {pricing.isLoading ? <OnboardingTileSkeletons count={2} /> : null}
      {!pricing.isLoading ? (
        <div className="onboarding-provider-grid onboarding-pricing-grid">
          {PRICING_OPTIONS.map((option) => {
            const providerRows = pricingRows.filter(option.matches);
            const registered = providerRows.some(isRegisteredPricing);
            const enabled = providerRows.some((row) => Boolean(row.table));
            const badges: TileBadge[] = registered
              ? [
                  enabled
                    ? { label: t('dataSources.badges.enabled'), variant: 'enabled' }
                    : { label: t('dataSources.badges.setupRequired'), variant: 'unknown' },
                ]
              : [];

            return (
              <DataSourceTile
                key={option.key}
                source={option.template}
                logo={option.logo}
                badges={badges}
                onClick={() => navigate(option.path)}
              />
            );
          })}
        </div>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        className="onboarding-skip-action"
        onClick={() => navigate('/overview')}
      >
        {t('onboarding.pricing.skip')}
        <ArrowRight className="size-4" aria-hidden="true" />
      </Button>
    </section>
  );
}

export function OnboardingAwsPricing() {
  return (
    <OnboardingDetailPanel backTo="/onboarding/pricing">
      <Pricing provider="aws" {...PRICING_BACK_PROPS} />
    </OnboardingDetailPanel>
  );
}

export function OnboardingDatabricksPricing() {
  return (
    <OnboardingDetailPanel backTo="/onboarding/pricing">
      <Pricing provider="databricks" {...PRICING_BACK_PROPS} />
    </OnboardingDetailPanel>
  );
}

function OnboardingDetailPanel({ backTo, children }: { backTo: string; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <section className="onboarding-detail-panel">
      <Link to={backTo} className="onboarding-detail-close" aria-label={t('common.close')}>
        <X className="size-5" aria-hidden="true" />
      </Link>
      {children}
    </section>
  );
}

function integrationBadges(
  existing: DataSource | undefined,
  template: DataSourceTemplate,
  t: (key: string) => string,
): TileBadge[] {
  if (existing) {
    return [
      existing.enabled
        ? { label: t('dataSources.badges.enabled'), variant: 'enabled' }
        : { label: t('dataSources.badges.setupRequired'), variant: 'unknown' },
    ];
  }
  if (!canCreateTemplate(template)) {
    return [{ label: t('dataSources.badges.comingSoon'), variant: 'neutral' }];
  }
  return [];
}

function OnboardingTileSkeletons({ count = 4 }: { count?: number }) {
  return (
    <div className="onboarding-provider-grid">
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton key={index} className="h-30 min-h-30 rounded-lg" />
      ))}
    </div>
  );
}
