import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { DL, PageHeader, SearchInput, StatCard, Toolbar } from '@/components/shared/bits';
import { Loadable } from '@/components/shared/states';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Textarea } from '@/components/ui/form';
import { useList } from '@/hooks/useList';
import { useSave } from '@/hooks/useSave';
import { get } from '@/lib/api';
import { dateStr, dateTime, money } from '@/lib/format';
import { useCan } from '@/stores/auth';
import type { Customer } from '@/types';

export function CustomersPage() {
  const nav = useNavigate();
  const canManage = useCan('customers.manage');
  const list = useList<Customer>('customers', '/customers');
  const [edit, setEdit] = useState<Customer | 'new' | null>(null);
  const cols: Column<Customer>[] = [
    { key: 'c', header: 'Code', cell: (c) => c.code },
    { key: 'n', header: 'Name', cell: (c) => <span className="font-medium">{c.name}</span> },
    { key: 'p', header: 'Phone', cell: (c) => c.phone ?? '—' },
    { key: 'v', header: 'Visits', align: 'right', cell: (c) => c.visitCount },
    { key: 't', header: 'Total spent', align: 'right', cell: (c) => money(c.totalSpentCents) },
    { key: 'l', header: 'Last visit', cell: (c) => dateStr(c.lastVisitAt) },
    {
      key: 'r',
      header: '',
      cell: (c) => (c.returning ? <Badge tone="primary">Returning</Badge> : <Badge>New</Badge>),
    },
  ];
  return (
    <>
      <PageHeader
        title="Customers"
        description="Optional. Walk-in customers never need to be registered."
        actions={
          canManage && (
            <Button onClick={() => setEdit('new')}>
              <Plus className="h-4 w-4" /> Add customer
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
            placeholder="Search name, phone or code"
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
          rowKey={(c) => c._id}
          onRowClick={(c) => nav(`/customers/${c._id}`)}
          emptyTitle="No customers yet"
        />
      </Card>
      {edit && <CustomerDialog customer={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function CustomerDialog({ customer, onClose }: { customer?: Customer; onClose: () => void }) {
  const { register, handleSubmit } = useForm<Customer>({
    defaultValues: {
      name: customer?.name ?? '',
      phone: customer?.phone ?? '',
      email: customer?.email ?? '',
      address: customer?.address ?? '',
      notes: customer?.notes ?? '',
      active: customer?.active ?? true,
    },
  });
  const save = useSave<Partial<Customer>>({
    method: customer ? 'patch' : 'post',
    url: `/customers${customer ? `/${customer._id}` : ''}`,
    invalidate: ['customers', 'customer'],
    success: 'Customer saved',
    onDone: onClose,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={customer ? 'Edit customer' : 'Add customer'} size="md">
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
          <Field label="Phone">
            <Input inputMode="tel" {...register('phone')} />
          </Field>
          <Field label="Email (optional)">
            <Input type="email" {...register('email')} />
          </Field>
          <Field label="Address (optional)" className="sm:col-span-2">
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

export function CustomerDetailPage() {
  const { id } = useParams();
  const canManage = useCan('customers.manage');
  const [edit, setEdit] = useState(false);
  const q = useQuery({ queryKey: ['customer', id], queryFn: () => get<Customer>(`/customers/${id}`) });
  const c = q.data?.data;
  return (
    <Loadable loading={q.isLoading} error={q.error} onRetry={q.refetch}>
      {c && (
        <>
          <PageHeader
            title={c.name}
            description={c.code}
            actions={
              <>
                {c.returning && <Badge tone="primary">Returning customer</Badge>}
                {canManage && (
                  <Button variant="outline" onClick={() => setEdit(true)}>
                    <Pencil className="h-4 w-4" /> Edit
                  </Button>
                )}
              </>
            }
          />
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <StatCard label="Total spending" value={money(c.totalSpentCents)} />
            <StatCard label="Visits" value={c.visitCount} />
            <StatCard
              label="Average basket"
              value={c.visitCount ? money(Math.round(c.totalSpentCents / c.visitCount)) : '—'}
              hint={`Last visit ${dateStr(c.lastVisitAt)}`}
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
                    ['Phone', c.phone],
                    ['Email', c.email],
                    ['Address', c.address],
                    ['Notes', c.notes],
                  ]}
                />
              </CardBody>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Purchase history</CardTitle>
              </CardHeader>
              <DataTable
                rows={c.recentSales ?? []}
                rowKey={(s) => s._id}
                emptyTitle="No purchases yet"
                columns={[
                  {
                    key: 'r',
                    header: 'Receipt',
                    cell: (s) => (
                      <Link className="font-medium text-primary hover:underline" to={`/sales/${s._id}`}>
                        {s.receiptNo}
                      </Link>
                    ),
                  },
                  { key: 'd', header: 'Date', cell: (s) => dateTime(s.createdAt) },
                  { key: 't', header: 'Total', align: 'right', cell: (s) => money(s.totalCents) },
                  {
                    key: 'f',
                    header: 'Refunded',
                    align: 'right',
                    cell: (s) => (s.refundedCents ? money(s.refundedCents) : '—'),
                  },
                ]}
              />
            </Card>
          </div>
          {edit && <CustomerDialog customer={c} onClose={() => setEdit(false)} />}
        </>
      )}
    </Loadable>
  );
}
