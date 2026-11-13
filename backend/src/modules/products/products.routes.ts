import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { env } from '../../config/env';
import { Product } from '../../database/models';
import { authenticate, requirePermission } from '../../middleware/auth';
import { body, idParam, query } from '../../middleware/validate';
import { audit } from '../../services/common';
import { toCsv } from '../../utils/csv';
import { AppError, badRequest, notFound } from '../../utils/errors';
import { ok, wrap } from '../../utils/http';
import * as svc from './products.service';

export const productsRouter = Router();
productsRouter.use(authenticate);

export const uploadDir = path.resolve(env.UPLOAD_DIR);
if (!env.isVercel) fs.mkdirSync(uploadDir, { recursive: true });
export const requirePersistentUploadStorage: RequestHandler = (_req, _res, next) => {
  if (env.isVercel)
    return next(
      new AppError(
        503,
        'UPLOAD_STORAGE_UNAVAILABLE',
        'Image uploads require configured persistent object storage on this deployment',
      ),
    );
  next();
};
const EXT: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
export const imageUpload = multer({
  storage: env.isVercel
    ? multer.memoryStorage()
    : multer.diskStorage({
        destination: uploadDir,
        // random server-chosen name: the client filename is never used on disk
        filename: (_req, file, cb) =>
          cb(null, `${crypto.randomBytes(16).toString('hex')}${EXT[file.mimetype] ?? ''}`),
      }),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, !!EXT[file.mimetype]),
});

productsRouter.get(
  '/',
  requirePermission('products.read'),
  wrap(async (req, res) => {
    const { rows, meta } = await svc.listProducts(query(svc.listQuery, req));
    ok(res, rows, meta);
  }),
);

productsRouter.get(
  '/pos',
  requirePermission('sales.create'),
  wrap(async (req, res) => {
    const q = query(
      z.object({
        q: z.string().trim().max(100).optional(),
        category: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(40),
      }),
      req,
    );
    const { rows } = await svc.posSearch(q.q, q.category, q.limit);
    ok(res, rows);
  }),
);

productsRouter.get(
  '/barcode/:code',
  requirePermission('products.read'),
  wrap(async (req, res) => {
    ok(res, await svc.findByBarcode(String(req.params.code).slice(0, 64)));
  }),
);

productsRouter.get(
  '/export',
  requirePermission('products.read'),
  wrap(async (req, res) => {
    const { rows } = await svc.listProducts({ ...query(svc.listQuery, req), page: 1, limit: 500 });
    const csv = toCsv(
      rows.map((p) => ({
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        category: p.categoryName,
        brand: p.brandName,
        unit: p.unitSymbol,
        cost: (p.costCents / 100).toFixed(2),
        price: (p.priceCents / 100).toFixed(2),
        taxCode: p.taxCode,
        reorderLevel: p.reorderLevelMilli / 1000,
        trackExpiry: p.trackExpiry,
        description: p.description,
        onHand: p.onHandMilli / 1000,
        status: p.status,
      })),
      [...svc.CSV_COLUMNS, 'onHand', 'status'],
    );
    res
      .setHeader('Content-Type', 'text/csv; charset=utf-8')
      .setHeader('Content-Disposition', 'attachment; filename="products.csv"')
      .send(csv);
  }),
);

productsRouter.post(
  '/import',
  requirePermission('products.create'),
  wrap(async (req, res) => {
    const d = body(
      z.object({ csv: z.string().min(1).max(5_000_000), dryRun: z.boolean().default(false) }),
      req,
    );
    ok(res, await svc.importCsv(req.user!, d.csv, d.dryRun));
  }),
);

productsRouter.get(
  '/:id',
  requirePermission('products.read'),
  wrap(async (req, res) => ok(res, await svc.getProduct(idParam(req)))),
);

productsRouter.post(
  '/',
  requirePermission('products.create'),
  wrap(async (req, res) => {
    ok(res, await svc.createProduct(req.user!, body(svc.productInput, req)), undefined, 201);
  }),
);

productsRouter.patch(
  '/:id',
  requirePermission('products.update'),
  wrap(async (req, res) => {
    ok(res, await svc.updateProduct(req.user!, idParam(req), body(svc.productInput.partial(), req)));
  }),
);

productsRouter.delete(
  '/:id',
  requirePermission('products.delete'),
  wrap(async (req, res) => {
    ok(res, await svc.removeProduct(req.user!, idParam(req)));
  }),
);

productsRouter.post(
  '/:id/image',
  requirePermission('products.update'),
  requirePersistentUploadStorage,
  imageUpload.single('image'),
  wrap(async (req, res) => {
    if (!req.file) throw badRequest('Upload a JPEG, PNG or WebP image up to 2MB');
    const p = await Product.findByIdAndUpdate(
      idParam(req),
      { $set: { imageUrl: `/uploads/${req.file.filename}` } },
      { new: true },
    );
    if (!p) {
      fs.rmSync(req.file.path, { force: true });
      throw notFound('Product');
    }
    await audit(req.user, 'product.image', 'Product', p._id, `Updated image for ${p.sku}`);
    ok(res, { imageUrl: p.imageUrl });
  }),
);
