import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Minus, PackageX, Pause, Percent, Plus, Search, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, Spinner } from '@/components/shared/states';
import { Button } from '@/components/ui/button';
import { Badge, Kbd } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/form';
import { useDebounced } from '@/hooks/useDebounced';
import { ApiError, errMsg, get, send } from '@/lib/api';
import { money, qty as fmtQty } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useCan } from '@/stores/auth';
import type { Named, Shift } from '@/types';
import { CustomerChip, CustomerDialog, DiscountDialog, HeldDialog, OpenShiftDialog } from './dialogs';
import { PaymentDialog } from './PaymentDialog';
import { cartPayload, usePos, type CartLine, type ScannableProduct } from './store';

interface Calc {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  orderDiscountNote?: string;
  taxBreakdown: { code: string; rateBps: number; taxCents: number }[];
  lines: {
    key: string;
    totalCents: number;
    lineDiscountCents: number;
    orderDiscountShareCents: number;
    note?: string;
    unitPriceCents: number;
  }[];
}
type PosProduct = ScannableProduct & {
  _id: string;
  categoryName?: string;
  imageUrl?: string;
  trackExpiry?: boolean;
};

export function PosPage() {
  const qc = useQueryClient();
  const {
    lines,
    customer,
    orderDiscount,
    heldId,
    add,
    setQty,
    remove,
    setDiscount,
    setOrderDiscount,
    clear,
  } = usePos();
  const canOverride = useCan('discount.override');
  const barcodeRef = useRef<HTMLInputElement>(null);
  const [scan, setScan] = useState('');
  const [category, setCategory] = useState<string | undefined>();
  const [payTotal, setPayTotal] = useState<number | null>(null); // total frozen when the payment dialog opens
  const payOpen = payTotal !== null;
  const [heldOpen, setHeldOpen] = useState(false);
  const [custOpen, setCustOpen] = useState(false);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [discountFor, setDiscountFor] = useState<string | 'order' | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const dq = useDebounced(scan, 250);

  const shift = useQuery({
    queryKey: ['shift'],
    queryFn: () => get<(Shift & { register: Named }) | null>('/cash-registers/shifts/current'),
  });
  const cats = useQuery({
    queryKey: ['categories-all'],
    queryFn: () => get<Named[]>('/categories', { all: 'true', active: 'true' }),
    staleTime: 5 * 60_000,
  });
  const products = useQuery({
    queryKey: ['pos-products', dq, category],
    queryFn: () => get<PosProduct[]>('/products/pos', { q: dq || undefined, category, limit: 36 }),
    placeholderData: (prev) => prev,
  });

  const payload = useMemo(() => cartPayload(lines, orderDiscount), [lines, orderDiscount]);
  const calc = useQuery({
    queryKey: ['pos-calc', payload],
    queryFn: () => send<Calc>('post', '/sales/calculate', payload),
    enabled: lines.length > 0,
    retry: false,
    placeholderData: (prev) => prev,
  });
  const totals = lines.length ? calc.data?.data : undefined;
  const calcError = lines.length ? (calc.error as ApiError | null) : null;

  // ---- cart actions ----
  const focusScan = useCallback(() => {
    barcodeRef.current?.focus();
    barcodeRef.current?.select();
  }, []);
  useEffect(focusScan, [focusScan]);

  const addProduct = useCallback(
    (p: PosProduct) => {
      if (p.onHandMilli <= 0) {
        toast.warning(`${p.name} is out of stock`);
        return;
      }
      add(p);
      setScanError(null);
    },
    [add],
  );

  const scanSubmit = async () => {
    const code = scan.trim();
    if (!code) return;
    try {
      const r = await get<PosProduct>(`/products/barcode/${encodeURIComponent(code)}`);
      addProduct({ ...r.data, _id: r.data._id ?? (r.data as unknown as { id: string }).id });
      setScan('');
    } catch (e) {
      if ((e as ApiError).status === 404) {
        const first = products.data?.data.length === 1 ? products.data.data[0] : undefined;
        if (first) {
          addProduct(first);
          setScan('');
        } else setScanError(`No product matches “${code}”`);
      } else setScanError(errMsg(e));
    }
    focusScan();
  };

  const hold = useMutation({
    mutationFn: () =>
      send('post', '/sales/held', {
        label: customer?.name,
        customer: customer?._id,
        cart: { lines, customer },
      }),
    onSuccess: async () => {
      if (heldId) {
        try {
          await send('delete', `/sales/held/${heldId}`);
        } catch {
          /* already gone */
        }
      }
      clear();
      qc.invalidateQueries({ queryKey: ['held'] });
      toast.success('Sale put on hold');
      focusScan();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const hasShift = !!shift.data?.data;
  const canPay =
    lines.length > 0 &&
    !!totals &&
    !calcError &&
    hasShift &&
    !calc.isFetching &&
    lines.every((l) => l.quantity > 0);
  const openPayment = useCallback(() => {
    if (canPay && totals) setPayTotal(totals.totalCents);
    else if (!hasShift) toast.error('Open a cash shift first');
  }, [canPay, hasShift, totals]);

  // Keyboard shortcuts: only function keys, so normal typing in inputs is never intercepted.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const map: Record<string, () => void> = {
        F2: focusScan,
        F4: openPayment,
        F8: () => {
          if (lines.length) hold.mutate();
        },
        F9: () => setHeldOpen(true),
      };
      const fn = map[e.key];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusScan, openPayment, lines.length, hold]);

  // keep scanner focus when dialogs close
  const anyDialog = payOpen || heldOpen || custOpen || shiftOpen || clearOpen || discountFor !== null;
  useEffect(() => {
    if (!anyDialog) setTimeout(focusScan, 50);
  }, [anyDialog, focusScan]);

  const lineCalc = (l: CartLine) => totals?.lines.find((x) => x.key === l.product);
  const discountLine = lines.find((l) => l.product === discountFor);

  return (
    <div className="grid h-[calc(100vh-5.25rem)] min-h-[560px] gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_340px]">
      {/* ---------- LEFT: search + products ---------- */}
      <section className="flex min-h-0 flex-col rounded-lg border bg-background" aria-label="Product search">
        <div className="space-y-2 border-b p-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              ref={barcodeRef}
              aria-label="Scan barcode or search products"
              placeholder="Scan barcode or search name / SKU…"
              className="h-12 pl-9 text-base"
              value={scan}
              autoComplete="off"
              onChange={(e) => {
                setScan(e.target.value);
                setScanError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void scanSubmit();
                }
                if (e.key === 'Escape') setScan('');
              }}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2">
              <Kbd>F2</Kbd>
            </span>
          </div>
          {scanError && (
            <p role="alert" className="flex items-center gap-1.5 text-sm text-danger">
              <AlertTriangle className="h-4 w-4" />
              {scanError}
            </p>
          )}
          <div
            className="flex gap-1.5 overflow-x-auto pb-1 scroll-thin"
            role="toolbar"
            aria-label="Categories"
          >
            <button
              className={cn(
                'shrink-0 rounded-full border px-3 py-1 text-xs font-medium',
                !category ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-surface',
              )}
              onClick={() => setCategory(undefined)}
            >
              All
            </button>
            {cats.data?.data.map((c) => (
              <button
                key={c._id}
                className={cn(
                  'shrink-0 rounded-full border px-3 py-1 text-xs font-medium',
                  category === c._id
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'hover:bg-surface',
                )}
                onClick={() => setCategory(category === c._id ? undefined : c._id)}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 scroll-thin">
          {products.isLoading ? (
            <Spinner />
          ) : products.error ? (
            <EmptyState title="Could not load products" description={errMsg(products.error)} />
          ) : products.data?.data.length === 0 ? (
            <EmptyState
              title="No products found"
              description="Try a different name, SKU or category."
              icon={<PackageX className="h-6 w-6" />}
            />
          ) : (
            <ul className="grid grid-cols-2 gap-2 xl:grid-cols-3">
              {products.data?.data.map((p) => {
                const out = p.onHandMilli <= 0;
                return (
                  <li key={p._id}>
                    <button
                      onClick={() => addProduct(p)}
                      disabled={out}
                      aria-label={`Add ${p.name}, ${money(p.priceCents)}, ${fmtQty(p.onHandMilli)} in stock`}
                      className={cn(
                        'flex h-full w-full flex-col justify-between rounded-md border p-2.5 text-left transition-colors hover:border-primary hover:bg-primary-soft/40 disabled:cursor-not-allowed disabled:opacity-50',
                      )}
                    >
                      {p.imageUrl ? (
                        <img
                          src={p.imageUrl}
                          alt=""
                          loading="lazy"
                          className="mb-2 h-16 w-full rounded object-cover"
                        />
                      ) : null}
                      <span className="line-clamp-2 text-sm font-medium leading-snug">{p.name}</span>
                      <span className="mt-2 flex items-end justify-between gap-1">
                        <span className="text-sm font-semibold tabular text-primary">
                          {money(p.priceCents)}
                        </span>
                        <span
                          className={cn(
                            'text-[11px] tabular',
                            out
                              ? 'text-danger'
                              : p.onHandMilli < 5000
                                ? 'text-warning'
                                : 'text-muted-foreground',
                          )}
                        >
                          {out ? 'Out' : `${fmtQty(p.onHandMilli)} ${p.unitSymbol ?? ''}`}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* ---------- CENTER: cart ---------- */}
      <section className="flex min-h-0 flex-col rounded-lg border bg-background" aria-label="Cart">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Current sale</h2>
            {lines.length > 0 && (
              <Badge>
                {lines.length} item{lines.length > 1 ? 's' : ''}
              </Badge>
            )}
            {heldId && <Badge tone="warning">Resumed</Badge>}
          </div>
          <CustomerChip name={customer?.name} onClick={() => setCustOpen(true)} />
        </div>
        {!shift.isLoading && !hasShift && (
          <div
            role="alert"
            className="flex items-center justify-between gap-2 bg-warning-soft px-3 py-2 text-sm text-warning"
          >
            <span>No open cash shift. Open one to start selling.</span>
            <Button size="sm" onClick={() => setShiftOpen(true)}>
              Open shift
            </Button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
          {lines.length === 0 ? (
            <EmptyState title="Cart is empty" description="Scan a barcode or tap a product to begin." />
          ) : (
            <ul className="divide-y">
              {lines.map((l) => {
                const c = lineCalc(l);
                const over = l.quantity * 1000 > l.stockMilli;
                return (
                  <li key={l.product} className="px-3 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{l.name}</p>
                        <p className="text-xs text-muted-foreground tabular">
                          {l.sku} · {money(c?.unitPriceCents ?? l.priceCents)} / {l.unitSymbol}
                        </p>
                        {c && c.lineDiscountCents > 0 && (
                          <p className="text-xs text-success">
                            {c.note ?? 'Discount'} −{money(c.lineDiscountCents)}
                          </p>
                        )}
                        {over && <p className="text-xs text-danger">Only {fmtQty(l.stockMilli)} in stock</p>}
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold tabular">{c ? money(c.totalCents) : '…'}</p>
                      </div>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={`Decrease ${l.name}`}
                          onClick={() =>
                            l.quantity <= 1 && l.decimals === 0
                              ? remove(l.product)
                              : setQty(
                                  l.product,
                                  Math.max(l.decimals ? 0.1 : 1, Math.round((l.quantity - 1) * 1000) / 1000),
                                )
                          }
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </Button>
                        <Input
                          aria-label={`Quantity for ${l.name}`}
                          inputMode="decimal"
                          className="h-8 w-16 px-1 text-center tabular"
                          value={l.quantity}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            if (Number.isFinite(v) && v >= 0)
                              setQty(l.product, l.decimals === 0 ? Math.floor(v) : v);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') focusScan();
                          }}
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={`Increase ${l.name}`}
                          onClick={() => setQty(l.product, Math.round((l.quantity + 1) * 1000) / 1000)}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setDiscountFor(l.product)}>
                          <Percent className="h-3.5 w-3.5" />
                          {l.discount ? 'Edit' : 'Discount'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-danger"
                          aria-label={`Remove ${l.name}`}
                          onClick={() => remove(l.product)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* ---------- RIGHT: summary + checkout ---------- */}
      <section
        className="flex min-h-0 flex-col rounded-lg border bg-background md:col-span-2 lg:col-span-1"
        aria-label="Order summary"
      >
        <div className="space-y-2.5 border-b p-4 text-sm tabular">
          <h2 className="text-sm font-semibold">Order summary</h2>
          <Line label="Subtotal" value={totals ? money(totals.subtotalCents) : '—'} />
          <Line
            label="Discounts"
            value={totals ? `−${money(totals.discountCents)}` : '—'}
            tone={totals?.discountCents ? 'success' : undefined}
          />
          {totals?.taxBreakdown.map((t) => (
            <Line
              key={t.code + t.rateBps}
              label={`${t.code || 'Tax'} ${(t.rateBps / 100).toFixed(2)}%`}
              value={money(t.taxCents)}
            />
          ))}
          {totals && totals.taxBreakdown.length === 0 && <Line label="Tax" value={money(0)} />}
          <div className="flex items-baseline justify-between border-t pt-3">
            <span className="font-semibold">Total</span>
            <span className="text-3xl font-semibold text-primary" data-testid="grand-total">
              {totals ? money(totals.totalCents) : money(0)}
            </span>
          </div>
          {calcError && (
            <p role="alert" className="rounded-md bg-danger-soft px-2.5 py-2 text-xs text-danger">
              {calcError.message}
            </p>
          )}
          {totals?.orderDiscountNote && <p className="text-xs text-success">{totals.orderDiscountNote}</p>}
        </div>
        <div className="mt-auto space-y-2 p-4">
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" disabled={!lines.length} onClick={() => setDiscountFor('order')}>
              <Percent className="h-4 w-4" />
              {orderDiscount ? 'Edit discount' : 'Order discount'}
            </Button>
            <Button
              variant="outline"
              disabled={!lines.length}
              loading={hold.isPending}
              onClick={() => hold.mutate()}
            >
              <Pause className="h-4 w-4" />
              Hold <Kbd>F8</Kbd>
            </Button>
            <Button variant="outline" onClick={() => setHeldOpen(true)}>
              Resume <Kbd>F9</Kbd>
            </Button>
            <Button
              variant="ghost"
              className="text-danger"
              disabled={!lines.length}
              onClick={() => setClearOpen(true)}
            >
              <X className="h-4 w-4" />
              Clear
            </Button>
          </div>
          {!canOverride && (
            <p className="text-[11px] text-muted-foreground">Large discounts need a manager override.</p>
          )}
          <Button
            size="lg"
            variant="success"
            className="h-14 w-full text-lg"
            disabled={!canPay}
            onClick={openPayment}
          >
            Pay {totals ? money(totals.totalCents) : ''} <Kbd>F4</Kbd>
          </Button>
        </div>
      </section>

      {payTotal !== null && (
        <PaymentDialog
          open
          onOpenChange={(o) => !o && setPayTotal(null)}
          totalCents={payTotal}
          expectedTotalCents={payTotal}
        />
      )}
      <HeldDialog open={heldOpen} onOpenChange={setHeldOpen} />
      <CustomerDialog open={custOpen} onOpenChange={setCustOpen} />
      <OpenShiftDialog open={shiftOpen} onOpenChange={setShiftOpen} />
      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title="Clear this sale?"
        description="All items will be removed from the cart. Nothing has been charged or deducted from stock."
        confirmLabel="Clear cart"
        onConfirm={() => {
          clear();
          setClearOpen(false);
        }}
      />
      {discountFor && (
        <DiscountDialog
          open
          onOpenChange={(o) => !o && setDiscountFor(null)}
          title={discountFor === 'order' ? 'Order discount' : `Discount: ${discountLine?.name}`}
          initial={discountFor === 'order' ? orderDiscount : discountLine?.discount}
          onApply={(d) => (discountFor === 'order' ? setOrderDiscount(d) : setDiscount(discountFor, d))}
        />
      )}
    </div>
  );
}

const Line = ({ label, value, tone }: { label: string; value: string; tone?: 'success' }) => (
  <div className="flex justify-between">
    <span className="text-muted-foreground">{label}</span>
    <span className={cn(tone === 'success' && 'text-success')}>{value}</span>
  </div>
);
