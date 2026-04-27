import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useI18n, type Locale } from '../../i18n';

interface NavItem {
  to: string;
  labelKey: string;
  end?: boolean;
}

interface NavGroup {
  labelKey: string;
  items: NavItem[];
  matchPrefix: string;
}

const PRIMARY: NavItem[] = [{ to: '/dashboard', labelKey: 'nav.overview' }];

const CONFIGURE: NavGroup = {
  labelKey: 'nav.configure',
  matchPrefix: '/configure',
  items: [
    { to: '/configure/data-sources', labelKey: 'nav.dataSources' },
    { to: '/configure/detection-rules', labelKey: 'nav.detectionRules' },
    { to: '/configure/transformations', labelKey: 'nav.transformations' },
    { to: '/configure/admin', labelKey: 'nav.admin' },
  ],
};

const SECONDARY: NavItem[] = [
  { to: '/explorer', labelKey: 'nav.costExplorer' },
  { to: '/budgets', labelKey: 'nav.budgets' },
  { to: '/settings', labelKey: 'nav.settings' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { t } = useI18n();
  const configureOpen = location.pathname.startsWith(CONFIGURE.matchPrefix);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>{t('appName')}</h1>
        <div className="nav-section-label">{t('nav.finops')}</div>
        <nav>
          {PRIMARY.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              {t(item.labelKey)}
            </NavLink>
          ))}

          <div className={`nav-group ${configureOpen ? 'open' : ''}`}>
            <NavLink
              to={CONFIGURE.items[0]?.to ?? '/configure/data-sources'}
              className={() => (configureOpen ? 'group-head active' : 'group-head')}
            >
              {t(CONFIGURE.labelKey)}
            </NavLink>
            {configureOpen ? (
              <div className="nav-children">
                {CONFIGURE.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) => (isActive ? 'active' : '')}
                  >
                    {t(item.labelKey)}
                  </NavLink>
                ))}
              </div>
            ) : null}
          </div>

          {SECONDARY.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              {t(item.labelKey)}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <LanguageMenu />
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

function LanguageMenu() {
  const { t, locale, setLocale } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const select = (l: Locale) => {
    setLocale(l);
    setOpen(false);
  };

  const currentLabel = locale === 'ja' ? t('common.japanese') : t('common.english');

  return (
    <div className="lang-menu" ref={ref}>
      <button
        type="button"
        className="lang-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="icon" aria-hidden="true">
          🌐
        </span>
        <span className="label">{t('common.language')}</span>
        <span className="current">{currentLabel}</span>
      </button>
      {open ? (
        <div className="lang-menu-popover" role="menu">
          {(['en', 'ja'] as Locale[]).map((l) => {
            const active = locale === l;
            return (
              <button
                key={l}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                className="lang-menu-item"
                onClick={() => select(l)}
              >
                <span className="check" aria-hidden="true">
                  {active ? '✓' : ''}
                </span>
                <span>{l === 'en' ? t('common.english') : t('common.japanese')}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
