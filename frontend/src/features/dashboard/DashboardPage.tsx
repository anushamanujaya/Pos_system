import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { PackagePlus, ScanBarcode, ReceiptText, ClipboardList } from 'lucide-react';
import { useState } from 'react';
import { Donut, ChartBox, MoneyBars, MoneyLines } from '@/components/shared/charts';
import { PageHeader, StatCard } from '@/components/shared/bits';
import { Loadable } from '@/components/shared/states';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/form';
import { get } from '@/lib/api';
import { addDaysIso, dateStr, dateTime, isoDay, money, qty, titleCase } from '@/lib/format';
import type { SalesSummary, Series } from '@/types';

interface Dash {
  range: { from: string; to: string; today: string };
  summary: SalesSummary;
  trends: { daily: Series[]; weekly: Series[]; monthly: Series[] };
  categories: { category: string; revenueCents: number }[];
  payments: { method: string; amountCents: number }[];
  topProducts: { product: string; name: string; qtyMilli: number; revenueCents: number }[];
  recentSales: {
    _id: string;
    receiptNo: string;
    totalCents: number;
    cashierName: string;
    createdAt: string;
    status: string;
  }[];
  stock: { lowStock: number; outOfStock: number; expiring: number; expired: number };
  openShifts: {
    _id: string;
    register: { name: string };
    cashier: { name: string };
    openedAt: string;
    openingFloatCents: number;
  }[];
  expiring: {
    _id: string;
    batchNo: string;
    expiryDate: string;
    remainingMilli: number;
    product: { name: string };
  }[];
  lowStock: { id: string; name: string; onHandMilli: number; reorderLevelMilli: number }[];
}

export function DashboardPage() {
  const today = isoDay();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [trend, setTrend] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const q = useQuery({
    queryKey: ['dashboard', from, to],
    queryFn: () => get<Dash>('/reports/dashboard', { from, to }),
    refetchInterval: 60_000,
  });
  const d = q.data?.data;
  const s = d?.summary;
  const preset = (days: number) => {
    setFrom(addDaysIso(today, -days));
    setTo(today);
  };

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={
          d
            ? `Figures for ${dateStr(d.range.from)}${d.range.from !== d.range.to ? ` – ${dateStr(d.range.to)}` : ''} (Asia/Colombo)`
            : undefined
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => preset(0)}>
              Today
            </Button>
            <Button variant="outline" size="sm" onClick={() => preset(6)}>
              7 days
            </Button>
            <Button variant="outline" size="sm" onClick={() => preset(29)}>
              30 days
            </Button>
            <Input
              aria-label="From date"
              type="date"
              className="h-8 w-36"
              value={from}
              max={to}
              onChange={(e) => e.target.value && setFrom(e.target.value)}
            />
            <Input
              aria-label="To date"
              type="date"
              className="h-8 w-36"
              value={to}
              min={from}
              onChange={(e) => e.target.value && setTo(e.target.value)}
            />
          </div>
        }
      />
      <Loadable loading={q.isLoading} error={q.error} onRetry={q.refetch}>
        {d && s && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Gross sales"
                value={money(s.grossSalesCents)}
                hint={`Net after refunds ${money(s.netSalesCents)}`}
              />
              <StatCard
                label="Net sales (ex. tax)"
                value={money(s.netSalesExTaxCents)}
                hint={`Refunds ${money(s.refundCents)}`}
              />
              <StatCard
                label="Transactions"
                value={s.transactionCount}
                hint={`Average ${money(s.averageTransactionCents)}`}
              />
              <StatCard
                label="Gross profit (est.)"
                value={money(s.grossProfitCents)}
                hint="Net sales ex. tax − cost of goods"
                tone="success"
              />
              <StatCard
                label="Low stock"
                value={d.stock.lowStock}
                tone={d.stock.lowStock ? 'warning' : undefined}
                hint={
                  <Link className="text-primary hover:underline" to="/inventory?tab=low">
                    View list
                  </Link>
                }
              />
              <StatCard
                label="Out of stock"
                value={d.stock.outOfStock}
                tone={d.stock.outOfStock ? 'danger' : undefined}
              />
              <StatCard
                label="Expiring soon"
                value={d.stock.expiring}
                tone={d.stock.expiring ? 'warning' : undefined}
                hint={`${d.stock.expired} batches already expired`}
              />
              <StatCard
                label="Open registers"
                value={d.openShifts.length}
                hint={d.openShifts.map((x) => x.cashier.name).join(', ') || 'None open'}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardBody>
                  <div className="mb-1 flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Revenue vs cost</h3>
                    <Select
                      aria-label="Trend period"
                      className="h-8 w-32"
                      value={trend}
                      onChange={(e) => setTrend(e.target.value as typeof trend)}
                    >
                      <option value="daily">Last 30 days</option>
                      <option value="weekly">Last 12 weeks</option>
                      <option value="monthly">Last 12 months</option>
                    </Select>
                  </div>
                  <ChartBox title={`Sales trend (${trend})`} empty={d.trends[trend].length === 0}>
                    <MoneyLines
                      xKey="period"
                      data={d.trends[trend] as unknown as Record<string, string | number>[]}
                      series={[
                        { key: 'netSalesExTaxCents', name: 'Net sales (ex. tax)' },
                        { key: 'cogsCents', name: 'Cost of goods' },
                      ]}
                    />
                  </ChartBox>
                </CardBody>
              </Card>
              <Card>
                <CardBody>
                  <ChartBox title="Payment methods" empty={d.payments.length === 0}>
                    <Donut
                      data={d.payments.map((p) => ({ name: titleCase(p.method), value: p.amountCents }))}
                    />
                  </ChartBox>
                </CardBody>
              </Card>
              <Card className="lg:col-span-2">
                <CardBody>
                  <ChartBox title="Sales by category" empty={d.categories.length === 0}>
                    <MoneyBars
                      horizontal
                      xKey="category"
                      yKey="revenueCents"
                      name="Revenue"
                      data={d.categories.slice(0, 8)}
                    />
                  </ChartBox>
                </CardBody>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Top-selling products</CardTitle>
                </CardHeader>
                <ul className="divide-y">
                  {d.topProducts.length === 0 ? (
                    <li className="p-4 text-sm text-muted-foreground">No sales in this period.</li>
                  ) : (
                    d.topProducts.map((p, i) => (
                      <li
                        key={p.product}
                        className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="w-4 text-xs text-muted-foreground">{i + 1}</span>
                          <span className="truncate">{p.name}</span>
                        </span>
                        <span className="shrink-0 tabular text-muted-foreground">
                          {qty(p.qtyMilli)} · {money(p.revenueCents)}
                        </span>
                      </li>
                    ))
                  )}
                </ul>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle>Recent transactions</CardTitle>
                  <Button asChild variant="link" size="sm">
                    <Link to="/sales">All sales</Link>
                  </Button>
                </CardHeader>
                <ul className="divide-y">
                  {d.recentSales.length === 0 ? (
                    <li className="p-4 text-sm text-muted-foreground">No transactions yet.</li>
                  ) : (
                    d.recentSales.map((x) => (
                      <li key={x._id}>
                        <Link
                          to={`/sales/${x._id}`}
                          className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-surface/60"
                        >
                          <span>
                            <span className="font-medium">{x.receiptNo}</span>
                            <span className="block text-xs text-muted-foreground">
                              {dateTime(x.createdAt)} · {x.cashierName}
                            </span>
                          </span>
                          <span className="tabular">{money(x.totalCents)}</span>
                        </Link>
                      </li>
                    ))
                  )}
                </ul>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Inventory alerts</CardTitle>
                </CardHeader>
                <ul className="divide-y">
                  {d.lowStock.length === 0 && d.expiring.length === 0 ? (
                    <li className="p-4 text-sm text-muted-foreground">No alerts.</li>
                  ) : (
                    <>
                      {d.lowStock.map((p) => (
                        <li key={p.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                          <span className="truncate">{p.name}</span>
                          <Badge tone={p.onHandMilli <= 0 ? 'danger' : 'warning'}>
                            {p.onHandMilli <= 0 ? 'Out' : `${qty(p.onHandMilli)} left`}
                          </Badge>
                        </li>
                      ))}
                      {d.expiring.map((b) => (
                        <li key={b._id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                          <span className="truncate">
                            {b.product.name}{' '}
                            <span className="text-xs text-muted-foreground">({b.batchNo})</span>
                          </span>
                          <Badge tone={new Date(b.expiryDate) < new Date() ? 'danger' : 'warning'}>
                            Exp {dateStr(b.expiryDate)}
                          </Badge>
                        </li>
                      ))}
                    </>
                  )}
                </ul>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Quick actions</CardTitle>
                </CardHeader>
                <CardBody className="grid grid-cols-2 gap-2">
                  <Button asChild variant="outline">
                    <Link to="/pos">
                      <ScanBarcode className="h-4 w-4" /> Open POS
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link to="/products/new">
                      <PackagePlus className="h-4 w-4" /> Add product
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link to="/purchases/new">
                      <ClipboardList className="h-4 w-4" /> New PO
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link to="/reports">
                      <ReceiptText className="h-4 w-4" /> Reports
                    </Link>
                  </Button>
                </CardBody>
                {d.openShifts.length > 0 && (
                  <div className="border-t px-4 py-3 text-xs text-muted-foreground">
                    {d.openShifts.map((x) => (
                      <p key={x._id}>
                        {x.register.name}: {x.cashier.name} since {dateTime(x.openedAt)}
                      </p>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}
      </Loadable>
    </>
  );
}
