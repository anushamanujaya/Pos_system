import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { PageHeader, SearchInput } from '@/components/shared/bits';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { useDebounced } from '@/hooks/useDebounced';
import { useSave } from '@/hooks/useSave';
import { get } from '@/lib/api';
import { centsToInput, money, toCents } from '@/lib/format';
import type { Product, PurchaseOrder, Supplier } from '@/types';

interface Line {
  product: string;
  name: string;
  sku: string;
  unit?: string;
  decimals: number;
  quantity: string;
  cost: string;
}

export function NewPurchasePage() {
  const nav = useNavigate();
  const [supplier, setSupplier] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const suppliers = useQuery({
    queryKey: ['suppliers-all'],
    queryFn: () => get<Supplier[]>('/suppliers', { all: 'true', active: 'true' }),
  });
  const found = useQuery({
    queryKey: ['po-product-search', dq],
    queryFn: () => get<Product[]>('/products', { q: dq, limit: 8, status: 'ACTIVE' }),
    enabled: dq.length > 1,
  });

  const save = useSave<{ submit: boolean }, PurchaseOrder>({
    method: 'post',
    url: '/purchases',
    invalidate: ['purchases'],
    success: 'Purchase order saved',
    onDone: (po) => nav(`/purchases/${po._id}`),
  });
  const submit = (submitNow: boolean) => {
    if (!supplier) return toast.error('Choose a supplier');
    if (lines.length === 0) return toast.error('Add at least one product');
    for (const l of lines) {
      if (!(Number(l.quantity) > 0)) return toast.error(`Enter a quantity for ${l.name}`);
      if (!Number.isFinite(toCents(l.cost))) return toast.error(`Enter a valid cost for ${l.name}`);
    }
    // mutate() takes the whole request body; useSave sends it verbatim
    (save.mutate as (b: unknown) => void)({
      supplier,
      notes: notes || undefined,
      submit: submitNow,
      items: lines.map((l) => ({
        product: l.product,
        quantity: Number(l.quantity),
        costCents: toCents(l.cost),
      })),
    });
  };

  const total = lines.reduce((a, l) => a + Math.round(toCents(l.cost || '0') * Number(l.quantity || 0)), 0);
  const addLine = (p: Product) => {
    if (lines.some((l) => l.product === p._id)) return toast.info('Already on this order');
    setLines([
      ...lines,
      {
        product: p._id,
        name: p.name,
        sku: p.sku,
        unit: p.unitSymbol,
        decimals: p.unitDecimals ?? 0,
        quantity: '1',
        cost: centsToInput(p.costCents),
      },
    ]);
    setQ('');
  };
  const upd = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  return (
    <>
      <PageHeader title="New purchase order" description="Save as a draft, or submit it to the supplier." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Items</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <div className="relative">
              <SearchInput
                value={q}
                onChange={setQ}
                placeholder="Search products to add (name, SKU, barcode)"
              />
              {dq.length > 1 && found.data && (
                <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border bg-background shadow-pop">
                  {found.data.data.length === 0 ? (
                    <li className="px-3 py-2 text-sm text-muted-foreground">No matches</li>
                  ) : (
                    found.data.data.map((p) => (
                      <li key={p._id}>
                        <button
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-surface"
                          onClick={() => addLine(p)}
                        >
                          <span>
                            {p.name} <span className="text-xs text-muted-foreground">{p.sku}</span>
                          </span>
                          <Plus className="h-4 w-4" />
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>
            {lines.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Search above to add products.</p>
            ) : (
              <div className="divide-y rounded-md border">
                {lines.map((l, i) => (
                  <div
                    key={l.product}
                    className="grid grid-cols-[1fr_6rem_7rem_6rem_2rem] items-center gap-2 p-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{l.name}</p>
                      <p className="text-xs text-muted-foreground">{l.sku}</p>
                    </div>
                    <Input
                      aria-label={`Quantity for ${l.name}`}
                      inputMode="decimal"
                      className="h-9"
                      value={l.quantity}
                      onChange={(e) => upd(i, { quantity: e.target.value })}
                    />
                    <Input
                      aria-label={`Unit cost for ${l.name}`}
                      inputMode="decimal"
                      className="h-9"
                      value={l.cost}
                      onChange={(e) => upd(i, { cost: e.target.value })}
                    />
                    <span className="text-right text-sm tabular">
                      {money(Math.round(toCents(l.cost || '0') * Number(l.quantity || 0)))}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={`Remove ${l.name}`}
                      onClick={() => setLines(lines.filter((_, k) => k !== i))}
                    >
                      <Trash2 className="h-4 w-4 text-danger" />
                    </Button>
                  </div>
                ))}
                <div className="flex justify-between bg-surface/60 px-3 py-2.5 text-sm font-semibold">
                  <span>Total</span>
                  <span className="tabular">{money(total)}</span>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Order details</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <Field label="Supplier">
              <Select value={supplier} onChange={(e) => setSupplier(e.target.value)}>
                <option value="">Select…</option>
                {suppliers.data?.data.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Notes">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <div className="flex flex-col gap-2">
              <Button loading={save.isPending} onClick={() => submit(true)}>
                Submit order
              </Button>
              <Button variant="outline" loading={save.isPending} onClick={() => submit(false)}>
                Save as draft
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
