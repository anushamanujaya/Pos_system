import { useQuery } from '@tanstack/react-query';
import { PackageCheck } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { DL, PageHeader, StatusBadgeTone } from '@/components/shared/bits';
import { Loadable } from '@/components/shared/states';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/form';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useSave } from '@/hooks/useSave';
import { get } from '@/lib/api';
import { dateStr, dateTime, money, qty, titleCase } from '@/lib/format';
import { useCan } from '@/stores/auth';
import type { PurchaseOrder } from '@/types';
import { toast } from 'sonner';

export function PurchaseDetailPage() {
  const { id } = useParams();
  const canManage = useCan('purchases.manage');
  const canReceive = useCan('inventory.receive');
  const [receiving, setReceiving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const q = useQuery({ queryKey: ['purchase', id], queryFn: () => get<PurchaseOrder>(`/purchases/${id}`) });
  const po = q.data?.data;
  const inv = ['purchase', 'purchases', 'inventory', 'valuation', 'movements', 'batches'];
  const submit = useSave({
    method: 'post',
    url: `/purchases/${id}/submit`,
    invalidate: inv,
    success: 'Order submitted',
  });
  const cancel = useSave({
    method: 'post',
    url: `/purchases/${id}/cancel`,
    invalidate: inv,
    success: 'Order cancelled',
    onDone: () => setCancelling(false),
  });
  const open = po && ['ORDERED', 'PARTIALLY_RECEIVED'].includes(po.status);

  return (
    <Loadable loading={q.isLoading} error={q.error} onRetry={q.refetch}>
      {po && (
        <>
          <PageHeader
            title={po.number}
            description={po.supplier?.name}
            actions={
              <>
                <Badge tone={StatusBadgeTone(po.status)}>{titleCase(po.status)}</Badge>
                {canManage && po.status === 'DRAFT' && (
                  <Button loading={submit.isPending} onClick={() => submit.mutate(undefined)}>
                    Submit order
                  </Button>
                )}
                {canReceive && open && (
                  <Button onClick={() => setReceiving(true)}>
                    <PackageCheck className="h-4 w-4" /> Receive goods
                  </Button>
                )}
                {canManage &&
                  ['DRAFT', 'ORDERED'].includes(po.status) &&
                  !po.items.some((i) => i.receivedMilli > 0) && (
                    <Button variant="outline" className="text-danger" onClick={() => setCancelling(true)}>
                      Cancel order
                    </Button>
                  )}
              </>
            }
          />
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Items</CardTitle>
              </CardHeader>
              <Table>
                <THead>
                  <TR>
                    <TH>Product</TH>
                    <TH className="text-right">Ordered</TH>
                    <TH className="text-right">Received</TH>
                    <TH className="text-right">Unit cost</TH>
                    <TH className="text-right">Line total</TH>
                  </TR>
                </THead>
                <TBody>
                  {po.items.map((i) => (
                    <TR key={i._id}>
                      <TD>
                        <p className="font-medium">{i.product.name}</p>
                        <p className="text-xs text-muted-foreground">{i.product.sku}</p>
                      </TD>
                      <TD className="text-right tabular">{qty(i.orderedMilli)}</TD>
                      <TD className="text-right tabular">
                        <span className={i.receivedMilli >= i.orderedMilli ? 'text-success' : ''}>
                          {qty(i.receivedMilli)}
                        </span>
                      </TD>
                      <TD className="text-right tabular">{money(i.costCents)}</TD>
                      <TD className="text-right tabular">
                        {money(Math.round((i.costCents * i.orderedMilli) / 1000))}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <div className="flex justify-between border-t px-4 py-3 text-sm font-semibold">
                <span>Total</span>
                <span className="tabular">{money(po.totalCents)}</span>
              </div>
            </Card>
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Details</CardTitle>
                </CardHeader>
                <CardBody>
                  <DL
                    items={[
                      ['Created', dateTime(po.createdAt)],
                      ['Expected', dateStr(po.expectedDate)],
                      ['Supplier invoice', po.supplierInvoiceRef],
                      ['Notes', po.notes],
                    ]}
                  />
                </CardBody>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Goods receipts</CardTitle>
                </CardHeader>
                <CardBody className="space-y-2 text-sm">
                  {po.receipts?.length ? (
                    po.receipts.map((r) => (
                      <div key={r._id} className="rounded-md border p-2.5">
                        <p className="font-medium">
                          {r.number}{' '}
                          <span className="font-normal text-muted-foreground">· {dateTime(r.createdAt)}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {r.items.map((i) => `${i.product.name} ×${qty(i.qtyMilli)}`).join(', ')}
                        </p>
                        <p className="text-xs">
                          Received by {r.receivedBy?.name} · {money(r.totalCents)}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-muted-foreground">Nothing received yet.</p>
                  )}
                </CardBody>
              </Card>
            </div>
          </div>
          {receiving && <ReceiveDialog po={po} onClose={() => setReceiving(false)} />}
          <ConfirmDialog
            open={cancelling}
            onOpenChange={setCancelling}
            title="Cancel this purchase order?"
            description="The order will be marked as cancelled. This cannot be undone."
            confirmLabel="Cancel order"
            loading={cancel.isPending}
            onConfirm={() => cancel.mutate(undefined)}
          />
        </>
      )}
    </Loadable>
  );
}

function ReceiveDialog({ po, onClose }: { po: PurchaseOrder; onClose: () => void }) {
  const [rows, setRows] = useState(
    po.items
      .map((i) => ({
        product: i.product._id,
        name: i.product.name,
        outstanding: i.orderedMilli - i.receivedMilli,
        qty: String((i.orderedMilli - i.receivedMilli) / 1000),
        batchNo: '',
        expiry: '',
      }))
      .filter((r) => r.outstanding > 0),
  );
  const [invoice, setInvoice] = useState(po.supplierInvoiceRef ?? '');
  const save = useSave<unknown>({
    method: 'post',
    url: `/purchases/${po._id}/receive`,
    invalidate: ['purchase', 'purchases', 'inventory', 'valuation', 'movements', 'batches', 'products'],
    success: 'Goods received into stock',
    onDone: onClose,
  });
  const go = () => {
    const items = rows
      .filter((r) => Number(r.qty) > 0)
      .map((r) => ({
        product: r.product,
        quantity: Number(r.qty),
        batchNo: r.batchNo || undefined,
        expiryDate: r.expiry ? new Date(r.expiry).toISOString() : undefined,
      }));
    if (items.length === 0) return toast.error('Enter a received quantity');
    save.mutate({ items, supplierInvoiceRef: invoice || undefined });
  };
  const upd = (i: number, p: Partial<(typeof rows)[number]>) =>
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Receive goods"
        description="Enter what actually arrived. Partial deliveries are fine; the rest stays outstanding."
        size="xl"
      >
        <div className="space-y-3">
          <div className="max-w-sm">
            <label className="text-sm font-medium" htmlFor="inv">
              Supplier invoice reference
            </label>
            <Input id="inv" value={invoice} onChange={(e) => setInvoice(e.target.value)} />
          </div>
          <Table>
            <THead>
              <TR>
                <TH>Product</TH>
                <TH className="text-right">Outstanding</TH>
                <TH>Receive qty</TH>
                <TH>Batch no.</TH>
                <TH>Expiry</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r, i) => (
                <TR key={r.product}>
                  <TD className="font-medium">{r.name}</TD>
                  <TD className="text-right tabular">{qty(r.outstanding)}</TD>
                  <TD>
                    <Input
                      aria-label={`Receive quantity for ${r.name}`}
                      className="h-9 w-24"
                      inputMode="decimal"
                      value={r.qty}
                      onChange={(e) => upd(i, { qty: e.target.value })}
                    />
                  </TD>
                  <TD>
                    <Input
                      aria-label={`Batch for ${r.name}`}
                      className="h-9 w-28"
                      value={r.batchNo}
                      onChange={(e) => upd(i, { batchNo: e.target.value })}
                    />
                  </TD>
                  <TD>
                    <Input
                      aria-label={`Expiry for ${r.name}`}
                      type="date"
                      className="h-9 w-40"
                      value={r.expiry}
                      onChange={(e) => upd(i, { expiry: e.target.value })}
                    />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <p className="text-xs text-muted-foreground">
            Expiry date is required for products that track expiry.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={go}>
            Confirm receipt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
