import { Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { PageHeader, SearchInput, StatusBadgeTone, Toolbar } from '@/components/shared/bits';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { useList } from '@/hooks/useList';
import { dateStr, money, titleCase } from '@/lib/format';
import { useCan } from '@/stores/auth';
import type { PurchaseOrder } from '@/types';

export function PurchasesPage() {
  const nav = useNavigate();
  const canManage = useCan('purchases.manage');
  const list = useList<PurchaseOrder>('purchases', '/purchases');
  const cols: Column<PurchaseOrder>[] = [
    { key: 'n', header: 'PO number', cell: (p) => <span className="font-medium">{p.number}</span> },
    { key: 's', header: 'Supplier', cell: (p) => p.supplier?.name },
    { key: 'd', header: 'Created', cell: (p) => dateStr(p.createdAt) },
    { key: 'i', header: 'Lines', align: 'right', cell: (p) => p.items.length },
    { key: 't', header: 'Total', align: 'right', cell: (p) => money(p.totalCents) },
    {
      key: 'st',
      header: 'Status',
      cell: (p) => <Badge tone={StatusBadgeTone(p.status)}>{titleCase(p.status)}</Badge>,
    },
  ];
  return (
    <>
      <PageHeader
        title="Purchase orders"
        description="Order stock from suppliers and receive deliveries."
        actions={
          canManage && (
            <Button asChild>
              <Link to="/purchases/new">
                <Plus className="h-4 w-4" /> New purchase order
              </Link>
            </Button>
          )
        }
      />
      <Card>
        <Toolbar>
          <SearchInput
            className="w-full sm:w-64"
            value={list.q}
            onChange={list.setQ}
            placeholder="Search PO number"
          />
          <Select
            aria-label="Status"
            className="w-48"
            value={list.filters.status ?? ''}
            onChange={(e) => list.setFilter('status', e.target.value || undefined)}
          >
            <option value="">All statuses</option>
            {['DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'].map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </Select>
        </Toolbar>
        <DataTable
          columns={cols}
          rows={list.rows}
          loading={list.isLoading}
          error={list.error}
          onRetry={list.refetch}
          meta={list.meta}
          onPage={list.setPage}
          fetching={list.isFetching}
          rowKey={(p) => p._id}
          onRowClick={(p) => nav(`/purchases/${p._id}`)}
          emptyTitle="No purchase orders yet"
        />
      </Card>
    </>
  );
}
