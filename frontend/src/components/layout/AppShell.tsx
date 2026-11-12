import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  ChevronDown,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  ShoppingBasket,
  Store,
  User as UserIcon,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { NAV, titleFor } from '@/app/nav';
import { Button } from '@/components/ui/button';
import { get, send } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import { useUi } from '@/stores/ui';
import type { Settings } from '@/types';

function Sidebar({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const can = useAuth((s) => s.can);
  const items = NAV.filter((n) => !n.permission || can(n.permission));
  return (
    <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto p-2 scroll-thin">
      {items.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          title={collapsed ? label : undefined}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface hover:text-foreground',
              isActive && 'bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary',
              collapsed && 'justify-center px-2',
            )
          }
        >
          <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
          <span className={cn(collapsed && 'sr-only')}>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

const Brand = ({ collapsed }: { collapsed: boolean }) => (
  <div className={cn('flex h-14 items-center gap-2.5 border-b px-4', collapsed && 'justify-center px-2')}>
    <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
      <ShoppingBasket className="h-4 w-4" />
    </div>
    {!collapsed && <span className="text-sm font-semibold">Supermarket POS</span>}
  </div>
);

export function AppShell() {
  const { collapsed, toggle } = useUi();
  const [mobileOpen, setMobileOpen] = useState(false);
  const user = useAuth((s) => s.user)!;
  const clear = useAuth((s) => s.clear);
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => setMobileOpen(false), [loc.pathname]);

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => get<Settings>('/settings'),
    staleTime: 5 * 60_000,
  });
  const unread = useQuery({
    queryKey: ['notif-unread'],
    queryFn: () => get<{ unread: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
  });

  const logout = async () => {
    try {
      await send('post', '/auth/logout', undefined, { 'X-Requested-With': 'pos-web' });
    } catch {
      /* session may already be gone */
    }
    clear();
    nav('/login', { replace: true });
  };
  const unreadCount = unread.data?.data.unread ?? 0;
  const isPos = loc.pathname.startsWith('/pos');

  return (
    <div className="flex h-screen overflow-hidden bg-surface/50">
      <aside
        className={cn(
          'no-print hidden shrink-0 flex-col border-r bg-background transition-[width] md:flex',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <Brand collapsed={collapsed} />
        <Sidebar collapsed={collapsed} />
        <div className="border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            className={cn('w-full justify-start gap-2 text-muted-foreground', collapsed && 'justify-center')}
            onClick={toggle}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <>
                <PanelLeftClose className="h-4 w-4" /> Collapse
              </>
            )}
          </Button>
        </div>
      </aside>

      {mobileOpen && (
        <div
          className="no-print fixed inset-0 z-40 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-background shadow-pop">
            <div className="flex items-center justify-between pr-2">
              <Brand collapsed={false} />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close menu"
                onClick={() => setMobileOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <Sidebar collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="Open menu"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <h2 className="truncate text-base font-semibold">{titleFor(loc.pathname)}</h2>
          <div className="ml-auto flex items-center gap-2">
            <div
              className="hidden items-center gap-1.5 rounded-md border bg-surface px-2.5 py-1.5 text-xs text-muted-foreground sm:flex"
              title="Current store"
            >
              <Store className="h-3.5 w-3.5" /> {settings.data?.data.store.name ?? 'Store'}
            </div>
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="relative"
              aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
            >
              <Link to="/notifications">
                <Bell className="h-[18px] w-[18px]" />
                {unreadCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </Link>
            </Button>
            <Dropdown.Root>
              <Dropdown.Trigger asChild>
                <Button variant="ghost" className="gap-2 px-2" aria-label="Account menu">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                    {user.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="hidden text-left text-sm leading-tight sm:block">
                    <span className="block font-medium">{user.name}</span>
                    <span className="block text-[11px] capitalize text-muted-foreground">
                      {user.role.toLowerCase()}
                    </span>
                  </span>
                  <ChevronDown className="hidden h-3.5 w-3.5 sm:block" />
                </Button>
              </Dropdown.Trigger>
              <Dropdown.Portal>
                <Dropdown.Content
                  align="end"
                  sideOffset={6}
                  className="z-50 min-w-48 rounded-md border bg-background p-1 shadow-pop"
                >
                  <Dropdown.Item
                    onSelect={() => nav('/profile')}
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-sm outline-none data-[highlighted]:bg-surface"
                  >
                    <UserIcon className="h-4 w-4" /> Profile & password
                  </Dropdown.Item>
                  <Dropdown.Separator className="my-1 h-px bg-border" />
                  <Dropdown.Item
                    onSelect={logout}
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-sm text-danger outline-none data-[highlighted]:bg-danger-soft"
                  >
                    <LogOut className="h-4 w-4" /> Sign out
                  </Dropdown.Item>
                </Dropdown.Content>
              </Dropdown.Portal>
            </Dropdown.Root>
          </div>
        </header>
        <main id="main" className={cn('flex-1 overflow-y-auto', isPos ? 'p-3' : 'p-4 md:p-6')}>
          <div className={cn(!isPos && 'mx-auto max-w-[1400px]')}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
