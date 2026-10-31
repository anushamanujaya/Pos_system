import mongoose, { type PipelineStage } from 'mongoose';
import { z } from 'zod';
import {
  Brand,
  Category,
  InventoryBalance,
  Product,
  PurchaseOrder,
  Sale,
  StockMovement,
  Unit,
} from '../../database/models';
import { audit, type Actor } from '../../services/common';
import { conflict, notFound } from '../../utils/errors';
import { parseCsv } from '../../utils/csv';
import { escapeRegex, pageMeta, sortSpec } from '../../utils/pagination';
import { parseMoney, toMilli } from '../../utils/money';

const oidStr = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const productInput = z.object({
  name: z.string().trim().min(1).max(200),
  sku: z.string().trim().min(1).max(50),
  barcode: z.string().trim().max(50).optional().or(z.literal('')),
  description: z.string().trim().max(2000).optional(),
  category: oidStr,
  brand: oidStr.optional().or(z.literal('')),
  suppliers: z.array(oidStr).default([]),
  costCents: z.number().int().min(0),
  priceCents: z.number().int().min(0),
  taxCode: z.string().trim().max(20).optional().or(z.literal('')),
  /** External image link (http/https only). Empty string clears it. Uploaded images use the /image endpoint instead. */
  imageUrl: z
    .string()
    .trim()
    .max(2000)
    .refine((u) => u === '' || /^https?:\/\//i.test(u), 'Image link must start with http:// or https://')
    .refine((u) => {
      if (u === '') return true;
      try {
        return ['http:', 'https:'].includes(new URL(u).protocol);
      } catch {
        return false;
      }
    }, 'Image link is not a valid URL')
    .optional(),
  unit: oidStr,
  packSize: z.number().min(1).default(1),
  reorderLevel: z.number().min(0).default(0),
  trackExpiry: z.boolean().default(false),
  status: z.enum(['ACTIVE', 'ARCHIVED']).default('ACTIVE'),
});
export type ProductInput = z.infer<typeof productInput>;

async function toDoc(d: Partial<ProductInput>, unitId?: string) {
  const out: Record<string, unknown> = { ...d };
  if ('barcode' in d) out.barcode = d.barcode || undefined;
  if ('brand' in d) out.brand = d.brand || undefined;
  if ('taxCode' in d) out.taxCode = d.taxCode || undefined;
  if ('imageUrl' in d) out.imageUrl = d.imageUrl || undefined;
  if (d.reorderLevel !== undefined) {
    const u = await Unit.findById(d.unit ?? unitId).lean();
    if (!u) throw notFound('Unit');
    out.reorderLevelMilli = d.reorderLevel === 0 ? 0 : toMilli(d.reorderLevel, u.decimals);
    delete out.reorderLevel;
  }
  return out;
}

export async function createProduct(actor: Actor, d: ProductInput) {
  const doc = await Product.create(await toDoc(d));
  await InventoryBalance.updateOne(
    { product: doc._id },
    { $setOnInsert: { onHandMilli: 0 } },
    { upsert: true },
  );
  await audit(actor, 'product.create', 'Product', doc._id, `Created product ${doc.sku} ${doc.name}`);
  return doc;
}

export async function updateProduct(actor: Actor, id: string, d: Partial<ProductInput>) {
  const before = await Product.findById(id);
  if (!before) throw notFound('Product');
  const set = await toDoc(d, String(before.unit));
  const clearImage = d.imageUrl === '';
  delete set.imageUrl;
  if (d.imageUrl) set.imageUrl = d.imageUrl;
  const doc = await Product.findByIdAndUpdate(
    id,
    { $set: set, ...(clearImage ? { $unset: { imageUrl: 1 } } : {}) },
    { new: true, runValidators: true },
  );
  const changes: Record<string, unknown> = {};
  if (d.priceCents !== undefined && d.priceCents !== before.priceCents)
    changes.price = [before.priceCents, d.priceCents];
  if (d.costCents !== undefined && d.costCents !== before.costCents)
    changes.cost = [before.costCents, d.costCents];
  await audit(
    actor,
    changes.price ? 'product.price_change' : 'product.update',
    'Product',
    id,
    `Updated product ${doc!.sku}`,
    changes,
  );
  return doc;
}

/** Hard-delete only if nothing references the product; otherwise archive so financial history survives. */
export async function removeProduct(actor: Actor, id: string) {
  const p = await Product.findById(id);
  if (!p) throw notFound('Product');
  const [sold, moved, ordered] = await Promise.all([
    Sale.exists({ 'items.product': id }),
    StockMovement.exists({ product: id }),
    PurchaseOrder.exists({ 'items.product': id }),
  ]);
  if (sold || moved || ordered) {
    p.status = 'ARCHIVED';
    await p.save();
    await audit(actor, 'product.archive', 'Product', id, `Archived product ${p.sku}`);
    return { archived: true, deleted: false };
  }
  await p.deleteOne();
  await InventoryBalance.deleteOne({ product: id });
  await audit(actor, 'product.delete', 'Product', id, `Deleted product ${p.sku}`);
  return { archived: false, deleted: true };
}

export const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(20),
  sort: z
    .string()
    .regex(/^-?[a-zA-Z_.]+$/)
    .optional(),
  q: z.string().trim().max(100).optional(),
  category: oidStr.optional(),
  brand: oidStr.optional(),
  supplier: oidStr.optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  stock: z.enum(['in', 'low', 'out']).optional(),
});

export function productPipeline(q: z.infer<typeof listQuery>): PipelineStage[] {
  const match: Record<string, unknown> = {};
  if (q.status) match.status = q.status;
  if (q.category) match.category = new mongoose.Types.ObjectId(q.category);
  if (q.brand) match.brand = new mongoose.Types.ObjectId(q.brand);
  if (q.supplier) match.suppliers = new mongoose.Types.ObjectId(q.supplier);
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    match.$or = [{ name: rx }, { sku: rx }, { barcode: rx }];
  }
  const stages: PipelineStage[] = [
    { $match: match },
    { $lookup: { from: 'inventorybalances', localField: '_id', foreignField: 'product', as: 'bal' } },
    { $addFields: { onHandMilli: { $ifNull: [{ $first: '$bal.onHandMilli' }, 0] } } },
    { $project: { bal: 0 } },
  ];
  if (q.stock === 'out') stages.push({ $match: { onHandMilli: { $lte: 0 } } });
  if (q.stock === 'low')
    stages.push({
      $match: {
        $expr: { $and: [{ $gt: ['$onHandMilli', 0] }, { $lte: ['$onHandMilli', '$reorderLevelMilli'] }] },
      },
    });
  if (q.stock === 'in') stages.push({ $match: { onHandMilli: { $gt: 0 } } });
  return stages;
}

export interface ProductRow {
  id: string;
  name: string;
  sku: string;
  barcode?: string;
  description?: string;
  category: string;
  brand?: string;
  unit: string;
  costCents: number;
  priceCents: number;
  taxCode?: string;
  reorderLevelMilli: number;
  trackExpiry: boolean;
  status: string;
  imageUrl?: string;
  onHandMilli: number;
  categoryName?: string;
  brandName?: string;
  unitSymbol?: string;
  unitDecimals?: number;
}

export async function listProducts(
  q: z.infer<typeof listQuery>,
): Promise<{ rows: ProductRow[]; meta: ReturnType<typeof pageMeta> }> {
  const sort = sortSpec(
    q.sort,
    ['name', 'sku', 'priceCents', 'costCents', 'onHandMilli', 'createdAt', 'updatedAt'],
    { name: 1 },
  );
  const [res] = await Product.aggregate([
    ...productPipeline(q),
    {
      $facet: {
        rows: [
          { $sort: { ...sort, _id: 1 } },
          { $skip: (q.page - 1) * q.limit },
          { $limit: q.limit },
          { $lookup: { from: 'categories', localField: 'category', foreignField: '_id', as: 'categoryDoc' } },
          { $lookup: { from: 'brands', localField: 'brand', foreignField: '_id', as: 'brandDoc' } },
          { $lookup: { from: 'units', localField: 'unit', foreignField: '_id', as: 'unitDoc' } },
          {
            $addFields: {
              id: { $toString: '$_id' },
              categoryName: { $first: '$categoryDoc.name' },
              brandName: { $first: '$brandDoc.name' },
              unitSymbol: { $first: '$unitDoc.symbol' },
              unitDecimals: { $first: '$unitDoc.decimals' },
            },
          },
          { $project: { categoryDoc: 0, brandDoc: 0, unitDoc: 0 } },
        ],
        total: [{ $count: 'n' }],
      },
    },
  ]);
  const total = res.total[0]?.n ?? 0;
  return { rows: res.rows, meta: pageMeta(q.page, q.limit, total) };
}

export async function getProduct(id: string) {
  const p = await Product.findById(id)
    .populate('category', 'name')
    .populate('brand', 'name')
    .populate('unit')
    .populate('suppliers', 'name')
    .lean();
  if (!p) throw notFound('Product');
  const bal = await InventoryBalance.findOne({ product: id }).lean();
  return { ...p, onHandMilli: bal?.onHandMilli ?? 0 };
}

export async function findByBarcode(code: string) {
  const p = await Product.findOne({ status: 'ACTIVE', $or: [{ barcode: code }, { sku: code.toUpperCase() }] })
    .populate('unit', 'symbol decimals')
    .lean();
  if (!p) throw notFound('Product');
  const bal = await InventoryBalance.findOne({ product: p._id }).lean();
  return { ...p, id: String(p._id), onHandMilli: bal?.onHandMilli ?? 0 };
}

/** Lightweight lookup for the POS grid. */
export async function posSearch(q: string | undefined, category: string | undefined, limit: number) {
  return listProducts({ page: 1, limit, status: 'ACTIVE', q, category, sort: 'name' });
}

// ---------- CSV import / export ----------
export const CSV_COLUMNS = [
  'name',
  'sku',
  'barcode',
  'category',
  'brand',
  'unit',
  'cost',
  'price',
  'taxCode',
  'reorderLevel',
  'trackExpiry',
  'description',
];

export async function importCsv(actor: Actor, csv: string, dryRun: boolean) {
  const rows = parseCsv(csv);
  if (rows.length > 5000) throw conflict('Import is limited to 5000 rows');
  const [cats, brands, units] = await Promise.all([
    Category.find().lean(),
    Brand.find().lean(),
    Unit.find().lean(),
  ]);
  const catMap = new Map(cats.map((c) => [c.name.toLowerCase(), c]));
  const brandMap = new Map(brands.map((b) => [b.name.toLowerCase(), b]));
  const unitMap = new Map(
    units.flatMap(
      (u) =>
        [
          [u.name.toLowerCase(), u],
          [u.symbol.toLowerCase(), u],
        ] as const,
    ),
  );
  const errors: { row: number; sku?: string; message: string }[] = [];
  let imported = 0;
  const seen = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const line = i + 2; // header is line 1
    try {
      if (!r.name || !r.sku) throw new Error('name and sku are required');
      const sku = r.sku.toUpperCase();
      if (seen.has(sku)) throw new Error('duplicate SKU within file');
      seen.add(sku);
      const unit = unitMap.get((r.unit || 'piece').toLowerCase());
      if (!unit) throw new Error(`unknown unit "${r.unit}"`);
      if (!r.category) throw new Error('category is required');
      const costCents = parseMoney(r.cost || '0');
      const priceCents = parseMoney(r.price);
      if (costCents < 0 || priceCents < 0) throw new Error('cost/price cannot be negative');
      let cat = catMap.get(r.category.toLowerCase());
      let brand = r.brand ? brandMap.get(r.brand.toLowerCase()) : undefined;
      if (await Product.exists({ $or: [{ sku }, ...(r.barcode ? [{ barcode: r.barcode }] : [])] }))
        throw new Error('SKU or barcode already exists');
      if (dryRun) {
        imported++;
        continue;
      }
      if (!cat) {
        cat = (await Category.create({ name: r.category })).toObject();
        catMap.set(r.category.toLowerCase(), cat);
      }
      if (r.brand && !brand) {
        brand = (await Brand.create({ name: r.brand })).toObject();
        brandMap.set(r.brand.toLowerCase(), brand);
      }
      const p = await Product.create({
        name: r.name,
        sku,
        barcode: r.barcode || undefined,
        description: r.description || undefined,
        category: cat._id,
        brand: brand?._id,
        unit: unit._id,
        costCents,
        priceCents,
        taxCode: r.taxCode || undefined,
        reorderLevelMilli: r.reorderLevel ? toMilli(Number(r.reorderLevel), unit.decimals) : 0,
        trackExpiry: /^(true|yes|1)$/i.test(r.trackExpiry ?? ''),
      });
      await InventoryBalance.updateOne(
        { product: p._id },
        { $setOnInsert: { onHandMilli: 0 } },
        { upsert: true },
      );
      imported++;
    } catch (e) {
      errors.push({ row: line, sku: r.sku, message: (e as Error).message });
    }
  }
  if (!dryRun)
    await audit(
      actor,
      'product.import',
      'Product',
      undefined,
      `CSV import: ${imported} created, ${errors.length} rejected`,
    );
  return { total: rows.length, imported, failed: errors.length, errors, dryRun };
}
