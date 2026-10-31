import { Printer } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { bpsToPercent, dateTime, money, qty } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ReceiptData } from '@/types';

type Paper = '58mm' | '80mm' | 'A4';

const Row = ({ l, r, bold }: { l: React.ReactNode; r: React.ReactNode; bold?: boolean }) => (
  <div className={cn('flex justify-between gap-2', bold && 'font-bold')}>
    <span>{l}</span>
    <span className="tabular text-right">{r}</span>
  </div>
);
const Rule = () => <div className="my-1.5 border-t border-dashed border-black" />;

/** Receipt / invoice markup. Rendered on screen as a preview and printed through the browser's print dialog. */
export function ReceiptSheet({ data, paper }: { data: ReceiptData; paper: Paper }) {
  const { store, sale, receipt } = data;
  const tz = store.timezone ?? 'Asia/Colombo';
  const narrow = paper !== 'A4';
  const payments = sale.payments;
  return (
    <div
      className={cn(
        'print-area receipt-sheet mx-auto bg-white p-3 text-[12px] leading-tight shadow-card',
        `receipt-${paper === '58mm' ? '58' : paper === '80mm' ? '80' : 'A4'}`,
        paper === '58mm' && 'text-[10px]',
        paper === 'A4' && 'p-10 text-[13px]',
      )}
      data-testid="receipt"
    >
      <div className="text-center">
        {store.logoUrl && paper === 'A4' && (
          <img src={store.logoUrl} alt="" className="mx-auto mb-2 h-14 object-contain" />
        )}
        <div className={cn('font-bold', narrow ? 'text-sm' : 'text-xl')}>{store.name}</div>
        {store.address && <div>{store.address}</div>}
        {(store.phone || store.email) && <div>{[store.phone, store.email].filter(Boolean).join(' · ')}</div>}
        {store.taxId && <div>Tax ID: {store.taxId}</div>}
      </div>
      <Rule />
      <Row l="Receipt" r={sale.receiptNo} bold />
      <Row l="Date" r={dateTime(sale.createdAt, tz)} />
      <Row l="Cashier" r={sale.cashierName} />
      {sale.registerName && <Row l="Register" r={sale.registerName} />}
      {sale.customerName && <Row l="Customer" r={sale.customerName} />}
      <Rule />
      {paper === 'A4' ? (
        <table className="w-full">
          <thead>
            <tr className="border-b border-black text-left">
              <th>Item</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Unit</th>
              <th className="text-right">Discount</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {sale.items.map((i) => (
              <tr key={i._id}>
                <td className="py-1">
                  {i.name}
                  <div className="text-[11px] text-neutral-600">{i.sku}</div>
                </td>
                <td className="text-right tabular">
                  {qty(i.qtyMilli)} {i.unitSymbol}
                </td>
                <td className="text-right tabular">{money(i.unitPriceCents)}</td>
                <td className="text-right tabular">
                  {i.lineDiscountCents + i.orderDiscountShareCents
                    ? `-${money(i.lineDiscountCents + i.orderDiscountShareCents)}`
                    : ''}
                </td>
                <td className="text-right tabular">{money(i.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        sale.items.map((i) => (
          <div key={i._id} className="mb-1">
            <div>{i.name}</div>
            <Row
              l={`  ${qty(i.qtyMilli)} ${i.unitSymbol ?? ''} x ${money(i.unitPriceCents)}`}
              r={money(i.grossCents)}
            />
            {i.lineDiscountCents + i.orderDiscountShareCents > 0 && (
              <Row
                l={`  ${i.discountNote ?? 'Discount'}`}
                r={`-${money(i.lineDiscountCents + i.orderDiscountShareCents)}`}
              />
            )}
          </div>
        ))
      )}
      <Rule />
      <Row l="Subtotal" r={money(sale.subtotalCents)} />
      {sale.discountCents > 0 && <Row l="Discounts" r={`-${money(sale.discountCents)}`} />}
      {sale.taxBreakdown.map((t) => (
        <Row
          key={`${t.code}${t.rateBps}`}
          l={`${t.code || 'Tax'} ${bpsToPercent(t.rateBps)}${sale.priceIncludesTax ? ' (incl.)' : ''} on ${money(t.taxableCents)}`}
          r={money(t.taxCents)}
        />
      ))}
      <Row l="TOTAL" r={money(sale.totalCents)} bold />
      <Rule />
      {payments.map((p, i) => (
        <Row
          key={i}
          l={`${p.method === 'CASH' ? 'Cash' : 'Card'}${p.reference ? ` (${p.reference})` : ''}`}
          r={money(p.method === 'CASH' ? (p.tenderedCents ?? p.amountCents) : p.amountCents)}
        />
      ))}
      {sale.changeCents > 0 && <Row l="Change" r={money(sale.changeCents)} bold />}
      {sale.refundedCents > 0 && <Row l="Refunded to date" r={money(sale.refundedCents)} />}
      <Rule />
      <div className="text-center">{receipt.footer}</div>
    </div>
  );
}

/** Preview with paper-size selector + browser print. Browser printing cannot control cutters or cash drawers (see docs). */
export function ReceiptPreview({ data }: { data: ReceiptData }) {
  const [paper, setPaper] = useState<Paper>(data.receipt.paperSize);
  return (
    <div className="space-y-3">
      <div className="no-print flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm">
          Paper
          <Select
            className="h-9 w-28"
            value={paper}
            onChange={(e) => setPaper(e.target.value as Paper)}
            aria-label="Paper size"
          >
            <option value="58mm">58 mm</option>
            <option value="80mm">80 mm</option>
            <option value="A4">A4 invoice</option>
          </Select>
        </label>
        <Button onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Print
        </Button>
      </div>
      <div className="max-h-[60vh] overflow-auto rounded-md bg-surface p-3">
        <ReceiptSheet data={data} paper={paper} />
      </div>
    </div>
  );
}
