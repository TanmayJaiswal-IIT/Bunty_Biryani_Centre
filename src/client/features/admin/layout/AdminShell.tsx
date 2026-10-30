import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import logo96 from '../../../assets/logo-96.webp';
import { Banner } from '../../../components/Banner';
import { Chip } from '../../../components/Chip';
import { Icon } from '../../../components/Icon';
import { OverflowMenu } from '../../../components/OverflowMenu';
import { copy } from '../../../copy';
import { api } from '../../../lib/api';
import { useClearSwrCache } from '../auth/useAdminSession';
import { NewOrdersProvider, useNewOrders } from '../alerts/NewOrdersProvider';
import { GuardedLink, NavigationGuardProvider } from './NavigationGuard';
import { PausedStrip } from './PausedStrip';

const TABS = [
  { id: 'today', path: '/admin', label: copy.admin.tabs.today },
  { id: 'stock', path: '/admin/stock', label: copy.admin.tabs.stock },
  { id: 'menu', path: '/admin/menu', label: copy.admin.tabs.menu },
  { id: 'settings', path: '/admin/delivery', label: copy.admin.tabs.settings },
] as const;

function AdminShellContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const clearCache = useClearSwrCache();
  const { soundBlocked, enableSound } = useNewOrders();
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const logout = async () => {
    setLoggingOut(true);
    setError(null);
    try {
      await api<void>('/api/admin/logout', { method: 'POST' });
      await clearCache();
      void navigate('/admin/login', { replace: true });
    } catch {
      setError(copy.common.networkError);
      setLoggingOut(false);
    }
  };

  const pathname = location.pathname;

  return (
    <NavigationGuardProvider>
      <div className="mx-auto flex min-h-dvh max-w-120 flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-3 bg-sun px-4 py-2">
          <img src={logo96} width={40} height={40} alt="" className="size-10 rounded-control" />
          <span className="display flex-1 text-lg">{copy.admin.shellTitle}</span>
          <GuardedLink
            to="/admin/orders"
            aria-label={copy.admin.searchOrders}
            className="flex size-10 items-center justify-center rounded-control text-ink hover:bg-neutral-100 active:bg-neutral-200"
          >
            <Icon name="search" size={20} />
          </GuardedLink>
          <OverflowMenu
            label={copy.admin.menuMore}
            items={[
              {
                label: loggingOut ? copy.admin.loggingOut : copy.admin.logout,
                onSelect: () => void logout(),
                tone: 'danger',
                disabled: loggingOut,
              },
            ]}
          />
        </header>

        <main className="flex-1 px-4 pb-20 pt-4">
          {soundBlocked && (
            <div className="mb-4">
              <button
                type="button"
                onClick={enableSound}
                className="inline-flex cursor-pointer"
              >
                <Chip tone="warning" icon="volume">
                  {copy.admin.soundBlockedChip}
                </Chip>
              </button>
            </div>
          )}
          <PausedStrip />
          {error && (
            <Banner tone="danger" className="mb-4">
              {error}
            </Banner>
          )}
          <Outlet />
        </main>

        <nav
          aria-label="Admin sections"
          className="fixed inset-x-0 bottom-0 z-10 mx-auto max-w-120 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-bar"
        >
          <ul className="grid h-14 grid-cols-4">
            {TABS.map((tab) => {
              const isActive =
                tab.path === '/admin'
                  ? pathname === '/admin'
                  : pathname.startsWith(tab.path);
              return (
                <li key={tab.id} className="flex">
                  <GuardedLink
                    to={tab.path}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex flex-1 items-center justify-center text-sm font-semibold transition-colors ${
                      isActive ? 'text-brand' : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    {tab.label}
                  </GuardedLink>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </NavigationGuardProvider>
  );
}

/** Top bar, page area and bottom tabs with alert notifications. */
export function AdminShell() {
  return (
    <NewOrdersProvider>
      <AdminShellContent />
    </NewOrdersProvider>
  );
}
