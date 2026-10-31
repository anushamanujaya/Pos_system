import { Router, type Request } from 'express';
import type { Model } from 'mongoose';
import { z } from 'zod';
import { Brand, Category, Product, Unit } from '../../database/models';
import { authenticate, requirePermission } from '../../middleware/auth';
import { body, idParam, query } from '../../middleware/validate';
import { audit } from '../../services/common';
import { conflict, notFound } from '../../utils/errors';
import { ok, wrap } from '../../utils/http';
import { escapeRegex, pageMeta, pageQuery } from '../../utils/pagination';

/**
 * Categories, brands and units share the same shape of CRUD: list/search, create, update, delete-if-unreferenced.
 * Referenced entities are deactivated instead of deleted so history stays intact.
 */
function simpleCrud(opts: {
  path: string;
  entity: string;
  model: Model<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  refField: 'category' | 'brand' | 'unit';
  schema: z.ZodObject<z.ZodRawShape>;
}) {
  const r = Router();
  r.use(authenticate);
  const { model, schema, entity, refField } = opts;
  const lower = entity.toLowerCase();

  r.get(
    '/',
    requirePermission('products.read'),
    wrap(async (req: Request, res) => {
      const q = query(
        pageQuery.extend({ active: z.enum(['true', 'false']).optional(), all: z.enum(['true']).optional() }),
        req,
      );
      const f: Record<string, unknown> = {};
      if (q.active) f.active = q.active === 'true';
      if (q.q) f.name = new RegExp(escapeRegex(q.q), 'i');
      const limit = q.all ? 1000 : q.limit;
      const [rows, total, counts] = await Promise.all([
        model
          .find(f)
          .sort({ name: 1 })
          .skip(q.all ? 0 : (q.page - 1) * limit)
          .limit(limit)
          .lean(),
        model.countDocuments(f),
        Product.aggregate([{ $group: { _id: `$${refField}`, n: { $sum: 1 } } }]),
      ]);
      const m = new Map(counts.map((c) => [String(c._id), c.n]));
      ok(
        res,
        rows.map((x) => ({ ...x, id: String(x._id), productCount: m.get(String(x._id)) ?? 0 })),
        pageMeta(q.page, limit, total),
      );
    }),
  );

  r.post(
    '/',
    requirePermission('catalog.manage'),
    wrap(async (req, res) => {
      const d = body(schema, req);
      const doc = await model.create(d);
      await audit(req.user, `${lower}.create`, entity, doc._id, `Created ${lower} ${doc.name}`);
      ok(res, doc, undefined, 201);
    }),
  );

  r.patch(
    '/:id',
    requirePermission('catalog.manage'),
    wrap(async (req, res) => {
      const d = body(schema.partial(), req);
      const doc = await model.findByIdAndUpdate(
        idParam(req),
        { $set: d },
        { new: true, runValidators: true },
      );
      if (!doc) throw notFound(entity);
      await audit(req.user, `${lower}.update`, entity, doc._id, `Updated ${lower} ${doc.name}`, d);
      ok(res, doc);
    }),
  );

  r.delete(
    '/:id',
    requirePermission('catalog.manage'),
    wrap(async (req, res) => {
      const id = idParam(req);
      const inUse = await Product.exists({ [refField]: id });
      if (inUse) throw conflict(`This ${lower} is used by products. Deactivate it instead of deleting.`);
      if (refField === 'unit' && (await Unit.exists({ baseUnit: id })))
        throw conflict('This unit is the base of another unit');
      const doc = await model.findByIdAndDelete(id);
      if (!doc) throw notFound(entity);
      await audit(req.user, `${lower}.delete`, entity, id, `Deleted ${lower} ${doc.name}`);
      ok(res, { deleted: true });
    }),
  );

  return r;
}

const nameSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  active: z.boolean().optional(),
});

export const categoriesRouter = simpleCrud({
  path: 'categories',
  entity: 'Category',
  model: Category,
  refField: 'category',
  schema: nameSchema,
});
export const brandsRouter = simpleCrud({
  path: 'brands',
  entity: 'Brand',
  model: Brand,
  refField: 'brand',
  schema: nameSchema,
});
export const unitsRouter = simpleCrud({
  path: 'units',
  entity: 'Unit',
  model: Unit,
  refField: 'unit',
  schema: z.object({
    name: z.string().trim().min(1).max(50),
    symbol: z.string().trim().min(1).max(10),
    decimals: z.number().int().min(0).max(3).default(0),
    baseUnit: z
      .string()
      .regex(/^[a-f\d]{24}$/i)
      .optional(),
    factor: z.number().positive().default(1),
    active: z.boolean().optional(),
  }),
});
