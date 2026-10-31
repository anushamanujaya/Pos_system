import * as Tabs from '@radix-ui/react-tabs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { PageHeader, SearchInput, Toolbar } from '@/components/shared/bits';
import { Loadable } from '@/components/shared/states';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { useList } from '@/hooks/useList';
import { useSave } from '@/hooks/useSave';
import { api, errMsg, get } from '@/lib/api';
import { centsToInput, dateStr, dateTime, money, toCents } from '@/lib/format';
import { useCan } from '@/stores/auth';
import type { Named, Promotion, Settings, TaxRate } from '@/types';

export function SettingsPage() {
  const canAudit = useCan('audit.read');
  return (
    <>
      <PageHeader
        title="Settings"
        description="Store details, tax, receipts, stock and checkout policy."
        actions={
          canAudit && (
            <Button asChild variant="outline">
              <Link to="/audit">Audit log</Link>
            </Button>
          )
        }
      />
      <Tabs.Root defaultValue="store">
        <Tabs.List className="mb-4 flex gap-1 overflow-x-auto border-b" aria-label="Settings sections">
          {[
            ['store', 'Store & receipts'],
            ['tax', 'Tax'],
            ['policy', 'Stock & checkout'],
            ['promos', 'Promotions'],
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
        <SettingsForms />
        <Tabs.Content value="promos">
          <PromotionsPanel />
        </Tabs.Content>
      </Tabs.Root>
    </>
  );
}

function SettingsForms() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => get<Settings>('/settings') });
  const [s, setS] = useState<Settings | null>(null);
  const [rates, setRates] = useState<{ code: string; name: string; rate: string }[]>([]);
  const logo = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const d = q.data?.data;
    if (d) {
      setS(d);
      setRates(d.taxRates.map((t) => ({ code: t.code, name: t.name, rate: String(t.rateBps / 100) })));
    }
  }, [q.data]);
  const save = useSave<unknown>({
    method: 'put',
    url: '/settings',
    invalidate: ['settings'],
    success: 'Settings saved',
  });
  if (!s)
    return (
      <Loadable loading={q.isLoading} error={q.error} onRetry={q.refetch}>
        {null}
      </Loadable>
    );
  const set = <K extends keyof Settings>(k: K, v: Partial<Settings[K]>) =>
    setS({ ...s, [k]: typeof s[k] === 'object' ? { ...(s[k] as object), ...v } : v } as Settings);
  const pct = (bps: number) => String(bps / 100);
  const bps = (v: string) => Math.round(Number(v) * 100);

  const saveStore = () =>
    save.mutate({
      store: {
        name: s.store.name,
        address: s.store.address,
        phone: s.store.phone,
        email: s.store.email,
        taxId: s.store.taxId,
      },
      timezone: s.timezone,
      receipt: s.receipt,
      currency: s.currency,
    });
  const saveTax = () => {
    const parsed: TaxRate[] = rates.map((r) => ({
      code: r.code.trim(),
      name: r.name.trim(),
      rateBps: bps(r.rate),
    }));
    if (
      parsed.some(
        (r) => !r.code || !r.name || !Number.isFinite(r.rateBps) || r.rateBps < 0 || r.rateBps > 10000,
      )
    )
      return toast.error('Each tax needs a code, a name and a rate between 0 and 100');
    save.mutate({ taxRates: parsed, priceIncludesTax: s.priceIncludesTax });
  };
  const savePolicy = () => save.mutate({ stock: s.stock, discounts: s.discounts, checkout: s.checkout });

  return (
    <>
      <Tabs.Content value="store" className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Store details</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <Field label="Store name">
              <Input value={s.store.name} onChange={(e) => set('store', { name: e.target.value })} />
            </Field>
            <Field label="Address">
              <Input value={s.store.address} onChange={(e) => set('store', { address: e.target.value })} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Phone">
                <Input value={s.store.phone} onChange={(e) => set('store', { phone: e.target.value })} />
              </Field>
              <Field label="Email">
                <Input value={s.store.email} onChange={(e) => set('store', { email: e.target.value })} />
              </Field>
            </div>
            <Field label="Tax / business registration no." hint="Printed on receipts if set.">
              <Input value={s.store.taxId} onChange={(e) => set('store', { taxId: e.target.value })} />
            </Field>
            <div className="flex items-center gap-3">
              {s.store.logoUrl ? (
                <img src={s.store.logoUrl} alt="Store logo" className="h-12 w-12 rounded object-contain" />
              ) : (
                <div className="grid h-12 w-12 place-items-center rounded bg-surface text-xs text-muted-foreground">
                  Logo
                </div>
              )}
              <input
                ref={logo}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                aria-label="Store logo"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    const fd = new FormData();
                    fd.append('image', f);
                    await api.post('/settings/logo', fd, {
                      headers: { 'Content-Type': 'multipart/form-data' },
                    });
                    toast.success('Logo updated');
                    qc.invalidateQueries({ queryKey: ['settings'] });
                  } catch (err) {
                    toast.error(errMsg(err));
                  }
                }}
              />
              <Button variant="outline" size="sm" onClick={() => logo.current?.click()}>
                <ImagePlus className="h-4 w-4" /> Upload logo
              </Button>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Receipts, currency & numbering</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <Field label="Receipt footer">
              <Input value={s.receipt.footer} onChange={(e) => set('receipt', { footer: e.target.value })} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Default paper size">
                <Select
                  value={s.receipt.paperSize}
                  onChange={(e) =>
                    set('receipt', { paperSize: e.target.value as Settings['receipt']['paperSize'] })
                  }
                >
                  <option value="58mm">58 mm thermal</option>
                  <option value="80mm">80 mm thermal</option>
                  <option value="A4">A4 invoice</option>
                </Select>
              </Field>
              <Field label="Invoice prefix">
                <Input
                  value={s.receipt.invoicePrefix}
                  onChange={(e) => set('receipt', { invoicePrefix: e.target.value })}
                />
              </Field>
            </div>
            <Field
              label="Number format"
              hint="Tokens: {PREFIX} {YYYY} {MM} {DD} {SEQ:5}. Applies to new sales only."
            >
              <Input
                value={s.receipt.numberFormat}
                onChange={(e) => set('receipt', { numberFormat: e.target.value })}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Currency code">
                <Input
                  maxLength={3}
                  value={s.currency.code}
                  onChange={(e) => set('currency', { code: e.target.value.toUpperCase() })}
                />
              </Field>
              <Field label="Timezone" hint="Used for daily report boundaries.">
                <Input value={s.timezone} onChange={(e) => setS({ ...s, timezone: e.target.value })} />
              </Field>
            </div>
            <Button loading={save.isPending} onClick={saveStore}>
              Save store settings
            </Button>
          </CardBody>
        </Card>
      </Tabs.Content>

      <Tabs.Content value="tax">
        <Card className="max-w-3xl">
          <CardHeader>
            <CardTitle>Tax rates</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
              No tax rate is built in. Enter the rates that apply to your business; the system does not
              certify tax compliance. Products opt in to a rate on their edit page.
            </p>
            <Checkbox
              label="Product prices already include tax"
              checked={s.priceIncludesTax}
              onChange={(e) => setS({ ...s, priceIncludesTax: e.target.checked })}
            />
            {rates.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No tax rates configured — all products are untaxed.
              </p>
            )}
            {rates.map((r, i) => (
              <div key={i} className="grid grid-cols-[6rem_1fr_6rem_2.25rem] items-end gap-2">
                <Field label="Code">
                  <Input
                    value={r.code}
                    onChange={(e) =>
                      setRates(rates.map((x, k) => (k === i ? { ...x, code: e.target.value } : x)))
                    }
                  />
                </Field>
                <Field label="Name">
                  <Input
                    value={r.name}
                    onChange={(e) =>
                      setRates(rates.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))
                    }
                  />
                </Field>
                <Field label="Rate %">
                  <Input
                    inputMode="decimal"
                    value={r.rate}
                    onChange={(e) =>
                      setRates(rates.map((x, k) => (k === i ? { ...x, rate: e.target.value } : x)))
                    }
                  />
                </Field>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove tax rate"
                  onClick={() => setRates(rates.filter((_, k) => k !== i))}
                >
                  <Trash2 className="h-4 w-4 text-danger" />
                </Button>
              </div>
            ))}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setRates([...rates, { code: '', name: '', rate: '0' }])}
              >
                <Plus className="h-4 w-4" /> Add tax rate
              </Button>
              <Button loading={save.isPending} onClick={saveTax}>
                Save tax settings
              </Button>
            </div>
          </CardBody>
        </Card>
      </Tabs.Content>

      <Tabs.Content value="policy" className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Stock</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <Field label="Default low-stock level (units)" hint="Reference default for new products.">
              <Input
                inputMode="decimal"
                value={s.stock.lowStockDefaultMilli / 1000}
                onChange={(e) =>
                  set('stock', { lowStockDefaultMilli: Math.round(Number(e.target.value) * 1000) || 0 })
                }
              />
            </Field>
            <Field label="Expiry alert window (days)">
              <Input
                inputMode="numeric"
                value={s.stock.expiryAlertDays}
                onChange={(e) => set('stock', { expiryAlertDays: Number(e.target.value) || 0 })}
              />
            </Field>
            <Checkbox
              label="Allow selling below zero stock (not recommended)"
              checked={s.stock.allowNegativeStock}
              onChange={(e) => set('stock', { allowNegativeStock: e.target.checked })}
            />
            <Checkbox
              label="Allow selling expired batches (not recommended)"
              checked={s.stock.allowExpiredSales}
              onChange={(e) => set('stock', { allowExpiredSales: e.target.checked })}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Discounts & checkout</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <Field
              label="Cashier discount limit (%)"
              hint="Above this a manager override permission is needed."
            >
              <Input
                inputMode="decimal"
                value={pct(s.discounts.cashierMaxPercentBps)}
                onChange={(e) => set('discounts', { cashierMaxPercentBps: bps(e.target.value) || 0 })}
              />
            </Field>
            <Field label="Absolute maximum discount (%)">
              <Input
                inputMode="decimal"
                value={pct(s.discounts.maxPercentBps)}
                onChange={(e) => set('discounts', { maxPercentBps: bps(e.target.value) || 0 })}
              />
            </Field>
            <Checkbox
              label="Require an open cash shift to sell"
              checked={s.checkout.requireOpenShift}
              onChange={(e) => set('checkout', { requireOpenShift: e.target.checked })}
            />
            <Checkbox
              label="Refunds require manager approval"
              checked={s.checkout.refundRequiresManager}
              onChange={(e) => set('checkout', { refundRequiresManager: e.target.checked })}
            />
            <Field label="Refund window (days)">
              <Input
                inputMode="numeric"
                value={s.checkout.refundWindowDays}
                onChange={(e) => set('checkout', { refundWindowDays: Number(e.target.value) || 0 })}
              />
            </Field>
            <Button loading={save.isPending} onClick={savePolicy}>
              Save policy
            </Button>
          </CardBody>
        </Card>
      </Tabs.Content>
    </>
  );
}

function PromotionsPanel() {
  const q = useQuery({ queryKey: ['promotions'], queryFn: () => get<Promotion[]>('/promotions') });
  const [edit, setEdit] = useState<Promotion | 'new' | null>(null);
  const [del, setDel] = useState<Promotion | null>(null);
  const remove = useSave({
    method: 'delete',
    url: () => `/promotions/${del?._id}`,
    invalidate: ['promotions'],
    success: 'Promotion deleted',
    onDone: () => setDel(null),
  });
  const cols: Column<Promotion>[] = [
    { key: 'n', header: 'Promotion', cell: (p) => <span className="font-medium">{p.name}</span> },
    {
      key: 'v',
      header: 'Discount',
      cell: (p) => (p.type === 'PERCENT' ? `${p.value / 100}%` : money(p.value)),
    },
    {
      key: 's',
      header: 'Applies to',
      cell: (p) =>
        p.scope === 'CART'
          ? `Whole cart${p.minCartCents ? ` ≥ ${money(p.minCartCents)}` : ''}`
          : p.scope === 'PRODUCT'
            ? p.products.map((x) => x.name).join(', ')
            : p.categories.map((x) => x.name).join(', '),
      className: 'max-w-xs truncate',
    },
    {
      key: 'd',
      header: 'Dates',
      cell: (p) => (p.startsAt || p.endsAt ? `${dateStr(p.startsAt)} – ${dateStr(p.endsAt)}` : 'Always'),
    },
    {
      key: 'a',
      header: 'Status',
      cell: (p) => <Badge tone={p.active ? 'success' : 'neutral'}>{p.active ? 'Active' : 'Off'}</Badge>,
    },
    {
      key: 'x',
      header: '',
      align: 'right',
      cell: (p) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="outline" onClick={() => setEdit(p)}>
            Edit
          </Button>
          <Button size="icon" variant="ghost" aria-label={`Delete ${p.name}`} onClick={() => setDel(p)}>
            <Trash2 className="h-4 w-4 text-danger" />
          </Button>
        </div>
      ),
    },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Promotions</CardTitle>
        <Button size="sm" onClick={() => setEdit('new')}>
          <Plus className="h-4 w-4" /> New promotion
        </Button>
      </CardHeader>
      <p className="px-4 pt-3 text-xs text-muted-foreground">
        Overlap rule: for each line the largest saving wins (ties go to higher priority, then oldest). A
        manual cashier discount replaces the automatic one.
      </p>
      <DataTable
        columns={cols}
        rows={q.data?.data ?? []}
        loading={q.isLoading}
        error={q.error}
        onRetry={q.refetch}
        rowKey={(p) => p._id}
        emptyTitle="No promotions"
      />
      {edit && <PromotionDialog promo={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
      <ConfirmDialog
        open={!!del}
        onOpenChange={(o) => !o && setDel(null)}
        title="Delete promotion?"
        description="Past receipts keep the discounts that were applied."
        loading={remove.isPending}
        confirmLabel="Delete"
        onConfirm={() => remove.mutate(undefined)}
      />
    </Card>
  );
}

function PromotionDialog({ promo, onClose }: { promo?: Promotion; onClose: () => void }) {
  const [f, setF] = useState({
    name: promo?.name ?? '',
    type: promo?.type ?? 'PERCENT',
    value: promo ? (promo.type === 'PERCENT' ? String(promo.value / 100) : centsToInput(promo.value)) : '',
    scope: promo?.scope ?? 'PRODUCT',
    products: promo?.products.map((p) => p._id) ?? [],
    categories: promo?.categories.map((c) => c._id) ?? [],
    min: centsToInput(promo?.minCartCents ?? 0),
    startsAt: promo?.startsAt?.slice(0, 10) ?? '',
    endsAt: promo?.endsAt?.slice(0, 10) ?? '',
    priority: String(promo?.priority ?? 0),
    active: promo?.active ?? true,
  });
  const [pq, setPq] = useState('');
  const prods = useQuery({
    queryKey: ['promo-prod', pq],
    queryFn: () =>
      get<{ _id: string; name: string; sku: string }[]>('/products', { q: pq, limit: 6, status: 'ACTIVE' }),
    enabled: pq.length > 1,
  });
  const cats = useQuery({
    queryKey: ['categories-all'],
    queryFn: () => get<Named[]>('/categories', { all: 'true' }),
  });
  const names = useRef(new Map<string, string>(promo?.products.map((p) => [p._id, p.name]) ?? []));
  const save = useSave<unknown>({
    method: promo ? 'put' : 'post',
    url: `/promotions${promo ? `/${promo._id}` : ''}`,
    invalidate: ['promotions'],
    success: 'Promotion saved',
    onDone: onClose,
  });
  const go = () => {
    const value = f.type === 'PERCENT' ? Math.round(Number(f.value) * 100) : toCents(f.value);
    if (!f.name.trim() || !(value > 0)) return toast.error('Enter a name and a discount value');
    save.mutate({
      name: f.name.trim(),
      type: f.type,
      value,
      scope: f.scope,
      products: f.scope === 'PRODUCT' ? f.products : [],
      categories: f.scope === 'CATEGORY' ? f.categories : [],
      minCartCents: toCents(f.min) || 0,
      startsAt: f.startsAt ? new Date(f.startsAt).toISOString() : null,
      endsAt: f.endsAt ? new Date(`${f.endsAt}T23:59:59`).toISOString() : null,
      priority: Number(f.priority) || 0,
      active: f.active,
    });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={promo ? 'Edit promotion' : 'New promotion'} size="lg">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" className="sm:col-span-2">
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Type">
            <Select
              value={f.type}
              onChange={(e) => setF({ ...f, type: e.target.value as 'PERCENT' | 'FIXED' })}
            >
              <option value="PERCENT">Percentage</option>
              <option value="FIXED">Fixed amount off the line / cart</option>
            </Select>
          </Field>
          <Field label={f.type === 'PERCENT' ? 'Percent' : 'Amount (Rs.)'}>
            <Input
              inputMode="decimal"
              value={f.value}
              onChange={(e) => setF({ ...f, value: e.target.value })}
            />
          </Field>
          <Field label="Applies to">
            <Select
              value={f.scope}
              onChange={(e) => setF({ ...f, scope: e.target.value as Promotion['scope'] })}
            >
              <option value="PRODUCT">Specific products</option>
              <option value="CATEGORY">Categories</option>
              <option value="CART">Whole cart</option>
            </Select>
          </Field>
          {f.scope === 'CART' && (
            <Field label="Minimum cart value (Rs.)">
              <Input
                inputMode="decimal"
                value={f.min}
                onChange={(e) => setF({ ...f, min: e.target.value })}
              />
            </Field>
          )}
          {f.scope === 'PRODUCT' && (
            <div className="sm:col-span-2 space-y-2">
              <SearchInput value={pq} onChange={setPq} placeholder="Search products to include" />
              {prods.data?.data.map((p) => (
                <button
                  key={p._id}
                  className="mr-1 rounded-full border px-2.5 py-1 text-xs hover:bg-surface"
                  onClick={() => {
                    names.current.set(p._id, p.name);
                    setF({ ...f, products: [...new Set([...f.products, p._id])] });
                    setPq('');
                  }}
                >
                  + {p.name}
                </button>
              ))}
              <div className="flex flex-wrap gap-1">
                {f.products.map((id) => (
                  <Badge key={id} tone="primary">
                    {names.current.get(id) ?? id.slice(-4)}
                    <button
                      aria-label="Remove"
                      onClick={() => setF({ ...f, products: f.products.filter((x) => x !== id) })}
                    >
                      ×
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {f.scope === 'CATEGORY' && (
            <div className="sm:col-span-2 flex flex-wrap gap-2">
              {cats.data?.data.map((c) => (
                <Checkbox
                  key={c._id}
                  label={c.name}
                  checked={f.categories.includes(c._id)}
                  onChange={(e) =>
                    setF({
                      ...f,
                      categories: e.target.checked
                        ? [...f.categories, c._id]
                        : f.categories.filter((x) => x !== c._id),
                    })
                  }
                />
              ))}
            </div>
          )}
          <Field label="Starts">
            <Input
              type="date"
              value={f.startsAt}
              onChange={(e) => setF({ ...f, startsAt: e.target.value })}
            />
          </Field>
          <Field label="Ends">
            <Input type="date" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} />
          </Field>
          <Field label="Priority" hint="Higher wins ties.">
            <Input
              inputMode="numeric"
              value={f.priority}
              onChange={(e) => setF({ ...f, priority: e.target.value })}
            />
          </Field>
          <Checkbox
            label="Active"
            checked={f.active}
            onChange={(e) => setF({ ...f, active: e.target.checked })}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={go}>
            Save promotion
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface Audit {
  _id: string;
  createdAt: string;
  actorName?: string;
  action: string;
  summary?: string;
  ip?: string;
}
export function AuditLogPage() {
  const list = useList<Audit>('audit', '/audit-logs', { limit: 30 });
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Security-sensitive and financial operations. Entries cannot be edited."
      />
      <Card>
        <Toolbar>
          <SearchInput
            className="w-full sm:w-72"
            value={list.q}
            onChange={list.setQ}
            placeholder="Search summary"
          />
          <Select
            aria-label="Action"
            className="w-44"
            value={list.filters.action ?? ''}
            onChange={(e) => list.setFilter('action', e.target.value || undefined)}
          >
            <option value="">All actions</option>
            {[
              'auth',
              'sale',
              'product',
              'inventory',
              'purchase',
              'employee',
              'shift',
              'settings',
              'cash',
              'promotion',
            ].map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </Toolbar>
        <DataTable
          rows={list.rows}
          loading={list.isLoading}
          error={list.error}
          onRetry={list.refetch}
          meta={list.meta}
          onPage={list.setPage}
          fetching={list.isFetching}
          rowKey={(a) => a._id}
          emptyTitle="No audit entries"
          columns={[
            { key: 'd', header: 'When', cell: (a) => dateTime(a.createdAt) },
            { key: 'u', header: 'User', cell: (a) => a.actorName ?? '—' },
            { key: 'a', header: 'Action', cell: (a) => <Badge>{a.action}</Badge> },
            { key: 's', header: 'Details', cell: (a) => a.summary },
            { key: 'i', header: 'IP', cell: (a) => a.ip },
          ]}
        />
      </Card>
    </>
  );
}
