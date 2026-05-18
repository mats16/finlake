import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Alert,
  AlertDescription,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Spinner,
  cn,
} from '@databricks/appkit-ui/react';
import { AlertCircle, ArrowLeft, ArrowRight, Check, Globe, Layers } from 'lucide-react';
import { CATALOG_SETTING_KEY } from '@finlake/shared';
import { useAppSettings, useRunSharedTransformationJob } from '../../api/hooks';
import { SqlWarehouseSelector } from '../../components/SqlWarehouseSelector';
import { useI18n, type Locale } from '../../i18n';
import { messageOf } from '../Configure/utils';

const ONBOARDING_STEPS = [
  {
    id: 'catalog',
    path: '/onboarding/catalog',
    titleKey: 'onboarding.catalog.title',
    descKey: 'onboarding.catalog.desc',
  },
  {
    id: 'integration',
    path: '/onboarding/integration',
    titleKey: 'onboarding.integration.title',
    descKey: 'onboarding.integration.desc',
  },
  {
    id: 'pricing',
    path: '/onboarding/pricing',
    titleKey: 'onboarding.pricing.title',
    descKey: 'onboarding.pricing.desc',
  },
] as const;

function activeStepIndex(pathname: string): number {
  if (pathname.startsWith('/onboarding/pricing')) return 2;
  if (pathname.startsWith('/onboarding/integration')) return 1;
  return 0;
}

export function OnboardingLayout() {
  const { t, locale, setLocale } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const appSettings = useAppSettings();
  const runSharedJob = useRunSharedTransformationJob();
  const catalogConfigured = Boolean(appSettings.data?.settings[CATALOG_SETTING_KEY]?.trim());
  const index = activeStepIndex(location.pathname);
  const step = ONBOARDING_STEPS[index] ?? ONBOARDING_STEPS[0];
  const previousIndexRef = useRef(index);
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');

  useEffect(() => {
    setDirection(index >= previousIndexRef.current ? 'forward' : 'backward');
    previousIndexRef.current = index;
  }, [index]);

  const nextPath = useMemo(() => {
    if (index >= ONBOARDING_STEPS.length - 1) return '/overview';
    return ONBOARDING_STEPS[index + 1]!.path;
  }, [index]);
  const previousPath = previousPathForOnboardingRoute(location.pathname, index);
  const nextDisabled = (index === 0 && !catalogConfigured) || runSharedJob.isPending;
  const nextLabel =
    index === 1 && runSharedJob.isPending
      ? t('onboarding.integration.runningJob')
      : index >= ONBOARDING_STEPS.length - 1
        ? t('onboarding.finish')
        : t('onboarding.next');
  const runSharedJobError = messageOf(runSharedJob.error);

  const onNext = async () => {
    if (index === 1) {
      runSharedJob.reset();
      try {
        await runSharedJob.mutateAsync();
      } catch {
        return; // error displayed via runSharedJobError alert
      }
    }
    navigate(nextPath);
  };

  return (
    <div className="onboarding-page">
      <header className="onboarding-topbar">
        <Link to="/overview" className="onboarding-brand" aria-label={t('appName')}>
          <Layers className="onboarding-brand-icon" aria-hidden="true" />
          <span>{t('appName')}</span>
        </Link>
        <div className="onboarding-topbar-actions">
          <SqlWarehouseSelector triggerClassName="w-[220px] sm:w-[260px]" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="onboarding-language"
                aria-label={t('common.language')}
              >
                <Globe className="size-4" aria-hidden="true" />
                <span>{locale === 'ja' ? t('common.japanese') : t('common.english')}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                value={locale}
                onValueChange={(value) => setLocale(value as Locale)}
              >
                <DropdownMenuRadioItem value="en">{t('common.english')}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="ja">{t('common.japanese')}</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main className="onboarding-main">
        <div className="onboarding-heading">
          <h1>{t(step.titleKey)}</h1>
          <p>{t(step.descKey)}</p>
        </div>
        <div key={location.pathname} className={cn('onboarding-slide', direction)}>
          <Outlet />
        </div>
      </main>

      {runSharedJobError ? (
        <Alert variant="destructive" className="onboarding-footer-alert">
          <AlertCircle />
          <AlertDescription>{runSharedJobError}</AlertDescription>
        </Alert>
      ) : null}

      <footer className="onboarding-footer">
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            if (previousPath) navigate(previousPath);
          }}
          disabled={!previousPath}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t('onboarding.back')}
        </Button>

        <div className="onboarding-dots" aria-label={t('onboarding.steps')}>
          {ONBOARDING_STEPS.map((item, itemIndex) => {
            const locked = itemIndex > 0 && !catalogConfigured;
            return (
              <button
                key={item.id}
                type="button"
                className={cn(itemIndex === index ? 'active' : null)}
                aria-label={t('onboarding.stepLabel', {
                  step: itemIndex + 1,
                  title: t(item.titleKey),
                })}
                aria-current={itemIndex === index ? 'step' : undefined}
                disabled={locked}
                onClick={() => navigate(item.path)}
              />
            );
          })}
        </div>

        <Button type="button" onClick={() => void onNext()} disabled={nextDisabled}>
          {nextLabel}
          {runSharedJob.isPending ? (
            <Spinner className="size-4" aria-hidden="true" />
          ) : index >= ONBOARDING_STEPS.length - 1 ? (
            <Check className="size-4" aria-hidden="true" />
          ) : (
            <ArrowRight className="size-4" aria-hidden="true" />
          )}
        </Button>
      </footer>
    </div>
  );
}

function previousPathForOnboardingRoute(pathname: string, index: number): string | null {
  if (pathname.startsWith('/onboarding/integration/')) return '/onboarding/integration';
  if (pathname.startsWith('/onboarding/pricing/')) return '/onboarding/pricing';
  return index > 0 ? ONBOARDING_STEPS[index - 1]!.path : null;
}
