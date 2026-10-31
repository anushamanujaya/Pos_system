import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause, Trash2, UserRound } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { SearchInput } from '@/components/shared/bits';
import { EmptyState, Spinner } from '@/components/shared/states';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { useDebounced } from '@/hooks/useDebounced';
import { errMsg, get, send } from '@/lib/api';
import { centsToInput, dateTime, toCents } from '@/lib/format';
import type { Customer, Register } from '@/types';
import { usePos, type CartLine, type DiscountInput } from './store';

export function DiscountDialog({
  open,
  onOpenChange,
  title,
  initial,
  onApply,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  initial?: DiscountInput;
  onApply: (d?: DiscountInput) => void;
}) {
  const [type, setType] = useState<'PERCENT' | 'FIXED'>(initial?.type ?? 'PERCENT');
  const [value, setValue] = useState(
    initial
      ? initial.type === 'PERCENT'
        ? String(initial.percent ?? '')
        : centsToInput(initial.amountCents)
      : '',
  );
  const [note, setNote] = useState(initial?.note ?? '');
  const [err, setErr] = useState<string>();
  const apply = () => {
    if (type === 'PERCENT') {
      const p = Number(value);
      if (!(p > 0 && p <= 100)) return setErr('Enter a percentage between 0 and 100');
      onApply({ type, percent: p, note: note || undefined });
    } else {
      const c = toCents(value);
      if (!(c > 0)) return setErr('Enter a valid amount');
      onApply({ type, amountCents: c, note: note || undefined });
    }
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        description="Discounts above your limit are rejected unless a manager has override rights."
        size="sm"
      >
        <div className="space-y-4">
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value as 'PERCENT' | 'FIXED')}>
              <option value="PERCENT">Percentage (%)</option>
              <option value="FIXED">Fixed amount (Rs.)</option>
            </Select>
          </Field>
          <Field label={type === 'PERCENT' ? 'Percent' : 'Amount'} error={err}>
            <Input
              inputMode="decimal"
              autoFocus
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setErr(undefined);
              }}
              onKeyDown={(e) => e.key === 'Enter' && apply()}
            />
          </Field>
          <Field label="Reason (optional)">
            <Input value={note} maxLength={100} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          {initial && (
            <Button
              variant="ghost"
              className="text-danger sm:mr-auto"
              onClick={() => {
                onApply(undefined);
                onOpenChange(false);
              }}
            >
              Remove discount
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={apply}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CustomerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const setCustomer = usePos((s) => s.setCustomer);
  const list = useQuery({
    queryKey: ['pos-customers', dq],
    queryFn: () => get<Customer[]>('/customers', { q: dq || undefined, limit: 8 }),
    enabled: open,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Attach customer"
        description="Optional. Walk-in sales need no customer."
        size="sm"
      >
        <SearchInput value={q} onChange={setQ} placeholder="Name, phone or code" />
        <div className="mt-3 divide-y rounded-md border">
          {list.isLoading ? (
            <Spinner />
          ) : list.data?.data.length === 0 ? (
            <EmptyState title="No customers found" />
          ) : (
            list.data?.data.map((c) => (
              <button
                key={c._id}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-surface"
                onClick={() => {
                  setCustomer({ _id: c._id, name: c.name, code: c.code, phone: c.phone });
                  onOpenChange(false);
                }}
              >
                <span>
                  <span className="font-medium">{c.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {c.code} · {c.phone ?? 'no phone'}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">{c.visitCount} visits</span>
              </button>
            ))
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setCustomer(null);
              onOpenChange(false);
            }}
          >
            Walk-in (no customer)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface Held {
  _id: string;
  label?: string;
  createdAt: string;
  customer?: string;
  cart: { lines: CartLine[]; customer: { _id: string; name: string; code: string } | null };
}

export function HeldDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const load = usePos((s) => s.load);
  const list = useQuery({ queryKey: ['held'], queryFn: () => get<Held[]>('/sales/held'), enabled: open });
  const del = useMutation({
    mutationFn: (id: string) => send('delete', `/sales/held/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['held'] }),
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Suspended sales" description="Resume a sale that was put on hold." size="md">
        {list.isLoading ? (
          <Spinner />
        ) : list.data?.data.length === 0 ? (
          <EmptyState title="No suspended sales" icon={<Pause className="h-6 w-6" />} />
        ) : (
          <ul className="divide-y rounded-md border">
            {list.data?.data.map((h) => (
              <li key={h._id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                <div>
                  <p className="font-medium">{h.label || 'Held sale'}</p>
                  <p className="text-xs text-muted-foreground">
                    {h.cart.lines.length} items · {dateTime(h.createdAt)}
                    {h.cart.customer ? ` · ${h.cart.customer.name}` : ''}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    onClick={() => {
                      load(h.cart.lines, h.cart.customer ?? null, h._id);
                      onOpenChange(false);
                      toast.success('Sale resumed');
                    }}
                  >
                    Resume
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Discard held sale"
                    onClick={() => del.mutate(h._id)}
                  >
                    <Trash2 className="h-4 w-4 text-danger" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function OpenShiftDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [reg, setReg] = useState('');
  const [float, setFloat] = useState('0.00');
  const regs = useQuery({
    queryKey: ['registers'],
    queryFn: () => get<Register[]>('/cash-registers'),
    enabled: open,
  });
  const free = regs.data?.data.filter((r) => r.active && !r.openShift) ?? [];
  const open_ = useMutation({
    mutationFn: () =>
      send('post', `/cash-registers/${reg || free[0]?._id}/open-shift`, {
        openingFloatCents: toCents(float),
      }),
    onSuccess: () => {
      toast.success('Shift opened');
      qc.invalidateQueries({ queryKey: ['shift'] });
      qc.invalidateQueries({ queryKey: ['registers'] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const valid = Number.isFinite(toCents(float)) && free.length > 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Open cash shift"
        description="Count the drawer and enter the opening float."
        size="sm"
      >
        {regs.isLoading ? (
          <Spinner />
        ) : free.length === 0 ? (
          <EmptyState
            title="No free registers"
            description="All registers have an open shift. Ask a manager to add one or close a shift."
          />
        ) : (
          <div className="space-y-4">
            <Field label="Register">
              <Select value={reg || free[0]._id} onChange={(e) => setReg(e.target.value)}>
                {free.map((r) => (
                  <option key={r._id} value={r._id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Opening float (Rs.)"
              error={Number.isFinite(toCents(float)) ? undefined : 'Enter a valid amount'}
            >
              <Input inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value)} />
            </Field>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!valid} loading={open_.isPending} onClick={() => open_.mutate()}>
            Open shift
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const CustomerChip = ({ name, onClick }: { name?: string; onClick: () => void }) => (
  <Button variant="outline" size="sm" onClick={onClick}>
    <UserRound className="h-4 w-4" /> {name ?? 'Walk-in customer'}
  </Button>
);
