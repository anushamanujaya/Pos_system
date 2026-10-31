import * as Tabs from '@radix-ui/react-tabs';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { PageHeader, SearchInput, Toolbar } from '@/components/shared/bits';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { useList } from '@/hooks/useList';
import { useSave } from '@/hooks/useSave';
import { useCan } from '@/stores/auth';
import type { Named, Unit } from '@/types';

type Entity = Named & { symbol?: string; decimals?: number; baseUnit?: string; factor?: number };
interface Cfg {
  key: 'categories' | 'brands' | 'units';
  label: string;
  singular: string;
}
const CFG: Cfg[] = [
  { key: 'categories', label: 'Categories', singular: 'category' },
  { key: 'brands', label: 'Brands', singular: 'brand' },
  { key: 'units', label: 'Units', singular: 'unit' },
];

export function CatalogPage() {
  return (
    <>
      <PageHeader
        title="Categories, brands & units"
        description="Organise the catalogue. Items that are in use are deactivated rather than deleted."
      />
      <Tabs.Root defaultValue="categories">
        <Tabs.List className="mb-4 flex gap-1 border-b" aria-label="Catalogue sections">
          {CFG.map((c) => (
            <Tabs.Trigger
              key={c.key}
              value={c.key}
              className="-mb-px border-b-2 border-transparent px-4 py-2 text-sm font-medium text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-primary"
            >
              {c.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {CFG.map((c) => (
          <Tabs.Content key={c.key} value={c.key}>
            <EntityPanel cfg={c} />
          </Tabs.Content>
        ))}
      </Tabs.Root>
    </>
  );
}

function EntityPanel({ cfg }: { cfg: Cfg }) {
  const canManage = useCan('catalog.manage');
  const list = useList<Entity>(cfg.key, `/${cfg.key}`, { limit: 50 });
  const allUnits = useList<Unit>('units-pick', '/units', { limit: 100 }, cfg.key === 'units');
  const [editing, setEditing] = useState<Entity | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Entity | null>(null);
  const del = useSave({
    method: 'delete',
    url: () => `/${cfg.key}/${deleting?._id}`,
    invalidate: [cfg.key, `${cfg.key}-all`],
    success: `${cfg.label.slice(0, -1)} deleted`,
    onDone: () => setDeleting(null),
  });

  const cols: Column<Entity>[] = [
    {
      key: 'name',
      header: 'Name',
      cell: (e) => (
        <span className="font-medium">
          {e.name}
          {e.symbol ? <span className="text-muted-foreground"> ({e.symbol})</span> : null}
        </span>
      ),
    },
    ...(cfg.key === 'units'
      ? [
          { key: 'dec', header: 'Decimals', cell: (e: Entity) => e.decimals, align: 'right' as const },
          {
            key: 'conv',
            header: 'Conversion',
            cell: (e: Entity) => {
              const b = allUnits.rows.find((u) => u._id === e.baseUnit);
              return b ? `1 ${e.symbol} = ${e.factor} ${b.symbol}` : '—';
            },
          },
        ]
      : [
          {
            key: 'desc',
            header: 'Description',
            cell: (e: Entity) => <span className="text-muted-foreground">{e.description ?? '—'}</span>,
          },
        ]),
    { key: 'n', header: 'Products', align: 'right', cell: (e) => e.productCount },
    {
      key: 'st',
      header: 'Status',
      cell: (e) => (
        <Badge tone={e.active === false ? 'neutral' : 'success'}>
          {e.active === false ? 'Inactive' : 'Active'}
        </Badge>
      ),
    },
    ...(canManage
      ? [
          {
            key: 'a',
            header: '',
            align: 'right' as const,
            cell: (e: Entity) => (
              <div className="flex justify-end gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Edit ${e.name}`}
                  onClick={() => setEditing(e)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${e.name}`}
                  onClick={() => setDeleting(e)}
                >
                  <Trash2 className="h-4 w-4 text-danger" />
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];
  return (
    <Card>
      <Toolbar>
        <SearchInput
          className="w-full sm:w-64"
          value={list.q}
          onChange={list.setQ}
          placeholder={`Search ${cfg.label.toLowerCase()}`}
        />
        {canManage && (
          <Button className="ml-auto" onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" /> Add {cfg.singular}
          </Button>
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
        rowKey={(e) => e._id}
        emptyTitle={`No ${cfg.label.toLowerCase()} yet`}
      />
      {editing && (
        <EntityDialog
          cfg={cfg}
          entity={editing === 'new' ? undefined : editing}
          units={allUnits.rows}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${cfg.singular}?`}
        loading={del.isPending}
        description={`“${deleting?.name}” will be removed permanently. If products use it the server will refuse; deactivate it instead.`}
        confirmLabel="Delete"
        onConfirm={() => del.mutate(undefined)}
      />
    </Card>
  );
}

function EntityDialog({
  cfg,
  entity,
  units,
  onClose,
}: {
  cfg: Cfg;
  entity?: Entity;
  units: Unit[];
  onClose: () => void;
}) {
  const isUnit = cfg.key === 'units';
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<{
    name: string;
    description: string;
    active: boolean;
    symbol: string;
    decimals: string;
    baseUnit: string;
    factor: string;
  }>({
    defaultValues: {
      name: entity?.name ?? '',
      description: entity?.description ?? '',
      active: entity?.active ?? true,
      symbol: entity?.symbol ?? '',
      decimals: String(entity?.decimals ?? 0),
      baseUnit: entity?.baseUnit ?? '',
      factor: String(entity?.factor ?? 1),
    },
  });
  const save = useSave<Record<string, unknown>>({
    method: entity ? 'patch' : 'post',
    url: `/${cfg.key}${entity ? `/${entity._id}` : ''}`,
    invalidate: [cfg.key, `${cfg.key}-all`],
    success: `${cfg.singular[0].toUpperCase()}${cfg.singular.slice(1)} saved`,
    onDone: onClose,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`${entity ? 'Edit' : 'Add'} ${cfg.singular}`} size="sm">
        <form
          noValidate
          className="space-y-4"
          onSubmit={handleSubmit((v) => {
            if (!v.name.trim()) return toast.error('Name is required');
            save.mutate(
              isUnit
                ? {
                    name: v.name,
                    symbol: v.symbol,
                    decimals: Number(v.decimals),
                    active: v.active,
                    ...(v.baseUnit ? { baseUnit: v.baseUnit, factor: Number(v.factor) } : {}),
                  }
                : { name: v.name, description: v.description, active: v.active },
            );
          })}
        >
          <Field label="Name" error={errors.name?.message}>
            <Input autoFocus {...register('name')} />
          </Field>
          {isUnit ? (
            <>
              <Field label="Symbol">
                <Input maxLength={10} {...register('symbol')} />
              </Field>
              <Field label="Decimal places" hint="0 for countable items (pieces); up to 3 for weight/volume.">
                <Select {...register('decimals')}>
                  {[0, 1, 2, 3].map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Converts to (optional)">
                <Select {...register('baseUnit')}>
                  <option value="">None</option>
                  {units
                    .filter((u) => u._id !== entity?._id)
                    .map((u) => (
                      <option key={u._id} value={u._id}>
                        {u.name}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label="Factor" hint="How many of the base unit equal one of this unit.">
                <Input inputMode="decimal" {...register('factor')} />
              </Field>
            </>
          ) : (
            <Field label="Description">
              <Input {...register('description')} />
            </Field>
          )}
          <Checkbox label="Active" {...register('active')} />
          <DialogFooter>
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
