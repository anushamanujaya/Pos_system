# API reference

Base URL `/api/v1`. JSON in/out. Authenticated routes need `Authorization: Bearer <accessToken>`.
Success: `{ "success": true, "data": …, "meta": { page, limit, total, pages } }`.
Failure: `{ "success": false, "error": { "code", "message", "details?" } }`.

Common codes: `VALIDATION_ERROR` 400 · `UNAUTHORIZED` 401 · `FORBIDDEN` 403 · `NOT_FOUND` 404 · `CONFLICT`/`DUPLICATE` 409 ·
`INSUFFICIENT_STOCK` 409 · `PRICE_CHANGED` 409 · `NO_OPEN_SHIFT` 422 · `OVER_REFUND`/`OVER_RECEIPT` 422 · `IDEMPOTENCY_MISMATCH` 422 · `RATE_LIMITED` 429.

Lists accept `page`, `limit` (≤200), `sort` (`field` / `-field`), `q`, plus resource filters. Health: `GET /api/health`.

Money fields end in `Cents` (integers). Quantities are sent as plain numbers (e.g. `1.5`) and returned as `…Milli` integers (1500).

## Auth — `/auth`
| Method & path | Notes |
|---|---|
| `POST /auth/login` `{email,password}` | Returns access token + user (with permissions); sets httpOnly refresh cookie. Rate-limited; 5 failures lock the account 15 min |
| `POST /auth/refresh` | Cookie + header `X-Requested-With: pos-web`. Rotates the refresh token; reuse of an old one revokes the whole session family |
| `POST /auth/logout` | Same header; revokes the session family |
| `GET /auth/me`, `PATCH /auth/profile`, `POST /auth/change-password` | Password change signs out other devices |

## Catalogue
| Path | Permission |
|---|---|
| `GET/POST/PATCH/DELETE /categories`, `/brands`, `/units` | read `products.read`; write `catalog.manage`. DELETE is refused (409) if products use it |
| `GET /products` (q, category, brand, supplier, status, stock=in\|low\|out) | `products.read` |
| `GET /products/pos` · `GET /products/barcode/:code` (barcode or SKU) | `sales.create` / `products.read` |
| `POST /products`, `PATCH /products/:id` | `products.create` / `products.update` (price changes are audited) |
| `DELETE /products/:id` | `products.delete`; archives if referenced, else deletes |
| `POST /products/:id/image` (multipart `image`, JPEG/PNG/WebP ≤ 2 MB) | `products.update` |
| `GET /products/export` · `POST /products/import` `{csv, dryRun}` | `products.read` / `products.create` — row-level errors returned |

## Inventory & purchasing
| Path | Permission |
|---|---|
| `GET /inventory`, `/inventory/valuation`, `/inventory/movements`(+`/export`), `/inventory/batches` | `inventory.read` |
| `POST /inventory/adjust` `{product,type,quantity,reason,batch?,batchNo?,expiryDate?,costCents?}` type ∈ ADJUSTMENT_IN/OUT, DAMAGED, EXPIRED | `inventory.adjust` |
| `GET/POST /purchases`, `GET/PATCH /purchases/:id`, `POST …/submit`, `…/cancel` | `purchases.read` / `purchases.manage` |
| `POST /purchases/:id/receive` `{items:[{product,quantity,costCents?,batchNo?,expiryDate?}],supplierInvoiceRef?}` | `inventory.receive` (partial receipts; over-receipt → 422) |
| `POST /purchases/receive-direct`, `GET /purchases/receipts` | `inventory.receive` / `purchases.read` |
| `/suppliers` GET, GET :id, POST, PATCH | `suppliers.read` / `suppliers.manage` |
| `/customers` GET, GET :id, POST, PATCH | `customers.read` / `customers.manage` |

## Sales & returns
| Path | Notes |
|---|---|
| `POST /sales/calculate` `{items:[{product,quantity,discount?}],orderDiscount?}` | Authoritative pricing preview (`sales.create`). **No prices are accepted from the client** |
| `POST /sales` | Header **`Idempotency-Key`** (8–100 chars) required. Body: `items`, `orderDiscount?`, `customer?`, `payments:[{method:CASH\|CARD,amountCents,reference?}]`, `expectedTotalCents?`, `heldId?`. 201 (or 200 on replay) → `{saleId, receiptNo, replayed, store, receipt, sale}` |
| `GET /sales`, `/sales/export`, `/sales/:id`, `/sales/:id/receipt`, `/sales/lookup/:receiptNo` | `sales.read` (cashiers see only their own; `sales.read.all` for everyone) |
| `GET/POST/DELETE /sales/held` | Suspended carts |
| `POST /returns` `{sale,items:[{saleItemId,quantity,condition:RESTOCK\|DAMAGED}],refundMethod,reason}` | `sales.refund`; may require `sales.refund.approve` per settings |
| `GET /returns`, `/returns/:id` | `sales.read` |

Discount input: `{type:"PERCENT",percent}` or `{type:"FIXED",amountCents}` (+ optional `note`). Above the cashier limit → 403 unless `discount.override`.

## Cash registers — `/cash-registers`
`GET /` · `POST /` (`cashregister.manage`) · `PATCH /:id` · `POST /:id/open-shift {openingFloatCents}` (`cashregister.operate`; 409 if the register or cashier already has an open shift) ·
`GET /shifts/current` · `GET /shifts` · `GET /shifts/:id` · `POST /shifts/:id/adjust` (cash in/out, manager) · `POST /shifts/:id/close {countedCashCents,notes}`.

## Reports (`reports.read`)
`GET /reports/dashboard|sales|products|profit|inventory|purchases|cashiers|reconciliation` with `from`,`to` (`YYYY-MM-DD`, store timezone), `bucket=day|week|month`. Add `format=csv` to download the primary table.

## Admin
| Path | Permission |
|---|---|
| `GET/POST /users`, `GET/PATCH /users/:id`, `POST /users/:id/reset-password`, `GET /users/roles` | `employees.read` / `employees.manage` |
| `GET/PUT /settings`, `POST /settings/logo` | read: any user; write: `settings.manage` |
| `GET/POST/PUT/DELETE /promotions` | `promotions.manage` (read also for POS) |
| `GET /notifications`, `/unread-count`, `POST /:id/read`, `/read-all` | any user |
| `GET /audit-logs` | `audit.read` |
