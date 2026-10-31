import { useQueryClient } from '@tanstack/react-query';
import { AlertOctagon, AlertTriangle, CheckCheck, Info } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { PageHeader, Toolbar } from '@/components/shared/bits';
import { EmptyState, ErrorState, LoadingRows } from '@/components/shared/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { Pagination } from '@/components/shared/DataTable';
import { useList } from '@/hooks/useList';
import { errMsg, send } from '@/lib/api';
import { dateTime, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Notification } from '@/types';

const icon = { critical: AlertOctagon, warning: AlertTriangle, info: Info } as const;
const tone = {
  critical: 'text-danger bg-danger-soft',
  warning: 'text-warning bg-warning-soft',
  info: 'text-primary bg-primary-soft',
} as const;

export function NotificationsPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const list = useList<Notification>('notifications', '/notifications', { limit: 20 });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['notifications'] });
    qc.invalidateQueries({ queryKey: ['notif-unread'] });
  };
  const open = async (n: Notification) => {
    if (!n.read) {
      try {
        await send('post', `/notifications/${n._id}/read`);
        refresh();
      } catch (e) {
        toast.error(errMsg(e));
      }
    }
    if (n.link) nav(n.link);
  };
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Stock and expiry alerts generated from live inventory data."
        actions={
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await send('post', '/notifications/read-all');
                refresh();
                toast.success('All marked as read');
              } catch (e) {
                toast.error(errMsg(e));
              }
            }}
          >
            <CheckCheck className="h-4 w-4" /> Mark all read
          </Button>
        }
      />
      <Card>
        <Toolbar>
          <Select
            aria-label="Type"
            className="w-48"
            value={list.filters.type ?? ''}
            onChange={(e) => list.setFilter('type', e.target.value || undefined)}
          >
            <option value="">All types</option>
            {['LOW_STOCK', 'OUT_OF_STOCK', 'EXPIRING', 'EXPIRED', 'ADJUSTMENT'].map((t) => (
              <option key={t} value={t}>
                {titleCase(t)}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Read state"
            className="w-36"
            value={list.filters.unread ?? ''}
            onChange={(e) => list.setFilter('unread', e.target.value || undefined)}
          >
            <option value="">All</option>
            <option value="true">Unread</option>
          </Select>
        </Toolbar>
        {list.isLoading ? (
          <LoadingRows />
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={list.refetch} />
        ) : list.rows.length === 0 ? (
          <EmptyState title="You're all caught up" description="No active alerts right now." />
        ) : (
          <ul className="divide-y">
            {list.rows.map((n) => {
              const Icon = icon[n.severity];
              return (
                <li key={n._id}>
                  <button
                    onClick={() => open(n)}
                    className={cn(
                      'flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface/60',
                      !n.read && 'bg-primary-soft/30',
                    )}
                  >
                    <span className={cn('mt-0.5 rounded-full p-1.5', tone[n.severity])}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className={cn('text-sm', !n.read && 'font-semibold')}>{n.title}</span>
                        {!n.read && <span className="h-2 w-2 rounded-full bg-primary" aria-label="Unread" />}
                      </span>
                      {n.message && <span className="block text-sm text-muted-foreground">{n.message}</span>}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{dateTime(n.createdAt)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {list.meta.pages !== undefined && <Pagination meta={list.meta} onPage={list.setPage} />}
      </Card>
    </>
  );
}
