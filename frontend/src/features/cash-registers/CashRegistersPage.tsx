import * as Tabs from '@radix-ui/react-tabs';
import { useQuery } from '@tanstack/react-query';
import { Banknote, Plus, PlusCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { DL, PageHeader, StatCard, StatusBadgeTone } from '@/components/shared/bits';
import { Loadable } from '@/components/shared/states';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { useList } from '@/hooks/useList';
import { useSave } from '@/hooks/useSave';
import { get } from '@/lib/api';
import { centsToInput, dateTime, money, titleCase, toCents } from '@/lib/format';
import { useCan } from '@/stores/auth';
import type { Named, Register, Shift, ShiftSummary } from '@/types';
import { OpenShiftDialog } from '../pos/dialogs';

const nm = (x: string | Named) => (typeof x === 'string' ? x : x?.name);

export function CashRegistersPage() {
  const canManage = useCan('cashregister.manage');
  const canOperate = useCan('cashregister.operate');
  const [openShift, setOpenShift] = useState(false);
  const [addReg, setAddReg] = useState(false);
  const regs = useQuery({ queryKey: ['registers'], queryFn: () => get<Register[]>('/cash-registers') });
  const mine = useQuery({
    queryKey: ['shift'],
    queryFn: () => get<(Shift & { summary: ShiftSummary }) | null>('/cash-registers/shifts/current'),
    enabled: canOperate,
  });
  return (
    <>
      <PageHeader
        title="Cash registers"
        description="Registers, cashier shifts and drawer reconciliation."
        actions={
          <>
            {canOperate && !mine.data?.data && (
              <Button onClick={() => setOpenShift(true)}>
                <Banknote className="h-4 w-4" /> Open shift
              </Button>
            )}
            {canManage && (
              <Button variant="outline" onClick={() => setAddReg(true)}>
                <Plus className="h-4 w-4" /> Add register
              </Button>
            )}
          </>
        }
      />
      <Tabs.Root defaultValue="registers">
        <Tabs.List className="mb-4 flex gap-1 border-b" aria-label="Cash register sections">
          {[
            ['registers', 'Registers'],
            ['active', 'My active shift'],
            ['history', 'Shift history'],
          ].map(([v, l]) => (
            <Tabs.Trigger
              key={v}
              value={v}
              className="-mb-px border-b-2 border-transparent px-4 py-2 text-sm font-medium text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-primary"
            >
              {l}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="registers">
          <Loadable loading={regs.isLoading} error={regs.error} onRetry={regs.refetch}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {regs.data?.data.map((r) => (
                <Card key={r._id}>
                  <CardBody className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold">{r.name}</p>
                      <Badge tone={!r.active ? 'neutral' : r.openShift ? 'primary' : 'success'}>
                        {!r.active ? 'Inactive' : r.openShift ? 'In use' : 'Available'}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{r.location || 'No location set'}</p>
                    {r.openShift && (
                      <p className="text-sm">
                        Cashier: <strong>{nm(r.openShift.cashier)}</strong>
                        <br />
                        <span className="text-muted-foreground">Since {dateTime(r.openShift.openedAt)}</span>
                      </p>
                    )}
                  </CardBody>
                </Card>
              ))}
            </div>
          </Loadable>
        </Tabs.Content>
        <Tabs.Content value="active">
          <ActiveShift shift={mine.data?.data ?? null} loading={mine.isLoading} />
        </Tabs.Content>
        <Tabs.Content value="history">
          <ShiftHistory />
        </Tabs.Content>
      </Tabs.Root>
      <OpenShiftDialog open={openShift} onOpenChange={setOpenShift} />
      {addReg && <RegisterDialog onClose={() => setAddReg(false)} />}
    </>
  );
}

function RegisterDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const save = useSave<{ name: string; location?: string }>({
    method: 'post',
    url: '/cash-registers',
    invalidate: ['registers'],
    success: 'Register added',
    onDone: onClose,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Add register" size="sm">
        <div className="space-y-4">
          <Field label="Name">
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Location">
            <Input value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim()}
            loading={save.isPending}
            onClick={() => save.mutate({ name: name.trim(), location: location || undefined })}
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryCards({ s }: { s: ShiftSummary }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label="Opening float" value={money(s.openingFloatCents)} />
      <StatCard
        label="Cash sales"
        value={money(s.cashSalesCents)}
        hint={`${s.saleCount} sales · card ${money(s.cardSalesCents)}`}
      />
      <StatCard
        label="Cash refunds / out"
        value={money(s.cashRefundsCents + s.cashOutCents)}
        hint={`Cash in ${money(s.cashInCents)}`}
      />
      <StatCard label="Expected in drawer" value={money(s.expectedCashCents)} tone="success" />
    </div>
  );
}

function ActiveShift({
  shift,
  loading,
}: {
  shift: (Shift & { summary: ShiftSummary }) | null;
  loading: boolean;
}) {
  const canManage = useCan('cashregister.manage');
  const [closing, setClosing] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  return (
    <Loadable loading={loading}>
      {!shift ? (
        <Card>
          <CardBody className="py-10 text-center text-sm text-muted-foreground">
            You have no open shift. Use “Open shift” to begin selling.
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>
                {nm(shift.register)} · opened {dateTime(shift.openedAt)}
              </CardTitle>
              <div className="flex gap-2">
                {canManage && (
                  <Button variant="outline" size="sm" onClick={() => setAdjusting(true)}>
                    <PlusCircle className="h-4 w-4" /> Cash in / out
                  </Button>
                )}
                <Button size="sm" onClick={() => setClosing(true)}>
                  Close shift
                </Button>
              </div>
            </CardHeader>
            <CardBody>
              <SummaryCards s={shift.summary!} />
            </CardBody>
          </Card>
          {closing && <CloseShiftDialog shift={shift} onClose={() => setClosing(false)} />}
          {adjusting && <AdjustDialog shiftId={shift._id} onClose={() => setAdjusting(false)} />}
        </div>
      )}
    </Loadable>
  );
}

export function CloseShiftDialog({
  shift,
  onClose,
}: {
  shift: Shift & { summary?: ShiftSummary };
  onClose: () => void;
}) {
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const nav = useNavigate();
  const exp = shift.summary?.expectedCashCents ?? 0;
  const c = toCents(counted);
  const variance = Number.isFinite(c) ? c - exp : null;
  const save = useSave<{ countedCashCents: number; notes?: string }, Shift>({
    method: 'post',
    url: `/cash-registers/shifts/${shift._id}/close`,
    invalidate: ['shift', 'registers', 'shifts', 'shift-detail'],
    success: 'Shift closed',
    onDone: (s) => nav(`/cash-registers/shifts/${s._id}`),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Close shift"
        description="Count the drawer and enter the total cash on hand."
        size="sm"
      >
        <div className="space-y-4">
          <div className="rounded-md bg-surface p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Expected cash</span>
              <span className="font-semibold tabular">{money(exp)}</span>
            </div>
          </div>
          <Field label="Counted cash (Rs.)">
            <Input
              autoFocus
              inputMode="decimal"
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
              placeholder={centsToInput(exp)}
            />
          </Field>
          {variance !== null && (
            <p
              role="status"
              className={`text-sm font-medium ${variance === 0 ? 'text-success' : variance < 0 ? 'text-danger' : 'text-warning'}`}
            >
              {variance === 0
                ? 'Drawer balances exactly.'
                : variance < 0
                  ? `Shortage of ${money(-variance)}`
                  : `Overage of ${money(variance)}`}
            </p>
          )}
          <Field label="Closing notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={variance === null}
            loading={save.isPending}
            onClick={() => save.mutate({ countedCashCents: c, notes: notes || undefined })}
          >
            Close shift
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdjustDialog({ shiftId, onClose }: { shiftId: string; onClose: () => void }) {
  const [type, setType] = useState<'IN' | 'OUT'>('OUT');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const save = useSave<{ type: string; amountCents: number; reason: string }>({
    method: 'post',
    url: `/cash-registers/shifts/${shiftId}/adjust`,
    invalidate: ['shift', 'shift-detail'],
    success: 'Cash adjustment recorded',
    onDone: onClose,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Cash in / out" description="Recorded against the shift and audited." size="sm">
        <div className="space-y-4">
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value as 'IN' | 'OUT')}>
              <option value="OUT">Cash out (bank drop, petty cash)</option>
              <option value="IN">Cash in (top-up)</option>
            </Select>
          </Field>
          <Field label="Amount (Rs.)">
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Reason">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              const c = toCents(amount);
              if (!(c > 0) || reason.trim().length < 3) return toast.error('Enter an amount and a reason');
              save.mutate({ type, amountCents: c, reason: reason.trim() });
            }}
          >
            Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShiftHistory() {
  const nav = useNavigate();
  const list = useList<Shift>('shifts', '/cash-registers/shifts');
  const cols: Column<Shift>[] = [
    { key: 'r', header: 'Register', cell: (s) => nm(s.register) },
    { key: 'c', header: 'Cashier', cell: (s) => nm(s.cashier) },
    { key: 'o', header: 'Opened', cell: (s) => dateTime(s.openedAt) },
    { key: 'cl', header: 'Closed', cell: (s) => dateTime(s.closedAt) },
    {
      key: 'e',
      header: 'Expected',
      align: 'right',
      cell: (s) => (s.expectedCashCents !== undefined ? money(s.expectedCashCents) : '—'),
    },
    {
      key: 'ct',
      header: 'Counted',
      align: 'right',
      cell: (s) => (s.countedCashCents !== undefined ? money(s.countedCashCents) : '—'),
    },
    {
      key: 'v',
      header: 'Variance',
      align: 'right',
      cell: (s) =>
        s.varianceCents === undefined ? (
          '—'
        ) : (
          <span
            className={
              s.varianceCents < 0 ? 'text-danger' : s.varianceCents > 0 ? 'text-warning' : 'text-success'
            }
          >
            {money(s.varianceCents)}
          </span>
        ),
    },
    {
      key: 's',
      header: 'Status',
      cell: (s) => <Badge tone={StatusBadgeTone(s.status)}>{titleCase(s.status)}</Badge>,
    },
  ];
  return (
    <Card>
      <DataTable
        columns={cols}
        rows={list.rows}
        loading={list.isLoading}
        error={list.error}
        onRetry={list.refetch}
        meta={list.meta}
        onPage={list.setPage}
        rowKey={(s) => s._id}
        onRowClick={(s) => nav(`/cash-registers/shifts/${s._id}`)}
        emptyTitle="No shifts recorded"
      />
    </Card>
  );
}

export function ShiftDetailPage() {
  const { id } = useParams();
  const [closing, setClosing] = useState(false);
  const q = useQuery({
    queryKey: ['shift-detail', id],
    queryFn: () =>
      get<
        Shift & {
          adjustments: {
            _id: string;
            type: string;
            amountCents: number;
            reason: string;
            by: Named;
            createdAt: string;
          }[];
        }
      >(`/cash-registers/shifts/${id}`),
  });
  const s = q.data?.data;
  return (
    <Loadable loading={q.isLoading} error={q.error} onRetry={q.refetch}>
      {s && (
        <>
          <PageHeader
            title={`Shift · ${nm(s.register)}`}
            description={`${nm(s.cashier)} · ${dateTime(s.openedAt)}`}
            actions={
              <>
                <Badge tone={StatusBadgeTone(s.status)}>{titleCase(s.status)}</Badge>
                {s.status === 'OPEN' && <Button onClick={() => setClosing(true)}>Close shift</Button>}
                <Button asChild variant="outline">
                  <Link to="/cash-registers">Back</Link>
                </Button>
              </>
            }
          />
          {s.summary && <SummaryCards s={s.summary} />}
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Reconciliation</CardTitle>
              </CardHeader>
              <CardBody>
                <DL
                  items={[
                    [
                      'Expected cash',
                      s.expectedCashCents !== undefined
                        ? money(s.expectedCashCents)
                        : money(s.summary?.expectedCashCents),
                    ],
                    ['Counted cash', s.countedCashCents !== undefined ? money(s.countedCashCents) : '—'],
                    ['Variance', s.varianceCents !== undefined ? money(s.varianceCents) : '—'],
                    ['Closed', dateTime(s.closedAt)],
                    ['Closing notes', s.closingNotes],
                  ]}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Cash in / out</CardTitle>
              </CardHeader>
              <DataTable
                rows={s.adjustments}
                rowKey={(a) => a._id}
                emptyTitle="No adjustments"
                columns={[
                  {
                    key: 't',
                    header: 'Type',
                    cell: (a) => (
                      <Badge tone={a.type === 'IN' ? 'success' : 'warning'}>
                        {a.type === 'IN' ? 'Cash in' : 'Cash out'}
                      </Badge>
                    ),
                  },
                  { key: 'a', header: 'Amount', align: 'right', cell: (a) => money(a.amountCents) },
                  { key: 'r', header: 'Reason', cell: (a) => a.reason },
                  { key: 'b', header: 'By', cell: (a) => a.by?.name },
                ]}
              />
            </Card>
          </div>
          {closing && <CloseShiftDialog shift={s} onClose={() => setClosing(false)} />}
        </>
      )}
    </Loadable>
  );
}
