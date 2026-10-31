import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { DL, PageHeader, SearchInput, StatCard, StatusBadgeTone, Toolbar } from '@/components/shared/bits';
import { Loadable } from '@/components/shared/states';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Textarea } from '@/components/ui/form';
import { useList } from '@/hooks/useList';
import { useSave } from '@/hooks/useSave';
import { get } from '@/lib/api';
import { dateStr, money, titleCase } from '@/lib/format';
import { useCan } from '@/stores/auth';
import type { PurchaseOrder, Supplier } from '@/types';

export function SuppliersPage() {
  const nav = useNavigate();
  const canManage = useCan('suppliers.manage');
  const list = useList<Supplier>('suppliers', '/suppliers');
  const [edit, setEdit] = useState<Supplier | 'new' | null>(null);
  const cols: Column<Supplier>[] = [
    { key: 'n', header: 'Supplier', cell: (s) => <span className="font-medium">{s.name}</span> },
    { key: 'c', header: 'Contact', cell: (s) => s.contactPerson ?? '—' },
    { key: 'p', header: 'Phone', cell: (s) => s.phone ?? '—' },
    { key: 'e', header: 'Email', cell: (s) => s.email ?? '—' },
    {
      key: 's',
      header: 'Status',
      cell: (s) => <Badge tone={s.active ? 'success' : 'neutral'}>{s.active ? 'Active' : 'Inactive'}</Badge>,
    },
  ];
  return (
    <>
      <PageHeader
        title="Suppliers"
        actions={
          canManage && (
            <Button onClick={() => setEdit('new')}>
              <Plus className="h-4 w-4" /> Add supplier
            </Button>
          )
        }
      />
      <Card>
        <Toolbar>
          <SearchInput
            className="w-full sm:w-72"
            value={list.q}
            onChange={list.setQ}
            placeholder="Search name, contact, phone"
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
          rowKey={(s) => s._id}
          onRowClick={(s) => nav(`/suppliers/${s._id}`)}
          emptyTitle="No suppliers yet"
        />
      </Card>
      {edit && <SupplierDialog supplier={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function SupplierDialog({ supplier, onClose }: { supplier?: Supplier; onClose: () => void }) {
  const { register, handleSubmit } = useForm<Supplier>({
    defaultValues: {
      name: supplier?.name ?? '',
      contactPerson: supplier?.contactPerson ?? '',
      phone: supplier?.phone ?? '',
      email: supplier?.email ?? '',
      address: supplier?.address ?? '',
      notes: supplier?.notes ?? '',
      active: supplier?.active ?? true,
    },
  });
  const save = useSave<Partial<Supplier>>({
    method: supplier ? 'patch' : 'post',
    url: `/suppliers${supplier ? `/${supplier._id}` : ''}`,
    invalidate: ['suppliers', 'supplier', 'suppliers-all'],
    success: 'Supplier saved',
    onDone: onClose,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={supplier ? 'Edit supplier' : 'Add supplier'} size="md">
        <form
          noValidate
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={handleSubmit((v) => {
            if (!v.name.trim()) return toast.error('Name is required');
            save.mutate(v);
          })}
        >
          <Field label="Name" className="sm:col-span-2">
            <Input autoFocus {...register('name')} />
          </Field>
          <Field label="Contact person">
            <Input {...register('contactPerson')} />
          </Field>
          <Field label="Phone">
            <Input {...register('phone')} />
          </Field>
          <Field label="Email" className="sm:col-span-2">
            <Input type="email" {...register('email')} />
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <Input {...register('address')} />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea {...register('notes')} />
          </Field>
          <Checkbox label="Active" {...register('active')} />
          <DialogFooter className="sm:col-span-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SupplierDetailPage() {
  const { id } = useParams();
  const canManage = useCan('suppliers.manage');
  const [edit, setEdit] = useState(false);
  const q = useQuery({
    queryKey: ['supplier', id],
    queryFn: () =>
      get<
        Supplier & {
          orders: PurchaseOrder[];
          summary: { orders: number; totalCents: number; receipts: number; receivedCents: number };
        }
      >(`/suppliers/${id}`),
  });
  const s = q.data?.data;
  return (
    <Loadable loading={q.isLoading} error={q.error} onRetry={q.refetch}>
      {s && (
        <>
          <PageHeader
            title={s.name}
            description={s.contactPerson}
            actions={
              <>
                <Badge tone={s.active ? 'success' : 'neutral'}>{s.active ? 'Active' : 'Inactive'}</Badge>
                {canManage && (
                  <Button variant="outline" onClick={() => setEdit(true)}>
                    <Pencil className="h-4 w-4" /> Edit
                  </Button>
                )}
              </>
            }
          />
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <StatCard label="Purchase orders" value={s.summary.orders} />
            <StatCard label="Ordered value" value={money(s.summary.totalCents)} />
            <StatCard
              label="Received value"
              value={money(s.summary.receivedCents)}
              hint={`${s.summary.receipts} goods receipts`}
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Contact</CardTitle>
              </CardHeader>
              <CardBody>
                <DL
                  items={[
                    ['Phone', s.phone],
                    ['Email', s.email],
                    ['Address', s.address],
                    ['Notes', s.notes],
                  ]}
                />
              </CardBody>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Purchase history</CardTitle>
              </CardHeader>
              <DataTable
                rows={s.orders}
                rowKey={(o) => o._id}
                emptyTitle="No purchase orders for this supplier"
                columns={[
                  {
                    key: 'n',
                    header: 'PO',
                    cell: (o) => (
                      <Link className="font-medium text-primary hover:underline" to={`/purchases/${o._id}`}>
                        {o.number}
                      </Link>
                    ),
                  },
                  { key: 'd', header: 'Date', cell: (o) => dateStr(o.createdAt) },
                  { key: 't', header: 'Total', align: 'right', cell: (o) => money(o.totalCents) },
                  {
                    key: 's',
                    header: 'Status',
                    cell: (o) => <Badge tone={StatusBadgeTone(o.status)}>{titleCase(o.status)}</Badge>,
                  },
                ]}
              />
            </Card>
          </div>
          {edit && <SupplierDialog supplier={s} onClose={() => setEdit(false)} />}
        </>
      )}
    </Loadable>
  );
}
