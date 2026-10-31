import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { can } from '../../config/permissions';
import { CashAdjustment, CashRegister, CashShift, Sale, SaleReturn } from '../../database/models';
import { authenticate, requirePermission } from '../../middleware/auth';
import { body, idParam, query } from '../../middleware/validate';
import { audit, isDuplicateKey } from '../../services/common';
import { conflict, forbidden, notFound } from '../../utils/errors';
import { ok, wrap } from '../../utils/http';
import { pageMeta, pageQuery } from '../../utils/pagination';

export const cashRouter = Router();
cashRouter.use(authenticate);
const OID = (s: string) => new mongoose.Types.ObjectId(s);

/** Live reconciliation figures for a shift, derived from persisted sales/returns/adjustments (never from client data). */
export async function shiftSummary(shiftId: mongoose.Types.ObjectId | string) {
  const id = typeof shiftId === 'string' ? OID(shiftId) : shiftId;
  const [shift, sales, refunds, adj] = await Promise.all([
    CashShift.findById(id).lean(),
    Sale.aggregate([
      { $match: { shift: id, status: 'COMPLETED' } },
      { $unwind: '$payments' },
      { $group: { _id: '$payments.method', amountCents: { $sum: '$payments.amountCents' } } },
    ]),
    SaleReturn.aggregate([
      { $match: { shift: id } },
      { $group: { _id: '$refundMethod', amountCents: { $sum: '$refundCents' } } },
    ]),
    CashAdjustment.aggregate([
      { $match: { shift: id } },
      { $group: { _id: '$type', amountCents: { $sum: '$amountCents' } } },
    ]),
  ]);
  if (!shift) throw notFound('Shift');
  const pick = (rows: { _id: string; amountCents: number }[], k: string) =>
    rows.find((r) => r._id === k)?.amountCents ?? 0;
  const saleCount = await Sale.countDocuments({ shift: id, status: 'COMPLETED' });
  const s = {
    openingFloatCents: shift.openingFloatCents,
    cashSalesCents: pick(sales, 'CASH'),
    cardSalesCents: pick(sales, 'CARD'),
    cashRefundsCents: pick(refunds, 'CASH'),
    cardRefundsCents: pick(refunds, 'CARD'),
    cashInCents: pick(adj, 'IN'),
    cashOutCents: pick(adj, 'OUT'),
    saleCount,
  };
  const expectedCashCents =
    s.openingFloatCents + s.cashSalesCents - s.cashRefundsCents + s.cashInCents - s.cashOutCents;
  return { ...s, expectedCashCents };
}

const registerInput = z.object({
  name: z.string().trim().min(1).max(60),
  location: z.string().trim().max(100).optional(),
  active: z.boolean().optional(),
});

cashRouter.get(
  '/',
  requirePermission('cashregister.read'),
  wrap(async (_req, res) => {
    const [regs, open] = await Promise.all([
      CashRegister.find().sort({ name: 1 }).lean(),
      CashShift.find({ status: 'OPEN' }).populate('cashier', 'name').lean(),
    ]);
    const m = new Map(open.map((s) => [String(s.register), s]));
    ok(
      res,
      regs.map((r) => ({ ...r, openShift: m.get(String(r._id)) ?? null })),
    );
  }),
);

cashRouter.post(
  '/',
  requirePermission('cashregister.manage'),
  wrap(async (req, res) => {
    const r = await CashRegister.create(body(registerInput, req));
    await audit(req.user, 'register.create', 'CashRegister', r._id, `Created register ${r.name}`);
    ok(res, r, undefined, 201);
  }),
);

// ---- shifts (declared before /:id routes) ----
cashRouter.get(
  '/shifts/current',
  requirePermission('cashregister.operate'),
  wrap(async (req, res) => {
    const shift = await CashShift.findOne({ cashier: req.user!.id, status: 'OPEN' })
      .populate('register', 'name')
      .lean();
    ok(res, shift ? { ...shift, summary: await shiftSummary(shift._id) } : null);
  }),
);

cashRouter.get(
  '/shifts',
  requirePermission('cashregister.read'),
  wrap(async (req, res) => {
    const q = query(
      pageQuery.extend({ status: z.enum(['OPEN', 'CLOSED']).optional(), cashier: z.string().optional() }),
      req,
    );
    const f: Record<string, unknown> = {};
    if (q.status) f.status = q.status;
    if (!can(req.user!.role, 'cashregister.manage')) f.cashier = req.user!.id;
    else if (q.cashier) f.cashier = q.cashier;
    const [rows, total] = await Promise.all([
      CashShift.find(f)
        .sort({ openedAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .populate('register', 'name')
        .populate('cashier', 'name')
        .lean(),
      CashShift.countDocuments(f),
    ]);
    ok(res, rows, pageMeta(q.page, q.limit, total));
  }),
);

async function loadShiftFor(req: import('express').Request) {
  const shift = await CashShift.findById(idParam(req))
    .populate('register', 'name')
    .populate('cashier', 'name')
    .lean();
  if (!shift) throw notFound('Shift');
  const cashierId = String((shift.cashier as unknown as { _id: unknown })._id);
  if (cashierId !== req.user!.id && !can(req.user!.role, 'cashregister.manage')) throw forbidden();
  return shift;
}

cashRouter.get(
  '/shifts/:id',
  requirePermission('cashregister.read'),
  wrap(async (req, res) => {
    const shift = await loadShiftFor(req);
    const adjustments = await CashAdjustment.find({ shift: shift._id })
      .populate('by', 'name')
      .sort({ createdAt: 1 })
      .lean();
    ok(res, {
      ...shift,
      summary: shift.status === 'OPEN' ? await shiftSummary(shift._id) : shift.summary,
      adjustments,
    });
  }),
);

cashRouter.post(
  '/shifts/:id/adjust',
  requirePermission('cashregister.manage'),
  wrap(async (req, res) => {
    const d = body(
      z.object({
        type: z.enum(['IN', 'OUT']),
        amountCents: z.number().int().positive(),
        reason: z.string().trim().min(3).max(200),
      }),
      req,
    );
    const shift = await CashShift.findById(idParam(req));
    if (!shift) throw notFound('Shift');
    if (shift.status !== 'OPEN') throw conflict('Shift is closed');
    if (d.type === 'OUT') {
      const s = await shiftSummary(shift._id);
      if (d.amountCents > s.expectedCashCents)
        throw conflict('Cash-out exceeds the expected cash in the drawer');
    }
    const a = await CashAdjustment.create({ shift: shift._id, ...d, by: req.user!.id });
    await audit(
      req.user,
      'cash.adjust',
      'CashShift',
      shift._id,
      `Cash ${d.type} ${d.amountCents / 100}: ${d.reason}`,
    );
    ok(res, a, undefined, 201);
  }),
);

cashRouter.post(
  '/shifts/:id/close',
  requirePermission('cashregister.operate'),
  wrap(async (req, res) => {
    const d = body(
      z.object({ countedCashCents: z.number().int().min(0), notes: z.string().trim().max(500).optional() }),
      req,
    );
    const shift = await CashShift.findById(idParam(req));
    if (!shift) throw notFound('Shift');
    if (String(shift.cashier) !== req.user!.id && !can(req.user!.role, 'cashregister.manage'))
      throw forbidden();
    const summary = await shiftSummary(shift._id);
    const closed = await CashShift.findOneAndUpdate(
      { _id: shift._id, status: 'OPEN' },
      {
        $set: {
          status: 'CLOSED',
          closedAt: new Date(),
          countedCashCents: d.countedCashCents,
          expectedCashCents: summary.expectedCashCents,
          varianceCents: d.countedCashCents - summary.expectedCashCents,
          closingNotes: d.notes,
          summary,
        },
      },
      { new: true },
    );
    if (!closed) throw conflict('Shift is already closed');
    await audit(
      req.user,
      'shift.close',
      'CashShift',
      shift._id,
      `Closed shift; variance ${(closed.varianceCents ?? 0) / 100}`,
      { expected: summary.expectedCashCents, counted: d.countedCashCents },
    );
    ok(res, closed);
  }),
);

// ---- register routes by id ----
cashRouter.patch(
  '/:id',
  requirePermission('cashregister.manage'),
  wrap(async (req, res) => {
    const r = await CashRegister.findByIdAndUpdate(
      idParam(req),
      { $set: body(registerInput.partial(), req) },
      { new: true },
    );
    if (!r) throw notFound('Register');
    await audit(req.user, 'register.update', 'CashRegister', r._id, `Updated register ${r.name}`);
    ok(res, r);
  }),
);

cashRouter.post(
  '/:id/open-shift',
  requirePermission('cashregister.operate'),
  wrap(async (req, res) => {
    const d = body(z.object({ openingFloatCents: z.number().int().min(0) }), req);
    const reg = await CashRegister.findById(idParam(req));
    if (!reg || !reg.active) throw notFound('Register');
    try {
      // The partial unique indexes (one OPEN shift per register / per cashier) are the real guarantee against races.
      const shift = await CashShift.create({
        register: reg._id,
        cashier: req.user!.id,
        openingFloatCents: d.openingFloatCents,
      });
      await audit(
        req.user,
        'shift.open',
        'CashShift',
        shift._id,
        `Opened shift on ${reg.name} with float ${d.openingFloatCents / 100}`,
      );
      ok(res, shift, undefined, 201);
    } catch (e) {
      if (isDuplicateKey(e)) {
        const mine = await CashShift.exists({ cashier: req.user!.id, status: 'OPEN' });
        throw conflict(
          mine
            ? 'You already have an open shift. Close it first.'
            : 'This register already has an open shift',
        );
      }
      throw e;
    }
  }),
);
