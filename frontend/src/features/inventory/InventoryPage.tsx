import * as Tabs from '@radix-ui/react-tabs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { PageHeader, SearchInput, StatCard, Toolbar } from '@/components/shared/bits';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { useList } from '@/hooks/useList';
import { download, errMsg, get, send } from '@/lib/api';
import { dateStr, dateTime, money, qty, titleCase, toCents } from '@/lib/format';
import { useCan } from '@/stores/auth';
import type { Product } from '@/types';
import { StatusBadgeTone } from '@/components/shared/bits';
import { stockBadge } from '../products/ProductsPage';

export function InventoryPage() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? 'stock';
  return (
    <>
      <PageHeader title="Inventory" description="Stock levels, movements, batches and expiry." />
      <ValuationStrip />
      <Tabs.Root value={tab} onValueChange={(v) => setSp({ tab: v })}>
        <Tabs.List className="mb-4 flex gap-1 overflow-x-auto border-b" aria-label="Inventory sections">
          {[
            ['stock', 'Stock overview'],
            ['movements', 'Movement history'],
            ['batches', 'Batches & expiry'],
            ['low', 'Low stock'],
          ].map(([v, l]) => (
            <Tabs.Trigger
              key={v}
              value={v}
              className="-mb-px shrink-0 border-b-2 border-transparent px-4 py-2 text-sm font-medium text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-primary"
            >
              {l}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="stock">
          <StockTab />
        </Tabs.Content>
        <Tabs.Content value="movements">
          <MovementsTab initialProduct={sp.get('product') ?? undefined} />
        </Tabs.Content>
        <Tabs.Content value="batches">
          <BatchesTab />
        </Tabs.Content>
        <Tabs.Content value="low">
          <StockTab fixedStock="low" />
        </Tabs.Content>
      </Tabs.Root>
    </>
  );
}

function ValuationStrip() {
  const v = useQuery({
    queryKey: ['valuation'],
    queryFn: () =>
      get<{ totals: { costValueCents: number; retailValueCents: number; items: number } }>(
        '/inventory/valuation',
      ),
  });
  const t = v.data?.data.totals;
  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-3">
      <StatCard label="Stocked products" value={t?.items ?? '—'} />
      <StatCard
        label="Inventory value (cost)"
        value={t ? money(t.costValueCents) : '—'}
        hint="Moving weighted-average cost"
      />
      <StatCard
        label="Inventory value (retail)"
        value={t ? money(t.retailValueCents) : '—'}
        hint="At current selling prices"
      />
    </div>
  );
}

function StockTab({ fixedStock }: { fixedStock?: string }) {
  const nav = useNavigate();
  const canAdjust = useCan('inventory.adjust');
  const list = useList<Product>('inventory', '/inventory', {
    sort: 'name',
    filters: { stock: fixedStock, status: 'ACTIVE' },
  });
  const [adjust, setAdjust] = useState<Product | null>(null);
  const cols: Column<Product>[] = [
    {
      key: 'p',
      header: 'Product',
      sortKey: 'name',
      cell: (p) => (
        <div>
          <p className="font-medium">{p.name}</p>
          <p className="text-xs text-muted-foreground">
            {p.sku} · {p.categoryName}
          </p>
        </div>
      ),
    },
    {
      key: 'q',
      header: 'On hand',
      sortKey: 'onHandMilli',
      align: 'right',
      cell: (p) => `${qty(p.onHandMilli)} ${p.unitSymbol ?? ''}`,
    },
    { key: 'r', header: 'Reorder at', align: 'right', cell: (p) => qty(p.reorderLevelMilli) },
    {
      key: 'v',
      header: 'Value (cost)',
      align: 'right',
      cell: (p) => money(Math.round((p.onHandMilli * p.costCents) / 1000)),
    },
    { key: 's', header: 'Status', cell: stockBadge },
    ...(canAdjust
      ? [
          {
            key: 'a',
            header: '',
            align: 'right' as const,
            cell: (p: Product) => (
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  setAdjust(p);
                }}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" /> Adjust
              </Button>
            ),
          },
        ]
      : []),
  ];
  return (
    <Card>
      <Toolbar>
        <SearchInput
          className="w-full sm:w-72"
          value={list.q}
          onChange={list.setQ}
          placeholder="Search name, SKU, barcode"
        />
        {!fixedStock && (
          <Select
            aria-label="Stock status"
            className="w-40"
            value={list.filters.stock ?? ''}
            onChange={(e) => list.setFilter('stock', e.target.value || undefined)}
          >
            <option value="">All stock</option>
            <option value="in">In stock</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
          </Select>
        )}
        {fixedStock && (
          <Button
            variant="outline"
            className="ml-auto"
            onClick={() =>
              download('/reports/inventory', { format: 'csv' }, 'low-stock.csv').catch((e) =>
                toast.error(errMsg(e)),
              )
            }
          >
            <Download className="h-4 w-4" /> Export
          </Button>
        )}
      </Toolbar>
      <DataTable
        columns={cols}
        rows={list.rows}
        loading={list.isLoading}
        error={list.error}
        onRetry={list.refetch}
        meta={list.meta}
        onPage={list.setPage}
        sort={list.sort}
        onSort={list.setSort}
        fetching={list.isFetching}
        rowKey={(p) => p._id ?? p.id}
        onRowClick={(p) => nav(`/products/${p._id ?? p.id}`)}
        emptyTitle={fixedStock ? 'Nothing is running low' : 'No products found'}
      />
      {adjust && <AdjustDialog product={adjust} onClose={() => setAdjust(null)} />}
    </Card>
  );
}

const TYPES = [
  ['ADJUSTMENT_IN', 'Stock in (found / correction)'],
  ['ADJUSTMENT_OUT', 'Stock out (correction)'],
  ['DAMAGED', 'Damaged'],
  ['EXPIRED', 'Expired write-off'],
] as const;

function AdjustDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  const qc = useQueryClient();
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<{
    type: string;
    quantity: string;
    reason: string;
    batchNo: string;
    expiryDate: string;
    batch: string;
    cost: string;
  }>({
    defaultValues: {
      type: 'DAMAGED',
      quantity: '',
      reason: '',
      batchNo: '',
      expiryDate: '',
      batch: '',
      cost: '',
    },
  });
  const type = watch('type');
  const batches = useQuery({
    queryKey: ['batches', product._id],
    queryFn: () =>
      get<{ _id: string; batchNo: string; expiryDate?: string; remainingMilli: number }[]>(
        '/inventory/batches',
        { product: product._id ?? product.id, limit: 50 },
      ),
    enabled: product.trackExpiry,
  });
  const m = useMutation({
    mutationFn: (v: Record<string, unknown>) => send('post', '/inventory/adjust', v),
    onSuccess: () => {
      toast.success('Stock adjusted');
      ['inventory', 'valuation', 'movements', 'products', 'batches'].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
      onClose();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Stock adjustment"
        description={`${product.name} · on hand ${qty(product.onHandMilli)} ${product.unitSymbol ?? ''}`}
        size="md"
      >
        <form
          noValidate
          className="space-y-4"
          onSubmit={handleSubmit((v) => {
            const n = Number(v.quantity);
            if (!(n > 0)) return toast.error('Enter a quantity greater than zero');
            if (v.reason.trim().length < 3) return toast.error('A reason is required');
            const cents = v.cost ? toCents(v.cost) : undefined;
            m.mutate({
              product: product._id ?? product.id,
              type: v.type,
              quantity: n,
              reason: v.reason.trim(),
              ...(v.batch ? { batch: v.batch } : {}),
              ...(v.batchNo ? { batchNo: v.batchNo } : {}),
              ...(v.expiryDate ? { expiryDate: new Date(v.expiryDate).toISOString() } : {}),
              ...(cents !== undefined && Number.isFinite(cents) ? { costCents: cents } : {}),
            });
          })}
        >
          <Field label="Adjustment type">
            <Select {...register('type')}>
              {TYPES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`Quantity (${product.unitSymbol ?? 'units'})`} error={errors.quantity?.message}>
            <Input inputMode="decimal" autoFocus {...register('quantity')} />
          </Field>
          {product.trackExpiry && type === 'ADJUSTMENT_IN' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Batch no.">
                <Input {...register('batchNo')} />
              </Field>
              <Field label="Expiry date" hint="Required for this product">
                <Input type="date" {...register('expiryDate')} />
              </Field>
            </div>
          )}
          {product.trackExpiry && type !== 'ADJUSTMENT_IN' && (
            <Field
              label="Batch"
              hint={type === 'EXPIRED' ? 'Required' : 'Optional. Defaults to earliest expiry first.'}
            >
              <Select {...register('batch')}>
                <option value="">{type === 'EXPIRED' ? 'Select batch…' : 'Auto (FEFO)'}</option>
                {batches.data?.data.map((b) => (
                  <option key={b._id} value={b._id}>
                    {b.batchNo} · {qty(b.remainingMilli)} left
                    {b.expiryDate ? ` · exp ${dateStr(b.expiryDate)}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {type === 'ADJUSTMENT_IN' && (
            <Field label="Unit cost (Rs.)" hint="Optional. Updates the average cost.">
              <Input inputMode="decimal" {...register('cost')} />
            </Field>
          )}
          <Field label="Reason" error={errors.reason?.message}>
            <Textarea {...register('reason')} placeholder="e.g. Dropped during stocking" />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={m.isPending}>
              Record adjustment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface Mv {
  _id: string;
  type: string;
  qtyMilli: number;
  balanceAfterMilli: number;
  createdAt: string;
  refNo?: string;
  reason?: string;
  product: { _id: string; name: string; sku: string };
  actor?: { name: string };
  batch?: { batchNo: string };
}
function MovementsTab({ initialProduct }: { initialProduct?: string }) {
  const list = useList<Mv>('movements', '/inventory/movements', {
    limit: 25,
    filters: { product: initialProduct },
  });
  const cols: Column<Mv>[] = [
    { key: 'd', header: 'When', cell: (m) => dateTime(m.createdAt) },
    {
      key: 'p',
      header: 'Product',
      cell: (m) => (
        <div>
          <p className="font-medium">{m.product?.name}</p>
          <p className="text-xs text-muted-foreground">{m.product?.sku}</p>
        </div>
      ),
    },
    {
      key: 't',
      header: 'Type',
      cell: (m) => <Badge tone={m.qtyMilli > 0 ? 'success' : 'warning'}>{titleCase(m.type)}</Badge>,
    },
    {
      key: 'q',
      header: 'Qty',
      align: 'right',
      cell: (m) => `${m.qtyMilli > 0 ? '+' : ''}${qty(m.qtyMilli)}`,
    },
    { key: 'b', header: 'Balance', align: 'right', cell: (m) => qty(m.balanceAfterMilli) },
    { key: 'bt', header: 'Batch', cell: (m) => m.batch?.batchNo ?? '—' },
    { key: 'r', header: 'Reference / reason', cell: (m) => m.refNo ?? m.reason ?? '—' },
    { key: 'a', header: 'By', cell: (m) => m.actor?.name },
  ];
  return (
    <Card>
      <Toolbar>
        <Select
          aria-label="Movement type"
          className="w-48"
          value={list.filters.type ?? ''}
          onChange={(e) => list.setFilter('type', e.target.value || undefined)}
        >
          <option value="">All movement types</option>
          {[
            'PURCHASE_RECEIPT',
            'SALE',
            'SALE_RETURN',
            'PURCHASE_RETURN',
            'ADJUSTMENT_IN',
            'ADJUSTMENT_OUT',
            'DAMAGED',
            'EXPIRED',
          ].map((t) => (
            <option key={t} value={t}>
              {titleCase(t)}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm">
          From{' '}
          <Input
            type="date"
            className="w-40"
            value={list.filters.from ?? ''}
            onChange={(e) => list.setFilter('from', e.target.value || undefined)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          To{' '}
          <Input
            type="date"
            className="w-40"
            value={list.filters.to ?? ''}
            onChange={(e) => list.setFilter('to', e.target.value || undefined)}
          />
        </label>
        {initialProduct && list.filters.product && (
          <Button variant="ghost" size="sm" onClick={() => list.setFilter('product', undefined)}>
            Clear product filter
          </Button>
        )}
        <Button
          variant="outline"
          className="ml-auto"
          onClick={() =>
            download('/inventory/movements/export', list.params, 'stock-movements.csv').catch((e) =>
              toast.error(errMsg(e)),
            )
          }
        >
          <Download className="h-4 w-4" /> Export CSV
        </Button>
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
        rowKey={(m) => m._id}
        emptyTitle="No stock movements"
      />
    </Card>
  );
}

interface Batch {
  _id: string;
  batchNo: string;
  expiryDate?: string;
  remainingMilli: number;
  receivedMilli: number;
  costCents: number;
  status: string;
  product: { _id: string; name: string; sku: string };
}
function BatchesTab() {
  const list = useList<Batch>('batches-all', '/inventory/batches', {
    limit: 25,
    filters: { status: 'active' },
  });
  const cols: Column<Batch>[] = [
    {
      key: 'p',
      header: 'Product',
      cell: (b) => (
        <div>
          <p className="font-medium">{b.product?.name}</p>
          <p className="text-xs text-muted-foreground">{b.product?.sku}</p>
        </div>
      ),
    },
    { key: 'n', header: 'Batch', cell: (b) => b.batchNo },
    { key: 'e', header: 'Expiry', cell: (b) => dateStr(b.expiryDate) },
    {
      key: 'r',
      header: 'Remaining',
      align: 'right',
      cell: (b) => `${qty(b.remainingMilli)} / ${qty(b.receivedMilli)}`,
    },
    { key: 'c', header: 'Unit cost', align: 'right', cell: (b) => money(b.costCents) },
    {
      key: 's',
      header: 'Status',
      cell: (b) => (
        <Badge tone={StatusBadgeTone(b.status)}>{b.status === 'ok' ? 'Fresh' : titleCase(b.status)}</Badge>
      ),
    },
  ];
  return (
    <Card>
      <Toolbar>
        <Select
          aria-label="Batch status"
          className="w-44"
          value={list.filters.status ?? ''}
          onChange={(e) => list.setFilter('status', e.target.value || undefined)}
        >
          <option value="">All with stock</option>
          <option value="active">Sellable</option>
          <option value="expiring">Expiring soon</option>
          <option value="expired">Expired</option>
          <option value="empty">Used up</option>
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
        rowKey={(b) => b._id}
        emptyTitle="No batches"
        emptyDescription="Batches are created when expiry-tracked products are received."
      />
    </Card>
  );
}
