import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ImagePlus, Pencil } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { DL, PageHeader } from '@/components/shared/bits';
import { DataTable } from '@/components/shared/DataTable';
import { Loadable } from '@/components/shared/states';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { api, errMsg, get, send } from '@/lib/api';
import { dateTime, money, qty, titleCase } from '@/lib/format';
import { useCan } from '@/stores/auth';
import type { Named, Product, Unit } from '@/types';
import { stockBadge } from './ProductsPage';

type Detail = Omit<Product, 'category' | 'brand' | 'unit' | 'suppliers'> & {
  category: Named;
  brand?: Named;
  unit: Unit;
  suppliers: Named[];
};
interface Movement {
  _id: string;
  type: string;
  qtyMilli: number;
  balanceAfterMilli: number;
  createdAt: string;
  refNo?: string;
  reason?: string;
  actor?: Named;
  batch?: { batchNo: string };
}

export function ProductDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const canUpdate = useCan('products.update');
  const canDelete = useCan('products.delete');
  const canSeeInv = useCan('inventory.read');
  const file = useRef<HTMLInputElement>(null);
  const [confirm, setConfirm] = useState(false);
  const q = useQuery({ queryKey: ['product', id], queryFn: () => get<Detail>(`/products/${id}`) });
  const mv = useQuery({
    queryKey: ['product-movements', id],
    queryFn: () => get<Movement[]>('/inventory/movements', { product: id, limit: 10 }),
    enabled: canSeeInv,
  });
  const p = q.data?.data;

  const upload = useMutation({
    mutationFn: async (f: File) => {
      const fd = new FormData();
      fd.append('image', f);
      await api.post(`/products/${id}/image`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    },
    onSuccess: () => {
      toast.success('Image updated');
      qc.invalidateQueries({ queryKey: ['product', id] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const del = useMutation({
    mutationFn: () => send<{ archived: boolean; deleted: boolean }>('delete', `/products/${id}`),
    onSuccess: (r) => {
      toast.success(r.data.deleted ? 'Product deleted' : 'Product archived (it has sales or stock history)');
      qc.invalidateQueries({ queryKey: ['products'] });
      nav('/products');
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  return (
    <Loadable loading={q.isLoading} error={q.error} onRetry={q.refetch}>
      {p && (
        <>
          <PageHeader
            title={p.name}
            description={`${p.sku}${p.barcode ? ` · ${p.barcode}` : ''}`}
            actions={
              <>
                {p.status === 'ARCHIVED' ? <Badge tone="danger">Archived</Badge> : stockBadge(p)}
                {canUpdate && (
                  <Button asChild variant="outline">
                    <Link to={`/products/${id}/edit`}>
                      <Pencil className="h-4 w-4" /> Edit
                    </Link>
                  </Button>
                )}
                {canDelete && p.status !== 'ARCHIVED' && (
                  <Button variant="outline" className="text-danger" onClick={() => setConfirm(true)}>
                    <Archive className="h-4 w-4" /> Archive / delete
                  </Button>
                )}
              </>
            }
          />
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardBody>
                <DL
                  items={[
                    ['Category', p.category?.name],
                    ['Brand', p.brand?.name],
                    ['Unit', `${p.unit?.name} (${p.unit?.symbol})`],
                    ['Selling price', money(p.priceCents)],
                    ['Purchase cost (avg)', money(p.costCents)],
                    [
                      'Margin',
                      p.priceCents
                        ? `${(((p.priceCents - p.costCents) / p.priceCents) * 100).toFixed(1)}%`
                        : '—',
                    ],
                    ['Tax', p.taxCode ?? 'None'],
                    ['Reorder threshold', `${qty(p.reorderLevelMilli)} ${p.unit?.symbol}`],
                    ['Expiry tracking', p.trackExpiry ? 'Enabled' : 'Off'],
                    ['Pack size', p.packSize],
                    ['Suppliers', p.suppliers?.map((s) => s.name).join(', ') || '—'],
                    ['Last updated', dateTime(p.updatedAt)],
                    ['Description', p.description],
                  ]}
                />
              </CardBody>
            </Card>
            <div className="space-y-4">
              <Card>
                <CardBody className="space-y-3 text-center">
                  {p.imageUrl ? (
                    <img
                      src={p.imageUrl}
                      alt={p.name}
                      className="mx-auto h-40 w-40 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="mx-auto grid h-40 w-40 place-items-center rounded-lg bg-surface text-muted-foreground">
                      No image
                    </div>
                  )}
                  {canUpdate && (
                    <>
                      <input
                        ref={file}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="sr-only"
                        aria-label="Product image"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) upload.mutate(f);
                          e.target.value = '';
                        }}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        loading={upload.isPending}
                        onClick={() => file.current?.click()}
                      >
                        <ImagePlus className="h-4 w-4" /> Upload image
                      </Button>
                      <p className="text-xs text-muted-foreground">JPEG, PNG or WebP, up to 2 MB</p>
                    </>
                  )}
                </CardBody>
              </Card>
              <Card>
                <CardBody>
                  <p className="text-xs uppercase text-muted-foreground">On hand</p>
                  <p className="text-3xl font-semibold tabular">
                    {qty(p.onHandMilli)}{' '}
                    <span className="text-base font-normal text-muted-foreground">{p.unit?.symbol}</span>
                  </p>
                </CardBody>
              </Card>
            </div>
            {canSeeInv && (
              <Card className="lg:col-span-3">
                <CardHeader>
                  <CardTitle>Recent stock movements</CardTitle>
                  <Button asChild variant="link" size="sm">
                    <Link to={`/inventory/movements?product=${id}`}>View all</Link>
                  </Button>
                </CardHeader>
                <DataTable
                  columns={[
                    { key: 'd', header: 'When', cell: (m: Movement) => dateTime(m.createdAt) },
                    {
                      key: 't',
                      header: 'Type',
                      cell: (m) => (
                        <Badge tone={m.qtyMilli > 0 ? 'success' : 'warning'}>{titleCase(m.type)}</Badge>
                      ),
                    },
                    {
                      key: 'q',
                      header: 'Qty',
                      align: 'right',
                      cell: (m) => `${m.qtyMilli > 0 ? '+' : ''}${qty(m.qtyMilli)}`,
                    },
                    { key: 'b', header: 'Balance', align: 'right', cell: (m) => qty(m.balanceAfterMilli) },
                    { key: 'r', header: 'Reference', cell: (m) => m.refNo ?? m.reason ?? '—' },
                    { key: 'a', header: 'By', cell: (m) => m.actor?.name },
                  ]}
                  rows={mv.data?.data ?? []}
                  loading={mv.isLoading}
                  error={mv.error}
                  rowKey={(m) => m._id}
                  emptyTitle="No stock movements yet"
                />
              </Card>
            )}
          </div>
          <ConfirmDialog
            open={confirm}
            onOpenChange={setConfirm}
            title="Archive or delete this product?"
            loading={del.isPending}
            confirmLabel="Continue"
            description="Products with sales, purchases or stock history are archived (hidden from the POS) and kept for reporting. Products with no history are deleted permanently."
            onConfirm={() => del.mutate()}
          />
        </>
      )}
    </Loadable>
  );
}
