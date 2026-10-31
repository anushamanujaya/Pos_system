import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CreditCard, Banknote, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/form';
import { ApiError, send } from '@/lib/api';
import { centsToInput, money, toCents } from '@/lib/format';
import type { ReceiptData } from '@/types';
import { ReceiptPreview } from './ReceiptView';
import { cartPayload, usePos } from './store';

interface Tender {
  method: 'CASH' | 'CARD';
  amount: string;
  reference: string;
}

/**
 * Collects tenders and submits the cart. The server recomputes prices, discounts, tax, stock and change;
 * the figures shown here are the server's calculated total and simple integer-cent arithmetic for the tender helper.
 */
export function PaymentDialog({
  open,
  onOpenChange,
  totalCents,
  expectedTotalCents,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  totalCents: number;
  expectedTotalCents: number;
}) {
  const { lines, orderDiscount, customer, heldId, idempotencyKey, clear } = usePos();
  const qc = useQueryClient();
  const [tenders, setTenders] = useState<Tender[]>([
    { method: 'CASH', amount: centsToInput(totalCents), reference: '' },
  ]);
  const [done, setDone] = useState<(ReceiptData & { receiptNo: string; replayed: boolean }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cents = tenders.map((t) => toCents(t.amount || '0'));
  const valid = cents.every((c) => Number.isFinite(c) && c > 0);
  const paid = cents.reduce((a, c) => a + (Number.isFinite(c) ? c : 0), 0);
  const card = tenders.reduce(
    (a, t, i) => a + (t.method === 'CARD' && Number.isFinite(cents[i]) ? cents[i] : 0),
    0,
  );
  const cashIn = paid - card;
  const remaining = totalCents - paid;
  const change = cashIn - (totalCents - card);
  const canPay =
    valid && remaining <= 0 && card <= totalCents && (change <= 0 || cashIn > 0) && change <= cashIn;

  const pay = useMutation({
    mutationFn: () =>
      send<ReceiptData & { receiptNo: string; replayed: boolean }>(
        'post',
        '/sales',
        {
          ...cartPayload(lines, orderDiscount),
          customer: customer?._id,
          heldId: heldId ?? undefined,
          expectedTotalCents,
          payments: tenders.map((t, i) => ({
            method: t.method,
            amountCents: cents[i],
            reference: t.reference || undefined,
          })),
        },
        { 'Idempotency-Key': idempotencyKey },
      ),
    onSuccess: (r) => {
      setDone(r.data);
      clear();
      qc.invalidateQueries({ queryKey: ['pos-products'] });
      qc.invalidateQueries({ queryKey: ['shift'] });
      qc.invalidateQueries({ queryKey: ['held'] });
      toast.success(`Sale ${r.data.receiptNo} completed`);
    },
    onError: (e) => {
      const err = e as ApiError;
      setError(err.message);
      if (err.code === 'INSUFFICIENT_STOCK' || err.code === 'PRICE_CHANGED')
        qc.invalidateQueries({ queryKey: ['pos-calc'] });
    },
  });

  const update = (i: number, patch: Partial<Tender>) =>
    setTenders((ts) => ts.map((t, k) => (k === i ? { ...t, ...patch } : t)));
  const close = (o: boolean) => {
    if (!o) {
      setDone(null);
      setError(null);
      setTenders([{ method: 'CASH', amount: '', reference: '' }]);
    }
    onOpenChange(o);
  };

  if (done) {
    return (
      <Dialog open={open} onOpenChange={close}>
        <DialogContent title="Sale complete" size="md">
          <div className="mb-3 flex items-center gap-3 rounded-md bg-success-soft p-3 text-success">
            <CheckCircle2 className="h-6 w-6" />
            <div>
              <p className="font-semibold">{done.receiptNo}</p>
              <p className="text-sm">
                Total {money(done.sale.totalCents)}
                {done.sale.changeCents > 0 ? ` · Change ${money(done.sale.changeCents)}` : ''}
              </p>
            </div>
          </div>
          <ReceiptPreview data={done} />
          <DialogFooter>
            <Button autoFocus onClick={() => close(false)}>
              New sale
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        title="Payment"
        description="Cash, or a card payment already completed on the external card terminal."
        size="md"
      >
        <div className="mb-4 flex items-baseline justify-between rounded-md bg-primary-soft px-4 py-3">
          <span className="text-sm text-primary">Amount due</span>
          <span className="text-2xl font-semibold tabular text-primary">{money(totalCents)}</span>
        </div>
        {error && (
          <div role="alert" className="mb-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}
        <div className="space-y-2">
          {tenders.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <Select
                className="w-28"
                aria-label="Payment method"
                value={t.method}
                onChange={(e) => update(i, { method: e.target.value as Tender['method'] })}
              >
                <option value="CASH">Cash</option>
                <option value="CARD">Card</option>
              </Select>
              <div className="relative flex-1">
                <Input
                  aria-label={`${t.method === 'CASH' ? 'Amount received' : 'Card amount'}`}
                  inputMode="decimal"
                  className="tabular"
                  autoFocus={i === 0}
                  value={t.amount}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => update(i, { amount: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && canPay && !pay.isPending) pay.mutate();
                  }}
                />
              </div>
              {t.method === 'CARD' && (
                <Input
                  aria-label="Terminal reference"
                  className="w-36"
                  placeholder="Terminal ref."
                  maxLength={60}
                  value={t.reference}
                  onChange={(e) => update(i, { reference: e.target.value })}
                />
              )}
              {tenders.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove payment"
                  onClick={() => setTenders((ts) => ts.filter((_, k) => k !== i))}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            totalCents,
            Math.ceil(totalCents / 100000) * 100000,
            Math.ceil(totalCents / 500000) * 500000,
            Math.ceil(totalCents / 1000000) * 1000000,
          ]
            .filter((v, i, a) => v > 0 && a.indexOf(v) === i)
            .slice(0, 4)
            .map((v) => (
              <Button
                key={v}
                variant="outline"
                size="sm"
                onClick={() => update(0, { method: 'CASH', amount: centsToInput(v) })}
              >
                <Banknote className="h-3.5 w-3.5" />
                {money(v)}
              </Button>
            ))}
          {tenders.length < 4 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setTenders((ts) => [
                  ...ts,
                  { method: 'CARD', amount: remaining > 0 ? centsToInput(remaining) : '', reference: '' },
                ])
              }
            >
              <Plus className="h-3.5 w-3.5" /> Split payment
            </Button>
          )}
        </div>
        <div className="mt-4 space-y-1.5 rounded-md border p-3 text-sm tabular" aria-live="polite">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Received</span>
            <span>{money(paid)}</span>
          </div>
          {remaining > 0 ? (
            <div className="flex justify-between font-medium text-danger">
              <span>Still due</span>
              <span>{money(remaining)}</span>
            </div>
          ) : (
            <div className="flex justify-between text-lg font-semibold text-success">
              <span>Change</span>
              <span>{money(Math.max(0, change))}</span>
            </div>
          )}
          {card > totalCents && <p className="text-xs text-danger">Card amount cannot exceed the total.</p>}
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <CreditCard className="h-3.5 w-3.5" /> Card payments are recorded only; the card terminal is
          operated separately.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            variant="success"
            size="lg"
            disabled={!canPay}
            loading={pay.isPending}
            onClick={() => pay.mutate()}
          >
            Complete sale
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
