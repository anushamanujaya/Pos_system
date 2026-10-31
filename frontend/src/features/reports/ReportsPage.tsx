import * as Tabs from '@radix-ui/react-tabs';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ChartBox, Donut, MoneyBars, MoneyLines } from '@/components/shared/charts';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { PageHeader, StatCard } from '@/components/shared/bits';
import { Loadable } from '@/components/shared/states';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/form';
import { download, errMsg, get } from '@/lib/api';
import { addDaysIso, dateStr, dateTime, isoDay, money, qty, titleCase } from '@/lib/format';
import type { SalesSummary, Series } from '@/types';

const TABS = [
  ['sales', 'Sales'],
  ['products', 'Products'],
  ['profit', 'Profit'],
  ['inventory', 'Inventory'],
  ['purchases', 'Purchases'],
  ['cashiers', 'Cashiers'],
  ['reconciliation', 'Cash reconciliation'],
] as const;
type Tab = (typeof TABS)[number][0];

export function ReportsPage() {
  const today = isoDay();
  const [tab, setTab] = useState<Tab>('sales');
  const [from, setFrom] = useState(addDaysIso(today, -29));
  const [to, setTo] = useState(today);
  const [bucket, setBucket] = useState<'day' | 'week' | 'month'>('day');
  const params = { from, to, bucket };
  const exportCsv = () =>
    download(`/reports/${tab}`, { ...params, format: 'csv' }, `${tab}-report.csv`).catch((e) =>
      toast.error(errMsg(e)),
    );

  return (
    <>
      <PageHeader
        title="Reports"
        description="Computed on the server from persisted sales, returns, purchases and stock."
        actions={
          <>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Print
            </Button>
            <Button variant="outline" onClick={exportCsv}>
              <Download className="h-4 w-4" /> Export CSV
            </Button>
          </>
        }
      />
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          From{' '}
          <Input
            type="date"
            className="w-40"
            value={from}
            max={to}
            onChange={(e) => e.target.value && setFrom(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          To{' '}
          <Input
            type="date"
            className="w-40"
            value={to}
            min={from}
            onChange={(e) => e.target.value && setTo(e.target.value)}
          />
        </label>
        <Select
          aria-label="Group by"
          className="w-32"
          value={bucket}
          onChange={(e) => setBucket(e.target.value as typeof bucket)}
        >
          <option value="day">By day</option>
          <option value="week">By week</option>
          <option value="month">By month</option>
        </Select>
      </div>
      <Tabs.Root value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <Tabs.List className="no-print mb-4 flex gap-1 overflow-x-auto border-b" aria-label="Report type">
          {TABS.map(([v, l]) => (
            <Tabs.Trigger
              key={v}
              value={v}
              className="-mb-px shrink-0 border-b-2 border-transparent px-4 py-2 text-sm font-medium text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-primary"
            >
              {l}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <div className="report-print print-area">
          <div className="print-only mb-3">
            <h1 className="text-lg font-semibold">
              {TABS.find(([v]) => v === tab)?.[1]} report
            </h1>
            <p className="text-xs">
              {dateStr(from)} – {dateStr(to)}
            </p>
          </div>
          <Tabs.Content value="sales">
            <SalesReport params={params} />
          </Tabs.Content>
          <Tabs.Content value="products">
            <ProductsReport params={params} />
          </Tabs.Content>
          <Tabs.Content value="profit">
            <ProfitReport params={params} />
          </Tabs.Content>
          <Tabs.Content value="inventory">
            <InventoryReport />
          </Tabs.Content>
          <Tabs.Content value="purchases">
            <PurchasesReport params={params} />
          </Tabs.Content>
          <Tabs.Content value="cashiers">
            <CashiersReport params={params} />
          </Tabs.Content>
          <Tabs.Content value="reconciliation">
            <ReconciliationReport params={params} />
          </Tabs.Content>
        </div>
      </Tabs.Root>
    </>
  );
}

type P = { params: { from: string; to: string; bucket: string } };
const useReport = <T,>(name: string, params: object) =>
  useQuery({ queryKey: ['report', name, params], queryFn: () => get<T>(`/reports/${name}`, params) });
const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <Card className="print-area-card">
    <CardHeader>
      <CardTitle>{title}</CardTitle>
    </CardHeader>
    {children}
  </Card>
);

const periodCols = (): Column<Series>[] => [
  { key: 'p', header: 'Period', cell: (r) => r.period },
  { key: 'c', header: 'Sales', align: 'right', cell: (r) => r.count },
  { key: 'g', header: 'Gross', align: 'right', cell: (r) => money(r.grossCents) },
  { key: 'd', header: 'Discounts', align: 'right', cell: (r) => money(r.discountCents) },
  { key: 'r', header: 'Refunds', align: 'right', cell: (r) => money(r.refundCents) },
  { key: 't', header: 'Tax', align: 'right', cell: (r) => money(r.taxCents) },
  { key: 'n', header: 'Net (ex. tax)', align: 'right', cell: (r) => money(r.netSalesExTaxCents) },
];

function SummaryStrip({ s }: { s: SalesSummary }) {
  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Gross sales"
        value={money(s.grossSalesCents)}
        hint={`${s.transactionCount} transactions`}
      />
      <StatCard label="Discounts given" value={money(s.discountCents)} />
      <StatCard label="Refunds" value={money(s.refundCents)} hint={`${s.refundCount} returns`} />
      <StatCard
        label="Tax collected"
        value={money(s.taxCents)}
        hint="Net of refunds shown in profit report"
      />
    </div>
  );
}

function SalesReport({ params }: P) {
  const q = useReport<{
    summary: SalesSummary;
    series: Series[];
    byCategory: { category: string; revenueCents: number; qtyMilli: number }[];
    payments: { method: string; amountCents: number }[];
  }>('sales', params);
  const d = q.data?.data;
  return (
    <Loadable loading={q.isLoading} error={q.error} onRetry={q.refetch}>
      {d && (
        <div className="space-y-4">
          <SummaryStrip s={d.summary} />
          <Card>
            <CardBody>
              <ChartBox title="Net sales over time" empty={d.series.length === 0}>
                <MoneyLines
                  xKey="period"
                  data={d.series as unknown as Record<string, string | number>[]}
                  series={[{ key: 'netSalesCents', name: 'Net sales' }]}
                />
              </ChartBox>
            </CardBody>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Sales by period">
              <DataTable
                columns={periodCols()}
                rows={d.series}
                rowKey={(r) => r.period}
                emptyTitle="No sales in this range"
              />
            </Section>
            <Card>
              <CardBody className="space-y-4">
                <ChartBox title="Payment methods" empty={d.payments.length === 0}>
                  <Donut
                    data={d.payments.map((p) => ({ name: titleCase(p.method), value: p.amountCents }))}
                  />
                </ChartBox>
              </CardBody>
            </Card>
          </div>
          <Section title="Category performance">
            <DataTable
              rowKey={(r) => r.category}
              rows={d.byCategory}
              emptyTitle="No data"
              columns={[
                { key: 'c', header: 'Category', cell: (r) => r.category },
                { key: 'q', header: 'Units', align: 'right', cell: (r) => qty(r.qtyMilli) },
                { key: 'r', header: 'Revenue', align: 'right', cell: (r) => money(r.revenueCents) },
              ]}
            />
          </Section>
        </div>
      )}
    </Loadable>
  );
}

function ProductsReport({ params }: P) {
  const [sort, setSort] = useState('revenueCents');
  const q = useReport<{
    rows: {
      product: string;
      name: string;
      sku: string;
      qtyMilli: number;
      revenueCents: number;
      cogsCents: number;
      profitCents: number;
    }[];
  }>('products', { ...params, sort, limit: 100 });
  return (
    <Section title="Product performance">
      <div className="no-print border-b p-3">
        <Select aria-label="Rank by" className="w-48" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="revenueCents">Rank by revenue</option>
          <option value="qtyMilli">Rank by units sold</option>
          <option value="profitCents">Rank by profit</option>
        </Select>
      </div>
      <p className="px-4 pt-3 text-xs text-muted-foreground">
        Quantities and revenue are net of returned units for sales made in the selected range.
      </p>
      <Loadable loading={q.isLoading} error={q.error} onRetry={q.refetch}>
        <DataTable
          rows={q.data?.data.rows ?? []}
          rowKey={(r) => r.product}
          emptyTitle="No product sales in this range"
          columns={[
            {
              key: 'n',
              header: 'Product',
              cell: (r) => (
                <div>
                  <p className="font-medium">{r.name}</p>
                  <p className="text-xs text-muted-foreground">{r.sku}</p>
                </div>
              ),
            },
            { key: 'q', header: 'Units sold', align: 'right', cell: (r) => qty(r.qtyMilli) },
            { key: 'r', header: 'Revenue', align: 'right', cell: (r) => money(r.revenueCents) },
            { key: 'c', header: 'Cost', align: 'right', cell: (r) => money(r.cogsCents) },
            { key: 'p', header: 'Gross profit', align: 'right', cell: (r) => money(r.profitCents) },
          ]}
        />
      </Loadable>
    </Section>
  );
}

function ProfitReport({ params }: P) {
  const q = useReport<{ summary: SalesSummary; series: Series[]; note: string }>('profit', params);
  const d = q.data?.data;
  return (
    <Loadable loading={q.isLoading} error={q.error} onRetry={q.refetch}>
      {d && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Net sales (ex. tax)" value={money(d.summary.netSalesExTaxCents)} />
            <StatCard label="Cost of goods sold" value={money(d.summary.cogsCents)} />
            <StatCard label="Gross profit" value={money(d.summary.grossProfitCents)} tone="success" />
            <StatCard
              label="Gross margin"
              value={
                d.summary.netSalesExTaxCents
                  ? `${((d.summary.grossProfitCents / d.summary.netSalesExTaxCents) * 100).toFixed(1)}%`
                  : '—'
              }
            />
          </div>
          <p className="rounded-md bg-surface px-4 py-3 text-sm text-muted-foreground">
            {d.note} Refunds reduce the period they are paid in; restocked returns reverse their cost, damaged
            returns do not.
          </p>
          <Card>
            <CardBody>
              <ChartBox title="Revenue vs cost" empty={d.series.length === 0}>
                <MoneyLines
                  xKey="period"
                  data={d.series as unknown as Record<string, string | number>[]}
                  series={[
                    { key: 'netSalesExTaxCents', name: 'Net sales (ex. tax)' },
                    { key: 'cogsCents', name: 'Cost of goods' },
                  ]}
                />
              </ChartBox>
            </CardBody>
          </Card>
          <Section title="Profit by period">
            <DataTable
              rows={d.series}
              rowKey={(r) => r.period}
              columns={[
                { key: 'p', header: 'Period', cell: (r) => r.period },
                {
                  key: 'n',
                  header: 'Net (ex. tax)',
                  align: 'right',
                  cell: (r) => money(r.netSalesExTaxCents),
                },
                { key: 'c', header: 'COGS', align: 'right', cell: (r) => money(r.cogsCents) },
                { key: 'g', header: 'Gross profit', align: 'right', cell: (r) => money(r.grossProfitCents) },
              ]}
            />
          </Section>
        </div>
      )}
    </Loadable>
  );
}

function InventoryReport() {
  const q = useReport<{
    low: {
      id: string;
      name: string;
      sku: string;
      category: string;
      onHandMilli: number;
      reorderLevelMilli: number;
    }[];
    expiring: {
      _id: string;
      batchNo: string;
      expiryDate: string;
      remainingMilli: number;
      product: { name: string; sku: string; costCents: number };
    }[];
    value: { costValueCents: number; retailValueCents: number };
    counts: { lowStock: number; outOfStock: number; expiring: number; expired: number };
  }>('inventory', { days: 30 });
  const d = q.data?.data;
  return (
    <Loadable loading={q.isLoading} error={q.error} onRetry={q.refetch}>
      {d && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Stock value (cost)" value={money(d.value.costValueCents)} />
            <StatCard label="Stock value (retail)" value={money(d.value.retailValueCents)} />
            <StatCard label="Low / out of stock" value={`${d.counts.lowStock} / ${d.counts.outOfStock}`} />
            <StatCard
              label="Expiring / expired batches"
              value={`${d.counts.expiring} / ${d.counts.expired}`}
            />
          </div>
          <Section title="Low-stock products">
            <DataTable
              rows={d.low}
              rowKey={(r) => r.id}
              emptyTitle="Nothing is running low"
              columns={[
                {
                  key: 'n',
                  header: 'Product',
                  cell: (r) => (
                    <div>
                      <p className="font-medium">{r.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.sku} · {r.category}
                      </p>
                    </div>
                  ),
                },
                { key: 'o', header: 'On hand', align: 'right', cell: (r) => qty(r.onHandMilli) },
                { key: 'r', header: 'Reorder at', align: 'right', cell: (r) => qty(r.reorderLevelMilli) },
              ]}
            />
          </Section>
          <Section title="Expiring within 30 days">
            <DataTable
              rows={d.expiring}
              rowKey={(r) => r._id}
              emptyTitle="No batches expiring soon"
              columns={[
                { key: 'n', header: 'Product', cell: (r) => r.product.name },
                { key: 'b', header: 'Batch', cell: (r) => r.batchNo },
                { key: 'e', header: 'Expiry', cell: (r) => dateStr(r.expiryDate) },
                { key: 'q', header: 'Remaining', align: 'right', cell: (r) => qty(r.remainingMilli) },
                {
                  key: 'v',
                  header: 'Cost at risk',
                  align: 'right',
                  cell: (r) => money(Math.round((r.remainingMilli * r.product.costCents) / 1000)),
                },
              ]}
            />
          </Section>
        </div>
      )}
    </Loadable>
  );
}

function PurchasesReport({ params }: P) {
  const q = useReport<{
    bySupplier: {
      supplier: string;
      name: string;
      orders: number;
      orderedCents: number;
      receivedCents: number;
      receipts: number;
    }[];
    totalOrderedCents: number;
    totalReceivedCents: number;
  }>('purchases', params);
  const d = q.data?.data;
  return (
    <Loadable loading={q.isLoading} error={q.error} onRetry={q.refetch}>
      {d && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <StatCard label="Ordered" value={money(d.totalOrderedCents)} />
            <StatCard label="Received into stock" value={money(d.totalReceivedCents)} />
          </div>
          <Card>
            <CardBody>
              <ChartBox title="Ordered value by supplier" empty={d.bySupplier.length === 0}>
                <MoneyBars horizontal xKey="name" yKey="orderedCents" name="Ordered" data={d.bySupplier} />
              </ChartBox>
            </CardBody>
          </Card>
          <Section title="Supplier purchase totals">
            <DataTable
              rows={d.bySupplier}
              rowKey={(r) => r.supplier}
              emptyTitle="No purchases in this range"
              columns={[
                { key: 'n', header: 'Supplier', cell: (r) => r.name },
                { key: 'o', header: 'Orders', align: 'right', cell: (r) => r.orders },
                { key: 'v', header: 'Ordered', align: 'right', cell: (r) => money(r.orderedCents) },
                { key: 'r', header: 'Receipts', align: 'right', cell: (r) => r.receipts },
                { key: 'rv', header: 'Received value', align: 'right', cell: (r) => money(r.receivedCents) },
              ]}
            />
          </Section>
        </div>
      )}
    </Loadable>
  );
}

function CashiersReport({ params }: P) {
  const q = useReport<{
    rows: {
      cashier: string;
      name: string;
      transactionCount: number;
      grossCents: number;
      discountCents: number;
      refundCents: number;
      averageCents: number;
    }[];
  }>('cashiers', params);
  return (
    <Loadable loading={q.isLoading} error={q.error} onRetry={q.refetch}>
      <Section title="Sales by cashier">
        <DataTable
          rows={q.data?.data.rows ?? []}
          rowKey={(r) => r.cashier}
          emptyTitle="No sales in this range"
          columns={[
            { key: 'n', header: 'Cashier', cell: (r) => r.name },
            { key: 't', header: 'Transactions', align: 'right', cell: (r) => r.transactionCount },
            { key: 'g', header: 'Gross sales', align: 'right', cell: (r) => money(r.grossCents) },
            { key: 'd', header: 'Discounts', align: 'right', cell: (r) => money(r.discountCents) },
            { key: 'r', header: 'Refunds', align: 'right', cell: (r) => money(r.refundCents) },
            { key: 'a', header: 'Average', align: 'right', cell: (r) => money(r.averageCents) },
          ]}
        />
      </Section>
    </Loadable>
  );
}

function ReconciliationReport({ params }: P) {
  const q = useReport<{
    rows: {
      _id: string;
      register: { name: string };
      cashier: { name: string };
      closedAt: string;
      openingFloatCents: number;
      expectedCashCents: number;
      countedCashCents: number;
      varianceCents: number;
    }[];
  }>('reconciliation', params);
  return (
    <Loadable loading={q.isLoading} error={q.error} onRetry={q.refetch}>
      <Section title="Closed shifts">
        <DataTable
          rows={q.data?.data.rows ?? []}
          rowKey={(r) => r._id}
          emptyTitle="No shifts closed in this range"
          columns={[
            { key: 'r', header: 'Register', cell: (r) => r.register?.name },
            { key: 'c', header: 'Cashier', cell: (r) => r.cashier?.name },
            { key: 'cl', header: 'Closed', cell: (r) => dateTime(r.closedAt) },
            { key: 'f', header: 'Float', align: 'right', cell: (r) => money(r.openingFloatCents) },
            { key: 'e', header: 'Expected', align: 'right', cell: (r) => money(r.expectedCashCents) },
            { key: 'ct', header: 'Counted', align: 'right', cell: (r) => money(r.countedCashCents) },
            {
              key: 'v',
              header: 'Variance',
              align: 'right',
              cell: (r) => (
                <span
                  className={
                    r.varianceCents < 0
                      ? 'text-danger'
                      : r.varianceCents > 0
                        ? 'text-warning'
                        : 'text-success'
                  }
                >
                  {money(r.varianceCents)}
                </span>
              ),
            },
          ]}
        />
      </Section>
    </Loadable>
  );
}
