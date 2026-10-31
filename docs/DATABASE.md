# Database design

MongoDB 7 (replica set). Mongoose schemas in `backend/src/database/models/`. Indexes are built by `syncIndexes()` at startup (`connect.ts`).

## Collections

| Collection | Purpose / notes |
|---|---|
| `users`, `refreshsessions` | Accounts (bcrypt hash, `tokenVersion`, lockout) and rotating refresh sessions (SHA-256 of token, family id, TTL index) |
| `categories`, `brands`, `units` | Case-insensitive unique names (collation). `units.decimals` (0–3) governs quantity precision; optional `baseUnit` + `factor` conversion |
| `products` | Price/cost cents, `taxCode` (references an admin-defined rate), `reorderLevelMilli`, `trackExpiry`, `status` ACTIVE/ARCHIVED |
| `inventorybalances` | One row per product: `onHandMilli` (the only mutable stock number) |
| `inventorybatches` | Per-batch `remainingMilli`, expiry, cost; FEFO source |
| `stockmovements` | Append-only ledger: type, signed `qtyMilli`, `balanceAfterMilli`, batch, reference, actor, reason |
| `suppliers`, `customers` | Customers carry `visitCount`, `totalSpentCents` (updated in the checkout transaction) |
| `purchaseorders`, `goodsreceipts` | PO items embed ordered/received qty; receipts record what arrived and at what cost |
| `sales` | Header + **embedded** `items[]` and `payments[]` (see below) |
| `salereturns` | Refund documents referencing the sale line ids |
| `cashregisters`, `cashshifts`, `cashadjustments` | Registers, shifts, cash in/out |
| `promotions`, `storesettings`, `notifications`, `auditlogs` | Self-explanatory; settings is a singleton (`key: 'store'`) |
| `sequencecounters`, `idempotencyrecords`, `heldsales` | Atomic counters; checkout dedupe (2-day TTL); suspended carts |

### Deliberate deviations from the brief's entity list
* `SaleItem` and `Payment` are **embedded** in `Sale`: they are always read/written with the sale, must be immutable snapshots, and embedding keeps a sale a single-document atomic unit with its stock deltas inside one transaction.
* "Role/permission configuration" is code (`config/permissions.ts`) rather than a collection: roles are fixed, and the matrix is version-controlled and testable.

## Snapshots (financial history)
Each sale item stores name, SKU, barcode, unit price, **unit cost**, discount amounts, tax code/rate/amount, batch allocations. Editing or archiving a product never changes past sales. Products referenced by sales/movements/POs are archived, not deleted.

## Indexes and why

| Index | Reason |
|---|---|
| `users.email` unique | login |
| `products.sku` unique; `products.barcode` unique **partial** (`$type: string`) | prevent duplicates yet allow many products with no barcode |
| `products` text(name,sku,barcode), `(category,status)`, `(status,name)`, `brand` | search, filters, default list order |
| `inventorybalances.product` unique, `onHandMilli` | atomic upsert target; low/out-of-stock scans |
| `inventorybatches (product, remainingMilli, expiryDate)` | FEFO allocation query; `(expiryDate, remainingMilli)` for expiry scans |
| `stockmovements (product, createdAt desc)`, `(type, createdAt)`, `(refType, refId)` | movement history, filters, tracing a sale/receipt to its movements |
| `sales.receiptNo` unique | stable references; `createdAt desc`, `(cashier, createdAt)`, `(customer, createdAt)`, `shift`, `items.product`, `payments.method` | history, own-sales, reports, drawer totals |
| `cashshifts.register` unique partial `{status:'OPEN'}`; `cashshifts.cashier` unique partial `{status:'OPEN'}` | the **database** guarantees one open shift per register and per cashier, even under races |
| `idempotencyrecords (user, scope, key)` unique + TTL | duplicate-checkout protection |
| `refreshsessions.tokenHash` unique, `family`, TTL on `expiresAt` | rotation + reuse detection + cleanup |
| `notifications.dedupeKey` unique partial (`resolvedAt: null`) | one open alert per product/batch condition |
| `auditlogs (createdAt)`, `(action, createdAt)`, `(actor, createdAt)` | audit browsing |

## Transactions
Used for: checkout, goods receiving (both PO and direct), returns, and seed receipts. Required replica set; `withTx` wraps `session.withTransaction` with snapshot read concern and majority write concern. Everything that must succeed together (idempotency claim, sequence, stock deltas, movements, sale, customer totals, audit row) commits or rolls back as one.
