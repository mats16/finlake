import { useI18n } from '../../i18n';

export function Stub({ titleKey, descKey }: { titleKey: string; descKey: string }) {
  const { t } = useI18n();
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t(titleKey)}</h3>
      <p style={{ color: 'var(--muted)', fontSize: 13 }}>{t(descKey)}</p>
      <div className="banner unknown">{t('configure.stubBanner')}</div>
    </div>
  );
}
