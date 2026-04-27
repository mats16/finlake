import { type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@databricks/appkit-ui/react';
import { ExternalLink, Globe, Settings as SettingsIcon } from 'lucide-react';
import { useI18n, type Locale } from '../../i18n';
import { useMe } from '../../api/hooks';

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
          <AccountMenu />
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

function AccountMenu() {
  const { t, locale, setLocale } = useI18n();
  const navigate = useNavigate();
  const me = useMe();

  const email = me.data?.email ?? null;
  const userName = me.data?.userName ?? null;
  const displayName = email ?? userName ?? t('account.localUser');
  const initial = (email ?? userName ?? 'U').trim().charAt(0).toUpperCase() || 'U';
  const workspaceUrl = me.data?.workspaceUrl ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="account-trigger" aria-label={t('account.openMenu')}>
          <span className="avatar" aria-hidden="true">
            {initial}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-72">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate text-sm font-semibold" title={displayName}>
            {displayName}
          </span>
          {userName && email && userName !== email ? (
            <span className="text-muted-foreground text-xs">{userName}</span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuLabel className="text-muted-foreground text-[10px] tracking-wider uppercase">
          {t('account.sectionApp')}
        </DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => navigate('/settings')}>
            <SettingsIcon />
            <span>{t('account.settings')}</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Globe />
            <span className="flex-1">{t('common.language')}</span>
            <span className="text-muted-foreground text-xs">
              {locale === 'ja' ? t('common.japanese') : t('common.english')}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={locale} onValueChange={(v) => setLocale(v as Locale)}>
              <DropdownMenuRadioItem value="en">{t('common.english')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="ja">{t('common.japanese')}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {workspaceUrl ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href={workspaceUrl} target="_blank" rel="noreferrer noopener">
                <ExternalLink />
                <span>{t('account.databricksConsole')}</span>
              </a>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
