import { useQuery } from '@tanstack/react-query';
import { KeyRound, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { DL, PageHeader, SearchInput, StatCard, StatusBadgeTone, Toolbar } from '@/components/shared/bits';
import { Loadable } from '@/components/shared/states';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { useList } from '@/hooks/useList';
import { useSave } from '@/hooks/useSave';
import { get } from '@/lib/api';
import { dateStr, dateTime, money, titleCase } from '@/lib/format';
import { useAuth, useCan } from '@/stores/auth';
import type { Employee } from '@/types';

const roleTone = (r: string) =>
  (r === 'OWNER' ? 'primary' : r === 'MANAGER' ? 'warning' : 'neutral') as 'primary' | 'warning' | 'neutral';

export function EmployeesPage() {
  const nav = useNavigate();
  const canManage = useCan('employees.manage');
  const list = useList<Employee>('employees', '/users', { sort: 'name' });
  const [edit, setEdit] = useState<Employee | 'new' | null>(null);
  const cols: Column<Employee>[] = [
    {
      key: 'n',
      header: 'Employee',
      sortKey: 'name',
      cell: (e) => (
        <div>
          <p className="font-medium">{e.name}</p>
          <p className="text-xs text-muted-foreground">{e.email}</p>
        </div>
      ),
    },
    {
      key: 'r',
      header: 'Role',
      sortKey: 'role',
      cell: (e) => <Badge tone={roleTone(e.role)}>{titleCase(e.role)}</Badge>,
    },
    { key: 'l', header: 'Last login', sortKey: 'lastLoginAt', cell: (e) => dateTime(e.lastLoginAt) },
    {
      key: 's',
      header: 'Status',
      cell: (e) => <Badge tone={e.active ? 'success' : 'danger'}>{e.active ? 'Active' : 'Disabled'}</Badge>,
    },
  ];
  return (
    <>
      <PageHeader
        title="Employees"
        description="Accounts, roles and access."
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/employees/roles">Roles & permissions</Link>
            </Button>
            {canManage && (
              <Button onClick={() => setEdit('new')}>
                <Plus className="h-4 w-4" /> Add employee
              </Button>
            )}
          </>
        }
      />
      <Card>
        <Toolbar>
          <SearchInput
            className="w-full sm:w-64"
            value={list.q}
            onChange={list.setQ}
            placeholder="Search name or email"
          />
          <Select
            aria-label="Role"
            className="w-40"
            value={list.filters.role ?? ''}
            onChange={(e) => list.setFilter('role', e.target.value || undefined)}
          >
            <option value="">All roles</option>
            <option value="OWNER">Owner</option>
            <option value="MANAGER">Manager</option>
            <option value="CASHIER">Cashier</option>
          </Select>
          <Select
            aria-label="Status"
            className="w-36"
            value={list.filters.active ?? ''}
            onChange={(e) => list.setFilter('active', e.target.value || undefined)}
          >
            <option value="">Any status</option>
            <option value="true">Active</option>
            <option value="false">Disabled</option>
          </Select>
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
          rowKey={(e) => e._id}
          onRowClick={(e) => nav(`/employees/${e._id}`)}
          emptyTitle="No employees found"
        />
      </Card>
      {edit && <EmployeeDialog employee={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function EmployeeDialog({ employee, onClose }: { employee?: Employee; onClose: () => void }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<{ name: string; email: string; phone: string; role: string; password: string }>({
    defaultValues: {
      name: employee?.name ?? '',
      email: employee?.email ?? '',
      phone: employee?.phone ?? '',
      role: employee?.role ?? 'CASHIER',
      password: '',
    },
  });
  const save = useSave<Record<string, unknown>>({
    method: employee ? 'patch' : 'post',
    url: `/users${employee ? `/${employee._id}` : ''}`,
    invalidate: ['employees', 'employee'],
    success: employee
      ? 'Employee updated'
      : 'Employee created. They must change the password at first sign-in.',
    onDone: onClose,
  });
  const self = useAuth((s) => s.user?.id) === employee?._id;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={employee ? 'Edit employee' : 'Add employee'} size="md">
        <form
          noValidate
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={handleSubmit((v) => {
            if (!v.name.trim()) return toast.error('Name is required');
            if (!employee && (!v.email || v.password.length < 8))
              return toast.error('Email and an 8+ character password are required');
            save.mutate(
              employee
                ? { name: v.name, phone: v.phone, role: v.role }
                : {
                    name: v.name,
                    email: v.email,
                    phone: v.phone || undefined,
                    role: v.role,
                    password: v.password,
                  },
            );
          })}
        >
          <Field label="Full name" className="sm:col-span-2" error={errors.name?.message}>
            <Input autoFocus {...register('name')} />
          </Field>
          <Field label="Email (sign-in)" className="sm:col-span-2">
            <Input type="email" disabled={!!employee} {...register('email')} />
          </Field>
          <Field label="Phone">
            <Input {...register('phone')} />
          </Field>
          <Field label="Role" hint={self ? 'You cannot change your own role.' : undefined}>
            <Select disabled={self} {...register('role')}>
              <option value="CASHIER">Cashier</option>
              <option value="MANAGER">Manager</option>
              <option value="OWNER">Owner</option>
            </Select>
          </Field>
          {!employee && (
            <Field
              label="Temporary password"
              className="sm:col-span-2"
              hint="8+ characters with letters and numbers. They will be asked to change it."
            >
              <Input type="password" autoComplete="new-password" {...register('password')} />
            </Field>
          )}
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

export function EmployeeDetailPage() {
  const { id } = useParams();
  const canManage = useCan('employees.manage');
  const me = useAuth((s) => s.user?.id);
  const [edit, setEdit] = useState(false);
  const [reset, setReset] = useState(false);
  const [toggle, setToggle] = useState(false);
  const [pw, setPw] = useState('');
  const q = useQuery({ queryKey: ['employee', id], queryFn: () => get<Employee>(`/users/${id}`) });
  const e = q.data?.data;
  const toggleActive = useSave({
    method: 'patch',
    url: `/users/${id}`,
    invalidate: ['employee', 'employees'],
    success: 'Account updated',
    onDone: () => setToggle(false),
  });
  const resetPw = useSave<{ password: string }>({
    method: 'post',
    url: `/users/${id}/reset-password`,
    invalidate: ['employee'],
    success: 'Password reset. All sessions were signed out.',
    onDone: () => {
      setReset(false);
      setPw('');
    },
  });
  return (
    <Loadable loading={q.isLoading} error={q.error} onRetry={q.refetch}>
      {e && (
        <>
          <PageHeader
            title={e.name}
            description={e.email}
            actions={
              <>
                <Badge tone={roleTone(e.role)}>{titleCase(e.role)}</Badge>
                <Badge tone={e.active ? 'success' : 'danger'}>{e.active ? 'Active' : 'Disabled'}</Badge>
                {canManage && (
                  <>
                    <Button variant="outline" onClick={() => setEdit(true)}>
                      <Pencil className="h-4 w-4" /> Edit
                    </Button>
                    <Button variant="outline" onClick={() => setReset(true)}>
                      <KeyRound className="h-4 w-4" /> Reset password
                    </Button>
                    {e._id !== me && (
                      <Button
                        variant="outline"
                        className={e.active ? 'text-danger' : ''}
                        onClick={() => setToggle(true)}
                      >
                        {e.active ? 'Disable account' : 'Enable account'}
                      </Button>
                    )}
                  </>
                )}
              </>
            }
          />
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <StatCard label="Sales processed" value={e.salesSummary?.count ?? 0} />
            <StatCard label="Sales value" value={money(e.salesSummary?.totalCents ?? 0)} />
            <StatCard label="Refunded" value={money(e.salesSummary?.refundedCents ?? 0)} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Account</CardTitle>
              </CardHeader>
              <CardBody>
                <DL
                  items={[
                    ['Phone', e.phone],
                    ['Created', dateStr(e.createdAt)],
                    ['Last login', dateTime(e.lastLoginAt)],
                  ]}
                />
              </CardBody>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Recent shifts</CardTitle>
              </CardHeader>
              <DataTable
                rows={e.recentShifts ?? []}
                rowKey={(s) => s._id}
                emptyTitle="No shifts yet"
                columns={[
                  { key: 'r', header: 'Register', cell: (s) => (s.register as { name: string })?.name },
                  { key: 'o', header: 'Opened', cell: (s) => dateTime(s.openedAt) },
                  { key: 'c', header: 'Closed', cell: (s) => dateTime(s.closedAt) },
                  {
                    key: 'v',
                    header: 'Variance',
                    align: 'right',
                    cell: (s) => (s.varianceCents !== undefined ? money(s.varianceCents) : '—'),
                  },
                  {
                    key: 's',
                    header: 'Status',
                    cell: (s) => <Badge tone={StatusBadgeTone(s.status)}>{titleCase(s.status)}</Badge>,
                  },
                ]}
              />
            </Card>
          </div>
          {edit && <EmployeeDialog employee={e} onClose={() => setEdit(false)} />}
          <ConfirmDialog
            open={toggle}
            onOpenChange={setToggle}
            title={e.active ? 'Disable this account?' : 'Enable this account?'}
            loading={toggleActive.isPending}
            description={
              e.active
                ? `${e.name} will be signed out immediately and will not be able to sign in again until re-enabled.`
                : `${e.name} will be able to sign in again.`
            }
            confirmLabel={e.active ? 'Disable' : 'Enable'}
            tone={e.active ? 'danger' : 'primary'}
            onConfirm={() => (toggleActive.mutate as (b: unknown) => void)({ active: !e.active })}
          />
          <Dialog open={reset} onOpenChange={setReset}>
            <DialogContent
              title="Reset password"
              description="Sets a temporary password, signs the employee out everywhere and requires a change at next sign-in."
              size="sm"
            >
              <Field label="New temporary password">
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={pw}
                  onChange={(ev) => setPw(ev.target.value)}
                />
              </Field>
              <DialogFooter>
                <Button variant="outline" onClick={() => setReset(false)}>
                  Cancel
                </Button>
                <Button
                  disabled={pw.length < 8}
                  loading={resetPw.isPending}
                  onClick={() => resetPw.mutate({ password: pw })}
                >
                  Reset password
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </Loadable>
  );
}

export function RolesPage() {
  const q = useQuery({
    queryKey: ['roles'],
    queryFn: () => get<{ role: string; permissions: string[] }[]>('/users/roles'),
  });
  const all = (q.data?.meta?.allPermissions as string[] | undefined) ?? [];
  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="Read-only matrix. Permissions are enforced by the server on every request."
        actions={
          <Button asChild variant="outline">
            <Link to="/employees">Back to employees</Link>
          </Button>
        }
      />
      <Card>
        <Loadable loading={q.isLoading} error={q.error} onRetry={q.refetch}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface/70 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5">Permission</th>
                  {q.data?.data.map((r) => (
                    <th key={r.role} className="px-4 py-2.5 text-center">
                      {titleCase(r.role)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {all.map((p) => (
                  <tr key={p}>
                    <td className="px-4 py-2 font-mono text-xs">{p}</td>
                    {q.data?.data.map((r) => (
                      <td key={r.role} className="px-4 py-2 text-center">
                        {r.permissions.includes(p) ? (
                          <span className="text-success" aria-label="Allowed">
                            ●
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40" aria-label="Not allowed">
                            –
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Loadable>
      </Card>
    </>
  );
}
