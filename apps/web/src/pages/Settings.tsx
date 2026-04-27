import { PageHeader } from '../components/PageHeader';
import { useI18n, type Locale } from '../i18n';

export function Settings() {
  const { t, locale, setLocale } = useI18n();
  return (
    <>
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0, fontSize: 14, color: 'var(--muted)' }}>
          {t('settings.languageHeading')}
        </h3>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
          {t('settings.languageDesc')}
        </p>
        <div className="lang-toggle" role="group" aria-label={t('common.language')}>
          {(['en', 'ja'] as Locale[]).map((l) => (
            <button
              key={l}
              type="button"
              className={locale === l ? 'active' : ''}
              onClick={() => setLocale(l)}
            >
              {l === 'en' ? t('common.english') : t('common.japanese')}
            </button>
          ))}
        </div>
      </div>
      <div className="card">
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>{t('settings.body')}</p>
      </div>
    </>
  );
}
