import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Printer, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { PageHeader, SearchInput, Toolbar } from '@/components/shared/bits';
import { Loadable } from '@/components/shared/states';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useList } from '@/hooks/useList';
import { ApiError, errMsg, get, send } from '@/lib/api';
import { dateTime, money, qty, titleCase } from '@/lib/format';
import { useCan } from '@/stores/auth';
import type { Sale, SaleReturn, Settings } from '@/types';
import { cn } from '@/lib/utils';

export function ReturnsPage() {
  const nav = useNavigate();
  const canRefund = useCan('sales.refund');
  const list = useList<SaleReturn>('returns', '/returns');
  const cols: Column<SaleReturn>[] = [
    { key: 'n', header: 'Return', cell: (r) => <span className="font-medium">{r.number}</span> },
    { key: 's', header: 'Original sale', cell: (r) => r.saleReceiptNo },
    { key: 'd', header: 'Date', cell: (r) => dateTime(r.createdAt) },
    {
      key: 'i',
      header: 'Items',
      cell: (r) => r.items.map((i) => `${i.name} ×${qty(i.qtyMilli)}`).join(', '),
      className: 'max-w-xs truncate',
    },
    { key: 'm', header: 'Refund via', cell: (r) => titleCase(r.refundMethod) },
    { key: 'a', header: 'Refunded', align: 'right', cell: (r) => money(r.refundCents) },
    { key: 'b', header: 'By', cell: (r) => r.processedByName },
  ];
  return (
    <>
      <PageHeader
        title="Returns & refunds"
        actions={
          canRefund && (
            <Button asChild>
              <Link to="/returns/new">
                <Plus className="h-4 w-4" /> Process return
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
            placeholder="Return or receipt number"
          />
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
          rowKey={(r) => r._id}
          onRowClick={(r) => nav(`/returns/${r._id}`)}
          emptyTitle="No returns yet"
        />
      </Card>
    </>
  );
}

interface LineState {
  qty: string;
  condition: 'RESTOCK' | 'DAMAGED';
}

export function NewReturnPage() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [receiptNo, setReceiptNo] = useState(sp.get('receipt') ?? '');
  const [search, setSearch] = useState(sp.get('receipt') ?? '');
  const [lines, setLines] = useState<Record<string, LineState>>({});
  const [method, setMethod] = useState<'CASH' | 'CARD'>('CASH');
  const [reason, setReason] = useState('');
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => get<Settings>('/settings') });
  const sale = useQuery({
    queryKey: ['sale-lookup', search],
    queryFn: () => get<Sale>(`/sales/lookup/${encodeURIComponent(search)}`),
    enabled: !!search,
    retry: false,
  });
  const s = sale.data?.data;

  const submit = useMutation({
    mutationFn: () =>
      send<SaleReturn>('post', '/returns', {
        sale: s!._id,
        refundMethod: method,
        reason,
        items: Object.entries(lines)
          .filter(([, l]) => Number(l.qty) > 0)
          .map(([saleItemId, l]) => ({ saleItemId, quantity: Number(l.qty), condition: l.condition })),
      }),
    onSuccess: (r) => {
      toast.success(`Return ${r.data.number} recorded`);
      nav(`/returns/${r.data._id}`);
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const chosen = Object.values(lines).some((l) => Number(l.qty) > 0);
  const hasMethod = (m: 'CASH' | 'CARD') => s?.payments.some((p) => p.method === m);

  return (
    <>
      <PageHeader
        title="Process return"
        description="Find the original sale, pick the items coming back, and choose how to refund."
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>1. Original sale</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setSearch(receiptNo.trim());
                setLines({});
              }}
            >
              <Input
                aria-label="Receipt number"
                placeholder="Enter receipt number, e.g. INV-20260101-00001"
                value={receiptNo}
                onChange={(e) => setReceiptNo(e.target.value)}
                autoFocus
              />
              <Button type="submit">
                <Search className="h-4 w-4" /> Find sale
              </Button>
            </form>
            {sale.isLoading && <p className="text-sm text-muted-foreground">Looking up…</p>}
            {sale.error && (
              <p role="alert" className="text-sm text-danger">
                {(sale.error as ApiError).status === 404
                  ? 'No sale found with that receipt number.'
                  : errMsg(sale.error)}
              </p>
            )}
            {s && (
              <div className="overflow-hidden rounded-md border">
                <div className="flex justify-between bg-surface/60 px-3 py-2 text-sm">
                  <span className="font-medium">{s.receiptNo}</span>
                  <span className="text-muted-foreground">
                    {dateTime(s.createdAt)} · {s.cashierName}
                  </span>
                </div>
                <Table>
                  <THead>
                    <TR>
                      <TH>Product</TH>
                      <TH className="text-right">Sold</TH>
                      <TH className="text-right">Returnable</TH>
                      <TH className="text-right">Paid</TH>
                      <TH>Return qty</TH>
                      <TH>Condition</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {s.items.map((i) => {
                      const left = i.qtyMilli - i.returnedMilli;
                      const l = lines[i._id];
                      return (
                        <TR key={i._id} className={cn(left === 0 && 'opacity-50')}>
                          <TD className="font-medium">{i.name}</TD>
                          <TD className="text-right tabular">{qty(i.qtyMilli)}</TD>
                          <TD className="text-right tabular">{qty(left)}</TD>
                          <TD className="text-right tabular">{money(i.totalCents)}</TD>
                          <TD>
                            <Input
                              aria-label={`Return quantity for ${i.name}`}
                              disabled={left === 0}
                              className="h-9 w-20"
                              inputMode="decimal"
                              value={l?.qty ?? ''}
                              onChange={(e) =>
                                setLines({
                                  ...lines,
                                  [i._id]: { qty: e.target.value, condition: l?.condition ?? 'RESTOCK' },
                                })
                              }
                            />
                          </TD>
                          <TD>
                            <Select
                              aria-label={`Condition for ${i.name}`}
                              disabled={left === 0}
                              className="h-9 w-36"
                              value={l?.condition ?? 'RESTOCK'}
                              onChange={(e) =>
                                setLines({
                                  ...lines,
                                  [i._id]: {
                                    qty: l?.qty ?? '',
                                    condition: e.target.value as LineState['condition'],
                                  },
                                })
                              }
                            >
                              <option value="RESTOCK">Restock (saleable)</option>
                              <option value="DAMAGED">Damaged (write off)</option>
                            </Select>
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>2. Refund</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <Field label="Refund method" hint="Must match how the customer originally paid.">
              <Select value={method} onChange={(e) => setMethod(e.target.value as 'CASH' | 'CARD')}>
                <option value="CASH" disabled={s && !hasMethod('CASH')}>
                  Cash from drawer
                </option>
                <option value="CARD" disabled={s && !hasMethod('CARD')}>
                  Card (via terminal)
                </option>
              </Select>
            </Field>
            <Field label="Reason">
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is the customer returning these items?"
              />
            </Field>
            {settings.data?.data.checkout.refundRequiresManager && (
              <p className="rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
                Refunds currently require manager approval.
              </p>
            )}
            <Button
              className="w-full"
              disabled={!s || !chosen || reason.trim().length < 3}
              loading={submit.isPending}
              onClick={() => submit.mutate()}
            >
              Confirm refund
            </Button>
            <p className="text-xs text-muted-foreground">
              The server calculates the exact refund (including tax) and rejects anything beyond what was sold
              and paid.
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

export function ReturnDetailPage() {
  const { id } = useParams();
  const q = useQuery({
    queryKey: ['return', id],
    queryFn: () =>
      get<
        SaleReturn & {
          sale: { receiptNo: string; createdAt: string };
          store: { name: string; address: string; phone: string };
          receipt: { footer: string };
        }
      >(`/returns/${id}`),
  });
  const r = q.data?.data;
  return (
    <Loadable loading={q.isLoading} error={q.error} onRetry={q.refetch}>
      {r && (
        <>
          <PageHeader
            title={r.number}
            description={`Refund against ${r.saleReceiptNo}`}
            actions={
              <Button onClick={() => window.print()}>
                <Printer className="h-4 w-4" /> Print return receipt
              </Button>
            }
          />
          <div className="print-area receipt-sheet receipt-80 mx-auto max-w-sm bg-white p-4 text-[12px] shadow-card">
            <div className="text-center">
              <div className="text-sm font-bold">{r.store.name}</div>
              <div>{r.store.address}</div>
              <div>{r.store.phone}</div>
              <div className="mt-1 font-bold">RETURN / REFUND</div>
            </div>
            <div className="my-2 border-t border-dashed border-black" />
            <div className="flex justify-between">
              <span>Return</span>
              <span>{r.number}</span>
            </div>
            <div className="flex justify-between">
              <span>Original</span>
              <span>{r.saleReceiptNo}</span>
            </div>
            <div className="flex justify-between">
              <span>Date</span>
              <span>{dateTime(r.createdAt)}</span>
            </div>
            <div className="flex justify-between">
              <span>Processed by</span>
              <span>{r.processedByName}</span>
            </div>
            <div className="my-2 border-t border-dashed border-black" />
            {r.items.map((i, k) => (
              <div key={k} className="mb-1">
                <div>{i.name}</div>
                <div className="flex justify-between">
                  <span>
                    {' '}
                    {qty(i.qtyMilli)} · {i.restock ? 'restocked' : 'written off'}
                  </span>
                  <span>{money(i.refundCents)}</span>
                </div>
              </div>
            ))}
            <div className="my-2 border-t border-dashed border-black" />
            <div className="flex justify-between font-bold">
              <span>TOTAL REFUND ({titleCase(r.refundMethod)})</span>
              <span>{money(r.refundCents)}</span>
            </div>
            {r.reason && <div className="mt-2">Reason: {r.reason}</div>}
            <div className="mt-3 text-center">{r.receipt.footer}</div>
          </div>
          <div className="no-print mt-4 text-center">
            <Badge tone="primary">Tax included in refund: {money(r.refundTaxCents)}</Badge>
          </div>
        </>
      )}
    </Loadable>
  );
}
