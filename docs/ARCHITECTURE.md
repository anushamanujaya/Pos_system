# Architecture

## Overview

```
Browser (React SPA)  ──HTTPS──▶  Express API (/api/v1)  ──▶  MongoDB replica set
  access token in memory          modules → services → Mongoose
  refresh token: httpOnly cookie
```

* **Monorepo** (npm workspaces): `backend/` (Express + TS, CommonJS output), `frontend/` (Vite + React + TS).
* The API owns all database access. The browser never talks to MongoDB.

## Backend layout

```
backend/src/
  config/        env (zod-validated), permissions matrix
  database/      connect + index sync, models/, seed, initAdmin, devDb, e2eStack
  middleware/    auth (JWT + live DB check), error, validate, rateLimit
  modules/       auth users catalog products inventory purchases parties(suppliers, customers)
                 sales returns cash-registers reports settings(+notifications, promotions, audit)
  services/      common (transactions, sequences, audit, settings, notifications), stock (the stock engine)
  utils/         money, pricing, time, csv, pagination, errors, logger
  jobs/          hourly expiry scan
```
Deviation from the suggested layout: each module has `*.routes.ts` (thin handlers: parse → call service → respond) and, where
logic is non-trivial, `*.service.ts`. Small CRUD modules keep their handlers and Mongoose calls in the routes file; separate
controller/repository files were judged unnecessary indirection.

## Money and quantity

* Money: integer **cents** (`priceCents`, `totalCents` …). Rounding: half away from zero via BigInt `mulDiv`. No floats in authoritative paths.
* Quantity: integer **milli-units** (1 kg = 1000). Each unit has `decimals` (0–3); `toMilli` rejects precision the unit doesn't allow.
* Display formatting (`Rs. 1,250.00`, `DD/MM/YYYY`, Asia/Colombo) lives only in the client for display and in reports for grouping.

## Pricing pipeline (`utils/pricing.ts`)

line gross = price × qty → line discount (promotion or manual) → order discount spread proportionally (largest remainder, sums exactly) →
tax per line (**inclusive**: extracted from net; **exclusive**: added) → totals. Discounts are clamped so totals can never go negative.
Tenders: card may not exceed the amount due; cash may overpay and generates change.

## Checkout (`modules/sales/sales.service.ts`)

1. Validate body (zod). Require `Idempotency-Key`.
2. Replay check on `IdempotencyRecord(user, scope, key)`; a different payload with the same key → 422.
3. **Transaction**: claim the key (unique index) → find cashier's open shift → load products/promotions/settings →
   price the cart server-side (prices from DB, never the client) → authorise discounts → settle payments →
   for each line (stable product-id order) atomically deduct stock → allocate a receipt number → insert Sale (immutable snapshots) → update customer stats → audit.
4. After commit: stock/low-stock notifications, delete held sale.

Concurrency: stock decrement is `findOneAndUpdate({ product, onHandMilli: { $gte: qty } }, { $inc })`. Two carts racing for the last units conflict inside MongoDB; the driver retries the transient error and the loser then fails the condition with `INSUFFICIENT_STOCK` (409). Tested with 12 parallel checkouts for 5 units → exactly 5 succeed.

Duplicate submissions: the idempotency record is inserted in the same transaction as the sale, so a retry (double click, network retry) either sees the committed sale and gets the same receipt back (HTTP 200, `replayed`), or conflicts and retries.

Transaction retries: `session.withTransaction` retries `TransientTransactionError` and unknown commit results. Business errors (insufficient stock, validation) are not retried and abort the whole transaction.

## Stock engine (`services/stock.ts`)

`addStock` / `removeStock` are the only code paths that change `InventoryBalance`, and each writes `StockMovement` rows (signed qty, balance after, batch, reference, actor, reason). Expiry-tracked products are fully batch-managed; sales allocate **FEFO** from non-expired batches. Cost: moving weighted average on receipt; each sale line snapshots `unitCostCents` (batch-weighted).

## Returns

Refund qty is validated against `qty − returned` using an atomic guard (`items: { $elemMatch: { _id, returnedMilli: <value read> } }`), so concurrent refunds cannot double-refund. The final unit refunds the exact remainder (no rounding leftovers). Restock → `SALE_RETURN` back into the original batch; damaged → net-zero `SALE_RETURN` + `DAMAGED` pair. Cash refunds require the processor's open shift and cannot exceed what was paid in that method.

## Reporting definitions

* Gross sales = Σ sale totals (tax-inclusive charged amount) · Refunds = returns dated in the period (cash basis).
* Net sales (ex tax) = (gross − tax) − (refunds − refund tax).
* COGS = Σ(unit-cost snapshot × qty) − cost of **restocked** returned units (damaged returns keep their cost).
* **Gross profit** = net sales ex tax − COGS. It is not net business profit (no wages, rent, etc.).
* Day boundaries use the store timezone (`Asia/Colombo`, UTC+5:30) both for ranges (`zonedDayStart`) and `$dateToString`.
* Product/category reports attribute by sale date and subtract units returned to date.

## Frontend

`app/` (router, nav) · `components/{ui,layout,shared}` · `features/<area>` · `hooks` · `stores` (Zustand: auth in memory, POS cart, UI) · `lib` (axios client with silent refresh, formatting).
Server state via TanStack Query; every list uses server-side pagination/search/sort (`useList`). Pages are lazy-loaded. The POS cart sends **quantities and discount intents only**; totals shown come from `POST /sales/calculate`.
