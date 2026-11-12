/**
 * Development seed. `npm run seed` loads catalogue + stock + people; `npm run seed:demo` also generates
 * a week of real, persisted demo transactions through the same service code the POS uses
 * (so dashboards are computed from genuine records). Refuses to run in production.
 */
import mongoose from 'mongoose';
import { DEMO_DATABASE, env } from '../config/env';
import { checkout, priceRequest } from '../modules/sales/sales.service';
import { hashPassword } from '../modules/auth/auth.service';
import { connectDb, disconnectDb } from './connect';
import {
  Brand,
  CashRegister,
  CashShift,
  Category,
  Customer,
  GoodsReceipt,
  Product,
  PurchaseOrder,
  Supplier,
  Unit,
  User,
  InventoryBalance,
  Sale,
  StockMovement,
} from './models';
import { ensureBase } from './initAdmin';
import { getSettings, nextSeq, withTx } from '../services/common';
import { addStock, checkStockAlerts } from '../services/stock';
import { toMilli } from '../utils/money';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo@12345';

// name, sku, barcode, category, brand, unit, cost, price, taxCode, reorder, expiryDays (undefined = no expiry), stock
type Row = [
  string,
  string,
  string,
  string,
  string,
  string,
  number,
  number,
  string | undefined,
  number,
  number | undefined,
  number,
];
const PRODUCTS: Row[] = [
  [
    'Basmati Rice 5kg',
    'GRC-RICE-5K',
    '4790000000011',
    'Groceries',
    'Fictional Farms',
    'Pack',
    1850,
    2250,
    undefined,
    10,
    undefined,
    60,
  ],
  [
    'Samba Rice 1kg',
    'GRC-SAMBA-1K',
    '4790000000028',
    'Groceries',
    'Fictional Farms',
    'Pack',
    210,
    265,
    undefined,
    20,
    undefined,
    120,
  ],
  [
    'Red Lentils 500g',
    'GRC-DHAL-500',
    '4790000000035',
    'Groceries',
    'Fictional Farms',
    'Pack',
    260,
    320,
    undefined,
    15,
    undefined,
    80,
  ],
  [
    'Wheat Flour 1kg',
    'GRC-FLOUR-1K',
    '4790000000042',
    'Groceries',
    'Sample Mills',
    'Pack',
    190,
    235,
    undefined,
    15,
    undefined,
    90,
  ],
  [
    'White Sugar 1kg',
    'GRC-SUGAR-1K',
    '4790000000059',
    'Groceries',
    'Sample Mills',
    'Pack',
    245,
    295,
    undefined,
    20,
    undefined,
    100,
  ],
  [
    'Iodized Salt 400g',
    'GRC-SALT-400',
    '4790000000066',
    'Groceries',
    'Sample Mills',
    'Pack',
    70,
    95,
    undefined,
    20,
    undefined,
    70,
  ],
  [
    'Coconut Oil 1L',
    'GRC-COIL-1L',
    '4790000000073',
    'Groceries',
    'Demo Oils',
    'Piece',
    780,
    950,
    undefined,
    12,
    undefined,
    40,
  ],
  [
    'Sunflower Oil 1L',
    'GRC-SUNOIL-1L',
    '4790000000080',
    'Groceries',
    'Demo Oils',
    'Piece',
    690,
    850,
    undefined,
    12,
    undefined,
    35,
  ],
  [
    'Instant Noodles 5-pack',
    'GRC-NOOD-5P',
    '4790000000097',
    'Groceries',
    'QuickBite',
    'Pack',
    380,
    480,
    'VAT',
    15,
    undefined,
    85,
  ],
  [
    'Tomato Ketchup 400g',
    'GRC-KETCH-400',
    '4790000000103',
    'Groceries',
    'QuickBite',
    'Piece',
    310,
    395,
    'VAT',
    10,
    undefined,
    45,
  ],
  [
    'Black Tea 200g',
    'BEV-TEA-200',
    '4790000000110',
    'Beverages',
    'Hill Sample',
    'Pack',
    420,
    540,
    undefined,
    15,
    undefined,
    60,
  ],
  [
    'Instant Coffee 100g',
    'BEV-COF-100',
    '4790000000127',
    'Beverages',
    'Hill Sample',
    'Piece',
    890,
    1090,
    'VAT',
    8,
    undefined,
    30,
  ],
  [
    'Orange Juice 1L',
    'BEV-OJ-1L',
    '4790000000134',
    'Beverages',
    'FreshCo Demo',
    'Piece',
    340,
    430,
    'VAT',
    12,
    90,
    48,
  ],
  [
    'Mineral Water 1.5L',
    'BEV-WATER-15',
    '4790000000141',
    'Beverages',
    'AquaDemo',
    'Piece',
    80,
    110,
    undefined,
    30,
    undefined,
    200,
  ],
  [
    'Cola 1.5L',
    'BEV-COLA-15',
    '4790000000158',
    'Beverages',
    'FizzCo Demo',
    'Piece',
    230,
    295,
    'VAT',
    24,
    undefined,
    150,
  ],
  [
    'Ginger Beer 330ml',
    'BEV-GBEER-33',
    '4790000000165',
    'Beverages',
    'FizzCo Demo',
    'Piece',
    110,
    150,
    'VAT',
    24,
    undefined,
    96,
  ],
  [
    'Fresh Milk 1L',
    'DAI-MILK-1L',
    '4790000000172',
    'Dairy',
    'FreshCo Demo',
    'Piece',
    290,
    360,
    undefined,
    20,
    7,
    60,
  ],
  [
    'Yoghurt 80ml Cup',
    'DAI-YOG-80',
    '4790000000189',
    'Dairy',
    'FreshCo Demo',
    'Piece',
    55,
    75,
    undefined,
    40,
    14,
    120,
  ],
  [
    'Cheddar Cheese 200g',
    'DAI-CHED-200',
    '4790000000196',
    'Dairy',
    'FreshCo Demo',
    'Piece',
    720,
    890,
    'VAT',
    8,
    60,
    24,
  ],
  [
    'Butter 100g',
    'DAI-BUTTER-100',
    '4790000000202',
    'Dairy',
    'FreshCo Demo',
    'Piece',
    410,
    510,
    'VAT',
    10,
    45,
    30,
  ],
  [
    'Sandwich Bread',
    'BAK-BREAD-SW',
    '4790000000219',
    'Bakery',
    'Corner Bakery Demo',
    'Piece',
    130,
    165,
    undefined,
    20,
    3,
    40,
  ],
  [
    'Butter Buns 6-pack',
    'BAK-BUNS-6',
    '4790000000226',
    'Bakery',
    'Corner Bakery Demo',
    'Pack',
    150,
    195,
    undefined,
    15,
    3,
    30,
  ],
  [
    'Chocolate Cake Slice',
    'BAK-CAKE-SL',
    '4790000000233',
    'Bakery',
    'Corner Bakery Demo',
    'Piece',
    190,
    260,
    'VAT',
    10,
    4,
    20,
  ],
  [
    'Frozen Chicken Sausages 500g',
    'FRZ-SAUS-500',
    '4790000000240',
    'Frozen Foods',
    'ColdChain Demo',
    'Pack',
    680,
    840,
    'VAT',
    10,
    120,
    36,
  ],
  [
    'Frozen Green Peas 500g',
    'FRZ-PEAS-500',
    '4790000000257',
    'Frozen Foods',
    'ColdChain Demo',
    'Pack',
    260,
    340,
    undefined,
    10,
    180,
    40,
  ],
  [
    'Ice Cream Tub 1L',
    'FRZ-ICE-1L',
    '4790000000264',
    'Frozen Foods',
    'ColdChain Demo',
    'Piece',
    640,
    790,
    'VAT',
    8,
    150,
    25,
  ],
  [
    'Dish Wash Liquid 500ml',
    'HHD-DISH-500',
    '4790000000271',
    'Household',
    'CleanHome Demo',
    'Piece',
    310,
    395,
    'VAT',
    12,
    undefined,
    50,
  ],
  [
    'Laundry Powder 1kg',
    'HHD-LAUND-1K',
    '4790000000288',
    'Household',
    'CleanHome Demo',
    'Pack',
    520,
    650,
    'VAT',
    12,
    undefined,
    45,
  ],
  [
    'Toilet Tissue 4-pack',
    'HHD-TISSUE-4',
    '4790000000295',
    'Household',
    'CleanHome Demo',
    'Pack',
    290,
    370,
    'VAT',
    15,
    undefined,
    70,
  ],
  [
    'Floor Cleaner 1L',
    'HHD-FLOOR-1L',
    '4790000000301',
    'Household',
    'CleanHome Demo',
    'Piece',
    360,
    460,
    'VAT',
    8,
    undefined,
    30,
  ],
  [
    'Garbage Bags 20pc',
    'HHD-BAGS-20',
    '4790000000318',
    'Household',
    'CleanHome Demo',
    'Pack',
    170,
    225,
    'VAT',
    10,
    undefined,
    55,
  ],
  [
    'Bath Soap 100g',
    'PCR-SOAP-100',
    '4790000000325',
    'Personal Care',
    'Sample Care',
    'Piece',
    85,
    120,
    'VAT',
    30,
    undefined,
    140,
  ],
  [
    'Shampoo 180ml',
    'PCR-SHAM-180',
    '4790000000332',
    'Personal Care',
    'Sample Care',
    'Piece',
    420,
    540,
    'VAT',
    12,
    undefined,
    40,
  ],
  [
    'Toothpaste 120g',
    'PCR-TPASTE-120',
    '4790000000349',
    'Personal Care',
    'Sample Care',
    'Piece',
    240,
    310,
    'VAT',
    20,
    undefined,
    80,
  ],
  [
    'Toothbrush Medium',
    'PCR-TBRUSH-M',
    '4790000000356',
    'Personal Care',
    'Sample Care',
    'Piece',
    90,
    130,
    'VAT',
    20,
    undefined,
    60,
  ],
  [
    'Body Lotion 200ml',
    'PCR-LOTION-200',
    '4790000000363',
    'Personal Care',
    'Sample Care',
    'Piece',
    480,
    620,
    'VAT',
    8,
    undefined,
    3,
  ],
  [
    'Loose Onions (per kg)',
    'PRD-ONION-KG',
    '4790000000370',
    'Groceries',
    'Local Produce',
    'Kilogram',
    190,
    260,
    undefined,
    15,
    undefined,
    80,
  ],
  [
    'Loose Potatoes (per kg)',
    'PRD-POTATO-KG',
    '4790000000387',
    'Groceries',
    'Local Produce',
    'Kilogram',
    170,
    240,
    undefined,
    15,
    undefined,
    70,
  ],
  [
    'Biscuits Cream 200g',
    'SNK-BISC-200',
    '4790000000394',
    'Groceries',
    'QuickBite',
    'Pack',
    140,
    190,
    'VAT',
    25,
    180,
    100,
  ],
  [
    'Potato Chips 100g',
    'SNK-CHIPS-100',
    '4790000000400',
    'Groceries',
    'QuickBite',
    'Pack',
    160,
    220,
    'VAT',
    20,
    120,
    0,
  ],
  [
    'Chocolate Bar 50g',
    'SNK-CHOC-50',
    '4790000000417',
    'Groceries',
    'QuickBite',
    'Piece',
    120,
    170,
    'VAT',
    25,
    200,
    90,
  ],
];

const SUPPLIERS = [
  {
    name: 'Demo Wholesale Traders',
    contactPerson: 'Sample Contact A',
    phone: '0112000001',
    email: 'orders@demo-wholesale.example',
    address: '12 Sample Road, Colombo',
  },
  {
    name: 'Sample Dairy Distributors',
    contactPerson: 'Sample Contact B',
    phone: '0112000002',
    email: 'sales@sample-dairy.example',
    address: '45 Demo Lane, Kandy',
  },
  {
    name: 'Fictional Household Supplies',
    contactPerson: 'Sample Contact C',
    phone: '0112000003',
    email: 'info@fictional-hh.example',
    address: '8 Test Street, Galle',
  },
];
const CUSTOMERS = [
  { name: 'Sample Customer A', phone: '0000000001' },
  { name: 'Sample Customer B', phone: '0000000002' },
  { name: 'Sample Customer C', phone: '0000000003' },
  { name: 'Sample Cafe', phone: '0000000004', notes: 'Fictional business customer' },
];

const rand = (() => {
  let s = 42;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
})();

export async function seedCatalogue() {
  await ensureBase();
  const settings = await getSettings();
  if (settings.taxRates.length === 0) {
    // Demo-only placeholder rate; real deployments set their own via Settings.
    settings.set('taxRates', [{ code: 'VAT', name: 'Demo VAT (editable)', rateBps: 1800 }]);
    settings.set('store.name', 'Demo Supermarket');
    settings.set('store.address', '1 Sample Street, Colombo');
    settings.set('store.phone', '011 000 0000');
    await settings.save();
  }
  const units = new Map((await Unit.find().lean()).map((u) => [u.name, u]));
  const cats = new Map<string, mongoose.Types.ObjectId>();
  const brands = new Map<string, mongoose.Types.ObjectId>();
  const sup = await Promise.all(
    SUPPLIERS.map((s) =>
      Supplier.findOneAndUpdate({ name: s.name }, { $setOnInsert: s }, { upsert: true, new: true }),
    ),
  );
  const actor = (await User.findOne({ role: env.demoMode ? 'DEMO' : 'OWNER' }))!;
  if (!actor) throw new Error('Seed actor is missing');
  const created: {
    id: mongoose.Types.ObjectId;
    qty: number;
    expiryDays?: number;
    cost: number;
    trackExpiry: boolean;
  }[] = [];

  for (const [name, sku, barcode, cat, brand, unit, cost, price, tax, reorder, exp, stock] of PRODUCTS) {
    if (!cats.has(cat))
      cats.set(
        cat,
        (
          await Category.findOneAndUpdate(
            { name: cat },
            { $setOnInsert: { name: cat } },
            { upsert: true, new: true, collation: { locale: 'en', strength: 2 } },
          )
        )._id,
      );
    if (!brands.has(brand))
      brands.set(
        brand,
        (
          await Brand.findOneAndUpdate(
            { name: brand },
            { $setOnInsert: { name: brand } },
            { upsert: true, new: true, collation: { locale: 'en', strength: 2 } },
          )
        )._id,
      );
    if (await Product.exists({ sku })) continue;
    const u = units.get(unit)!;
    const p = await Product.create({
      name,
      sku,
      barcode,
      category: cats.get(cat),
      brand: brands.get(brand),
      unit: u._id,
      costCents: cost * 100,
      priceCents: price * 100,
      taxCode: tax,
      reorderLevelMilli: toMilli(reorder, u.decimals),
      trackExpiry: exp !== undefined,
      suppliers: [sup[Math.floor(rand() * sup.length)]._id],
    });
    await InventoryBalance.updateOne(
      { product: p._id },
      { $setOnInsert: { onHandMilli: 0 } },
      { upsert: true },
    );
    created.push({
      id: p._id,
      qty: toMilli(stock || 1, u.decimals) * (stock ? 1 : 0),
      expiryDays: exp,
      cost: cost * 100,
      trackExpiry: exp !== undefined,
    });
  }
  // Initial stock arrives through a real goods receipt so movements/batches are consistent.
  const toStock = created.filter((c) => c.qty > 0);
  if (toStock.length) {
    await withTx(async (session) => {
      const [po] = await PurchaseOrder.create(
        [{
          number: `PO-${String(await nextSeq('po', session)).padStart(5, '0')}`,
          supplier: sup[0]._id,
          status: 'RECEIVED',
          items: toStock.map((c) => ({ product: c.id, orderedMilli: c.qty, receivedMilli: c.qty, costCents: c.cost })),
          totalCents: toStock.reduce((sum, c) => sum + Math.round(c.cost * c.qty / 1000), 0),
          createdBy: actor._id,
          orderedAt: new Date(),
          notes: 'Synthetic opening stock purchase',
        }],
        { session },
      );
      const num = `GRN-${String(await nextSeq('grn', session)).padStart(5, '0')}`;
      const [grn] = await GoodsReceipt.create(
        [
          {
            number: num,
            purchaseOrder: po._id,
            supplier: sup[0]._id,
            items: toStock.map((c) => ({ product: c.id, qtyMilli: c.qty, costCents: c.cost })),
            receivedBy: actor._id,
            notes: 'Opening stock (demo seed)',
            totalCents: po.totalCents,
          },
        ],
        { session },
      );
      for (const c of toStock) {
        await addStock(session, { id: c.id, trackExpiry: c.trackExpiry, costCents: c.cost }, c.qty, {
          type: 'PURCHASE_RECEIPT',
          unitCostCents: c.cost,
          actor: actor._id,
          batchNo: `OPEN-${c.id.toString().slice(-4)}`,
          expiryDate:
            c.expiryDays !== undefined ? new Date(Date.now() + c.expiryDays * 86400_000) : undefined,
          ref: { refType: 'GoodsReceipt', refId: grn._id, refNo: num },
        });
      }
    });
  }
  for (const c of CUSTOMERS) {
    if (!(await Customer.exists({ phone: c.phone })))
      await Customer.create({ ...c, code: `C${String(await nextSeq('customer')).padStart(5, '0')}` });
  }
  // One near-expiry batch for the dashboard/alerts to show something real.
  const milk = await Product.findOne({ sku: 'DAI-MILK-1L' });
  if (milk) {
    await withTx(async (session) => {
      await addStock(session, { id: milk._id, trackExpiry: true, costCents: milk.costCents }, 6000, {
        type: 'ADJUSTMENT_IN',
        actor: actor._id,
        batchNo: 'NEAR-EXP',
        expiryDate: new Date(Date.now() + 2 * 86400_000),
        ref: { refType: 'Adjustment', reason: 'Demo near-expiry batch' },
      });
    });
  }
  await checkStockAlerts((await Product.find().select('_id').lean()).map((p) => p._id));
  return created.length;
}

async function seedPeople() {
  const people = [
    { name: 'Store Owner', email: 'owner@demo.local', role: 'OWNER' as const },
    { name: 'Mala Manager', email: 'manager@demo.local', role: 'MANAGER' as const },
    { name: 'Chathura Cashier', email: 'cashier@demo.local', role: 'CASHIER' as const },
    { name: 'Dilini Cashier', email: 'cashier2@demo.local', role: 'CASHIER' as const },
  ];
  const hash = await hashPassword(DEMO_PASSWORD);
  for (const p of people)
    await User.updateOne(
      { email: p.email },
      { $setOnInsert: { ...p, passwordHash: hash } },
      { upsert: true },
    );
}

export async function seedTransactions() {
  const cashier = (await User.findOne(env.demoMode ? { role: 'DEMO' } : { email: 'cashier@demo.local' }))!;
  if (!cashier) throw new Error('Seed cashier is missing');
  const user = { id: String(cashier._id), name: cashier.name, email: cashier.email, role: cashier.role };
  const reg = (await CashRegister.findOne())!;
  let shift = await CashShift.findOne({ cashier: cashier._id, status: 'OPEN' });
  if (!shift)
    shift = await CashShift.create({ register: reg._id, cashier: cashier._id, openingFloatCents: 500000 });
  const prods = await Product.find({ status: 'ACTIVE', sku: { $nin: ['SNK-CHIPS-100'] } })
    .populate<{ unit: { decimals: number } }>('unit', 'decimals')
    .lean();
  const customers = await Customer.find().lean();
  let made = 0;
  for (let i = 0; i < 60; i++) {
    const n = 1 + Math.floor(rand() * 5);
    const pick = new Map<string, { product: string; quantity: number }>();
    for (let k = 0; k < n; k++) {
      const p = prods[Math.floor(rand() * prods.length)];
      pick.set(String(p._id), {
        product: String(p._id),
        quantity: p.unit.decimals ? Math.round((0.5 + rand() * 2) * 10) / 10 : 1 + Math.floor(rand() * 3),
      });
    }
    const items = [...pick.values()];
    const total = (await priceRequest({ items }, user, await getSettings())).totals.totalCents;
    const useCard = rand() < 0.4;
    try {
      await checkout(
        user,
        {
          items,
          customer: rand() < 0.3 ? String(customers[Math.floor(rand() * customers.length)]._id) : undefined,
          payments: useCard
            ? [{ method: 'CARD', amountCents: total, reference: 'TERMINAL-DEMO' }]
            : [{ method: 'CASH', amountCents: Math.ceil(total / 10000) * 10000 }],
        },
        `seed-${Date.now()}-${i}`,
      );
      made++;
    } catch {
      /* out-of-stock picks are simply skipped */
    }
  }
  // Spread demo sales across the past week so trend charts have shape (timestamps only; amounts stay as computed).
  const sales = await Sale.find({ idempotencyKey: /^seed-/ })
    .select('_id')
    .lean();
  for (const [i, s] of sales.entries()) {
    // the 8 newest sales are minutes old so "today" is never empty; the rest spread over ~6.5 days
    const at = new Date(
      i < 8
        ? Date.now() - i * 180_000
        : Date.now() - Math.floor((i / sales.length) * 6.5 * 86400_000) - Math.floor(rand() * 3600_000),
    );
    await Sale.collection.updateOne({ _id: s._id }, { $set: { createdAt: at, updatedAt: at } });
    await StockMovement.updateMany({ refType: 'Sale', refId: s._id }, { $set: { createdAt: at } });
  }
  return made;
}

async function main() {
  if (env.demoMode) throw new Error('Use npm run demo:init for the isolated public demo database');
  if (new URL(env.MONGODB_URI).pathname === `/${DEMO_DATABASE}`)
    throw new Error('Legacy development seed is forbidden against the public demo database');
  if (env.isProd) {
    console.error('Refusing to seed demo data when NODE_ENV=production.');
    process.exit(1);
  }
  const demo = process.argv.includes('--demo');
  await connectDb();
  await ensureBase();
  await seedPeople();
  const n = await seedCatalogue();
   
  console.log(`Seeded ${n} products, suppliers, customers and demo users (password: ${DEMO_PASSWORD}).`);
  if (demo) {
     
    console.log(`Generated ${await seedTransactions()} demo sales through the real checkout service.`);
  }
  await disconnectDb();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
