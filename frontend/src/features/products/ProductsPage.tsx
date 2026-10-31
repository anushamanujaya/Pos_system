import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Plus, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { PageHeader, SearchInput, Toolbar } from '@/components/shared/bits';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Select } from '@/components/ui/form';
import { useList } from '@/hooks/useList';
import { download, errMsg, get, send } from '@/lib/api';
import { money, qty } from '@/lib/format';
import { useCan } from '@/stores/auth';
import type { Named, Product } from '@/types';

export function stockBadge(p: Pick<Product, 'onHandMilli' | 'reorderLevelMilli'>) {
  if (p.onHandMilli <= 0) return <Badge tone="danger">Out of stock</Badge>;
  if (p.onHandMilli <= p.reorderLevelMilli) return <Badge tone="warning">Low stock</Badge>;
  return <Badge tone="success">In stock</Badge>;
}

export function ProductsPage() {
  const nav = useNavigate();
  const canCreate = useCan('products.create');
  const [importOpen, setImportOpen] = useState(false);
  const list = useList<Product>('products', '/products', { sort: 'name', filters: { status: 'ACTIVE' } });
  const cats = useQuery({
    queryKey: ['categories-all'],
    queryFn: () => get<Named[]>('/categories', { all: 'true' }),
    staleTime: 60_000,
  });
  const brands = useQuery({
    queryKey: ['brands-all'],
    queryFn: () => get<Named[]>('/brands', { all: 'true' }),
    staleTime: 60_000,
  });

  const columns: Column<Product>[] = [
    {
      key: 'name',
      header: 'Product',
      sortKey: 'name',
      cell: (p) => (
        <div className="flex items-center gap-3">
          {p.imageUrl ? (
            <img src={p.imageUrl} alt="" className="h-9 w-9 rounded object-cover" />
          ) : (
            <div className="grid h-9 w-9 place-items-center rounded bg-surface text-xs text-muted-foreground">
              {p.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div>
            <p className="font-medium">{p.name}</p>
            <p className="text-xs text-muted-foreground">
              {p.sku}
              {p.barcode ? ` · ${p.barcode}` : ''}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'cat',
      header: 'Category',
      cell: (p) => (
        <span>
          {p.categoryName}
          {p.brandName ? <span className="text-muted-foreground"> · {p.brandName}</span> : null}
        </span>
      ),
    },
    {
      key: 'price',
      header: 'Price',
      sortKey: 'priceCents',
      align: 'right',
      cell: (p) => money(p.priceCents),
    },
    {
      key: 'cost',
      header: 'Cost',
      sortKey: 'costCents',
      align: 'right',
      cell: (p) => <span className="text-muted-foreground">{money(p.costCents)}</span>,
    },
    {
      key: 'stock',
      header: 'On hand',
      sortKey: 'onHandMilli',
      align: 'right',
      cell: (p) => (
        <span>
          {qty(p.onHandMilli)} {p.unitSymbol}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (p) => (p.status === 'ARCHIVED' ? <Badge tone="danger">Archived</Badge> : stockBadge(p)),
    },
  ];

  return (
    <>
      <PageHeader
        title="Products"
        description="Manage the catalogue, pricing and stock levels."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() =>
                download('/products/export', list.params, 'products.csv').catch((e) => toast.error(errMsg(e)))
              }
            >
              <Download className="h-4 w-4" /> Export CSV
            </Button>
            {canCreate && (
              <>
                <Button variant="outline" onClick={() => setImportOpen(true)}>
                  <Upload className="h-4 w-4" /> Import CSV
                </Button>
                <Button asChild>
                  <Link to="/products/new">
                    <Plus className="h-4 w-4" /> Add product
                  </Link>
                </Button>
              </>
            )}
          </>
        }
      />
      <Card>
        <Toolbar>
          <SearchInput
            className="w-full sm:w-72"
            value={list.q}
            onChange={list.setQ}
            placeholder="Search name, SKU or barcode"
          />
          <Select
            aria-label="Category"
            className="w-40"
            value={list.filters.category ?? ''}
            onChange={(e) => list.setFilter('category', e.target.value || undefined)}
          >
            <option value="">All categories</option>
            {cats.data?.data.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Brand"
            className="w-40"
            value={list.filters.brand ?? ''}
            onChange={(e) => list.setFilter('brand', e.target.value || undefined)}
          >
            <option value="">All brands</option>
            {brands.data?.data.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Stock status"
            className="w-36"
            value={list.filters.stock ?? ''}
            onChange={(e) => list.setFilter('stock', e.target.value || undefined)}
          >
            <option value="">Any stock</option>
            <option value="in">In stock</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
          </Select>
          <Select
            aria-label="Status"
            className="w-32"
            value={list.filters.status ?? ''}
            onChange={(e) => list.setFilter('status', e.target.value || undefined)}
          >
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="ARCHIVED">Archived</option>
          </Select>
        </Toolbar>
        <DataTable
          columns={columns}
          rows={list.rows}
          loading={list.isLoading}
          error={list.error}
          onRetry={list.refetch}
          meta={list.meta}
          onPage={list.setPage}
          sort={list.sort}
          onSort={list.setSort}
          fetching={list.isFetching}
          rowKey={(p) => p._id ?? p.id}
          onRowClick={(p) => nav(`/products/${p._id ?? p.id}`)}
          emptyTitle="No products found"
          emptyDescription="Add your first product or adjust the filters."
          emptyAction={
            canCreate ? (
              <Button asChild size="sm">
                <Link to="/products/new">Add product</Link>
              </Button>
            ) : undefined
          }
        />
      </Card>
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </>
  );
}

interface ImportResult {
  total: number;
  imported: number;
  failed: number;
  dryRun: boolean;
  errors: { row: number; sku?: string; message: string }[];
}
const TEMPLATE =
  'name,sku,barcode,category,brand,unit,cost,price,taxCode,reorderLevel,trackExpiry,description\nSample Item,SAMPLE-001,4790000999990,Groceries,Sample Brand,Piece,100.00,150.00,,10,false,Example row';

function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState('');
  const [name, setName] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const run = useMutation({
    mutationFn: (dryRun: boolean) => send<ImportResult>('post', '/products/import', { csv, dryRun }),
    onSuccess: (r) => {
      setResult(r.data);
      if (!r.data.dryRun) {
        qc.invalidateQueries({ queryKey: ['products'] });
        toast.success(`${r.data.imported} products imported`);
      }
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setCsv('');
          setName('');
          setResult(null);
        }
      }}
    >
      <DialogContent
        title="Import products from CSV"
        description="Rows are validated one by one. Valid rows are imported; invalid rows are reported with their line number."
        size="lg"
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={file}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              aria-label="CSV file"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setCsv(await f.text());
                  setName(f.name);
                  setResult(null);
                }
              }}
            />
            <Button variant="outline" onClick={() => file.current?.click()}>
              <Upload className="h-4 w-4" /> Choose file
            </Button>
            <span className="text-sm text-muted-foreground">{name || 'No file selected'}</span>
            <Button
              variant="link"
              className="ml-auto"
              onClick={() => {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' }));
                a.download = 'products-template.csv';
                a.click();
              }}
            >
              Download template
            </Button>
          </div>
          {result && (
            <div className="space-y-2 rounded-md border p-3 text-sm" role="status">
              <p>
                <strong>{result.dryRun ? 'Validation:' : 'Import:'}</strong> {result.imported}{' '}
                {result.dryRun ? 'valid' : 'imported'}, {result.failed} rejected of {result.total} rows.
              </p>
              {result.errors.length > 0 && (
                <ul className="max-h-48 space-y-1 overflow-auto text-danger">
                  {result.errors.map((e) => (
                    <li key={e.row}>
                      Row {e.row}
                      {e.sku ? ` (${e.sku})` : ''}: {e.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={!csv}
            loading={run.isPending && run.variables === true}
            onClick={() => run.mutate(true)}
          >
            Validate only
          </Button>
          <Button
            disabled={!csv}
            loading={run.isPending && run.variables === false}
            onClick={() => run.mutate(false)}
          >
            Import valid rows
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
