import { useQuery } from '@tanstack/react-query';
import { Download, Printer, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { DL, PageHeader, SearchInput, StatusBadgeTone, Toolbar } from '@/components/shared/bits';
import { Loadable } from '@/components/shared/states';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/form';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useList } from '@/hooks/useList';
import { download, errMsg, get } from '@/lib/api';
import { dateTime, money, qty, titleCase } from '@/lib/format';
import { useCan } from '@/stores/auth';
import type { ReceiptData, Sale, Named } from '@/types';
import { ReceiptPreview } from '../pos/ReceiptView';

export function SalesPage() {
  const nav = useNavigate();
  const canAll = useCan('sales.read.all');
  const list = useList<Sale>('sales', '/sales', { sort: '-createdAt' });
  const users = useQuery({
    queryKey: ['users-pick'],
    queryFn: () => get<(Named & { _id: string })[]>('/users', { limit: 100 }),
    enabled: useCan('employees.read'),
  });
  const cols: Column<Sale>[] = [
    {
      key: 'r',
      header: 'Receipt',
      sortKey: 'receiptNo',
      cell: (s) => <span className="font-medium">{s.receiptNo}</span>,
    },
    { key: 'd', header: 'Date', sortKey: 'createdAt', cell: (s) => dateTime(s.createdAt) },
    { key: 'c', header: 'Cashier', cell: (s) => s.cashierName },
    {
      key: 'cu',
      header: 'Customer',
      cell: (s) => s.customerName ?? <span className="text-muted-foreground">Walk-in</span>,
    },
    {
      key: 'p',
      header: 'Payment',
      cell: (s) => [...new Set(s.payments.map((p) => titleCase(p.method)))].join(' + '),
    },
    { key: 't', header: 'Total', sortKey: 'totalCents', align: 'right', cell: (s) => money(s.totalCents) },
    {
      key: 'rf',
      header: 'Refunded',
      align: 'right',
      cell: (s) => (s.refundedCents ? <span className="text-danger">{money(s.refundedCents)}</span> : '—'),
    },
    {
      key: 's',
      header: 'Status',
      cell: (s) => <Badge tone={StatusBadgeTone(s.status)}>{titleCase(s.status)}</Badge>,
    },
  ];
  return (
    <>
      <PageHeader
        title="Sales history"
        description={canAll ? 'All completed transactions.' : 'Your transactions.'}
        actions={
          canAll && (
            <Button
              variant="outline"
              onClick={() =>
                download('/sales/export', list.params, 'sales.csv').catch((e) => toast.error(errMsg(e)))
              }
            >
              <Download className="h-4 w-4" /> Export CSV
            </Button>
          )
        }
      />
      <Card>
        <Toolbar>
          <SearchInput
            className="w-full sm:w-60"
            value={list.q}
            onChange={list.setQ}
            placeholder="Receipt number"
          />
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
          <Select
            aria-label="Payment method"
            className="w-36"
            value={list.filters.method ?? ''}
            onChange={(e) => list.setFilter('method', e.target.value || undefined)}
          >
            <option value="">All payments</option>
            <option value="CASH">Cash</option>
            <option value="CARD">Card</option>
          </Select>
          {canAll && (
            <Select
              aria-label="Cashier"
              className="w-44"
              value={list.filters.cashier ?? ''}
              onChange={(e) => list.setFilter('cashier', e.target.value || undefined)}
            >
              <option value="">All cashiers</option>
              {users.data?.data.map((u) => (
                <option key={u._id} value={u._id}>
                  {u.name}
                </option>
              ))}
            </Select>
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
          rowKey={(s) => s._id}
          onRowClick={(s) => nav(`/sales/${s._id}`)}
          emptyTitle="No sales found"
        />
      </Card>
    </>
  );
}

export function SaleDetailPage() {
  const { id } = useParams();
  const canRefund = useCan('sales.refund');
  const [receipt, setReceipt] = useState(false);
  const q = useQuery({ queryKey: ['sale', id], queryFn: () => get<Sale>(`/sales/${id}`) });
  const r = useQuery({
    queryKey: ['receipt', id],
    queryFn: () => get<ReceiptData>(`/sales/${id}/receipt`),
    enabled: receipt,
  });
  const s = q.data?.data;
  const refundable = s?.items.some((i) => i.returnedMilli < i.qtyMilli);
  return (
    <Loadable loading={q.isLoading} error={q.error} onRetry={q.refetch}>
      {s && (
        <>
          <PageHeader
            title={s.receiptNo}
            description={dateTime(s.createdAt)}
            actions={
              <>
                <Badge tone={StatusBadgeTone(s.status)}>{titleCase(s.status)}</Badge>
                <Button variant="outline" onClick={() => setReceipt(true)}>
                  <Printer className="h-4 w-4" /> Receipt / reprint
                </Button>
                {canRefund && refundable && (
                  <Button asChild>
                    <Link to={`/returns/new?receipt=${encodeURIComponent(s.receiptNo)}`}>
                      <RotateCcw className="h-4 w-4" /> Process return
                    </Link>
                  </Button>
                )}
              </>
            }
          />
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Items sold</CardTitle>
              </CardHeader>
              <Table>
                <THead>
                  <TR>
                    <TH>Product</TH>
                    <TH className="text-right">Qty</TH>
                    <TH className="text-right">Unit</TH>
                    <TH className="text-right">Discount</TH>
                    <TH className="text-right">Tax</TH>
                    <TH className="text-right">Total</TH>
                    <TH className="text-right">Returned</TH>
                  </TR>
                </THead>
                <TBody>
                  {s.items.map((i) => (
                    <TR key={i._id}>
                      <TD>
                        <p className="font-medium">{i.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {i.sku}
                          {i.discountNote ? ` · ${i.discountNote}` : ''}
                        </p>
                      </TD>
                      <TD className="text-right tabular">
                        {qty(i.qtyMilli)} {i.unitSymbol}
                      </TD>
                      <TD className="text-right tabular">{money(i.unitPriceCents)}</TD>
                      <TD className="text-right tabular">
                        {i.lineDiscountCents + i.orderDiscountShareCents
                          ? `−${money(i.lineDiscountCents + i.orderDiscountShareCents)}`
                          : '—'}
                      </TD>
                      <TD className="text-right tabular">{money(i.taxCents)}</TD>
                      <TD className="text-right tabular">{money(i.totalCents)}</TD>
                      <TD className="text-right tabular">
                        {i.returnedMilli ? <span className="text-danger">{qty(i.returnedMilli)}</span> : '—'}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Totals</CardTitle>
                </CardHeader>
                <CardBody className="space-y-1.5 text-sm tabular">
                  <Row l="Subtotal" r={money(s.subtotalCents)} />
                  <Row l="Discounts" r={`−${money(s.discountCents)}`} />
                  {s.taxBreakdown.map((t) => (
                    <Row
                      key={t.code + t.rateBps}
                      l={`${t.code || 'Tax'} ${(t.rateBps / 100).toFixed(2)}%`}
                      r={money(t.taxCents)}
                    />
                  ))}
                  <div className="flex justify-between border-t pt-2 text-base font-semibold">
                    <span>Total</span>
                    <span>{money(s.totalCents)}</span>
                  </div>
                  {s.refundedCents > 0 && <Row l="Refunded" r={`−${money(s.refundedCents)}`} />}
                  {s.refundedCents > 0 && (
                    <div className="flex justify-between font-semibold">
                      <span>Net revenue</span>
                      <span>{money(s.totalCents - s.refundedCents)}</span>
                    </div>
                  )}
                </CardBody>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Payment & staff</CardTitle>
                </CardHeader>
                <CardBody>
                  <DL
                    items={[
                      ['Cashier', s.cashierName],
                      ['Register', s.registerName],
                      ['Customer', s.customerName ?? 'Walk-in'],
                      ...s.payments.map((p, i): [string, string] => [
                        `Payment ${i + 1}`,
                        `${titleCase(p.method)} ${money(p.amountCents)}${p.reference ? ` (${p.reference})` : ''}`,
                      ]),
                      ['Change given', money(s.changeCents)],
                    ]}
                  />
                </CardBody>
              </Card>
              {s.returns && s.returns.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Refund history</CardTitle>
                  </CardHeader>
                  <CardBody className="space-y-2 text-sm">
                    {s.returns.map((x) => (
                      <Link
                        key={x._id}
                        to={`/returns/${x._id}`}
                        className="flex justify-between rounded-md border p-2.5 hover:bg-surface"
                      >
                        <span>
                          {x.number}
                          <span className="block text-xs text-muted-foreground">
                            {dateTime(x.createdAt)} · {titleCase(x.refundMethod)}
                          </span>
                        </span>
                        <span className="tabular text-danger">{money(x.refundCents)}</span>
                      </Link>
                    ))}
                  </CardBody>
                </Card>
              )}
            </div>
          </div>
          <Dialog open={receipt} onOpenChange={setReceipt}>
            <DialogContent title={`Receipt ${s.receiptNo}`} size="md">
              {r.isLoading ? (
                <p className="p-6 text-center text-sm text-muted-foreground">Loading receipt…</p>
              ) : r.data ? (
                <ReceiptPreview data={r.data.data} />
              ) : (
                <p className="text-danger">{r.error ? errMsg(r.error) : ''}</p>
              )}
            </DialogContent>
          </Dialog>
        </>
      )}
    </Loadable>
  );
}
const Row = ({ l, r }: { l: string; r: string }) => (
  <div className="flex justify-between">
    <span className="text-muted-foreground">{l}</span>
    <span>{r}</span>
  </div>
);
