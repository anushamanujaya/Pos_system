# Testing

## Commands
```bash
npm test                 # server (Vitest) + client (Vitest/RTL)
npm run test --prefix backend   # needs a mongod binary: auto-downloaded by mongodb-memory-server, or set MONGOMS_SYSTEM_BINARY
npm run test --prefix frontend
npm run test:e2e         # Playwright; spins up its own DB + API (:4100) + Vite (:5174)
E2E_CHANNEL=msedge npm run test:e2e   # use an installed Edge/Chrome instead of Playwright's Chromium
```
Isolation: server tests share one in-memory MongoDB **replica set** (transactions work) but each file uses its own database, dropped afterwards. Fixtures are created in code per test file; no shared mutable seed.

## What is covered

**Server (61 tests, 6 files)**
* Money/pricing primitives: rounding, inclusive/exclusive tax, discount ordering and caps, proportional allocation, split payments & change, timezone day boundaries, CSV round trip & formula neutralising.
* Auth: login success/failure, identical error for unknown user, permission enforcement, refresh rotation + reuse revocation, CSRF header, disabling an account kills live tokens, password change.
* Catalogue: create/duplicate SKU & barcode rejection, optional barcode, validation, search/filter/pagination, barcode lookup, CSV import with row errors, archive vs delete, referenced category protection, adjustments (never negative, unit precision, movement ledger).
* Purchasing: draft → ordered → partial → received, over-receipt rejection (also under concurrency), expiry required for tracked products, role checks.
* Checkout: server pricing & snapshots, no-shift rejection, insufficient stock, **rollback of all lines**, **idempotent duplicates (3 parallel identical requests → 1 sale)**, key reuse with different payload, **12 concurrent checkouts for 5 units → exactly 5 sales**, unique receipt numbers, FEFO + expired batch refusal, discount limits/override, promotions, split payments & customer stats, price-change guard, own-sales visibility.
* Returns: partial → final refund (exact remainder), over-refund rejection, damaged vs restock, concurrent refunds (only one wins), refund method rules, manager-approval setting.
* Cash shifts: expected cash, cash in/out permissions, variance on close, double-close, one open shift per register/cashier under race.
* Reports: sales/refund/tax/COGS/gross-profit numbers checked against hand calculation, series equals summary, CSV export, dashboard aggregation, low-stock notification creation, read/unread, audit coverage.

**Client (15 tests)**: login validation/success/error, route authorization, cart store (add/increment/quantity/remove, no prices sent, idempotency-key rotation), discount dialog validation, payment dialog (change, submit with idempotency key, success + receipt, failure keeps cart), error boundary, formatting (LKR, DD/MM/YYYY in Colombo).

**E2E (Playwright, 1 serial flow of 13 steps, 8 tests)**: admin login → create product → PO → receive → cashier opens shift → search + barcode scan → F4 payment → cash sale with change → receipt preview → stock decreased → sale in history → partial return → stock/reports updated → close shift with exact count.

## Last recorded results (development machine, Windows 11)
| Suite | Result |
|---|---|
| Server | 61 passed / 61 |
| Client | 15 passed / 15 |
| E2E (Microsoft Edge channel) | 8 passed / 8 |
| ESLint | 0 errors |
| `tsc` both packages, `vite build`, server `tsc` build | success |

## Not tested
* Docker Compose images, GitHub Actions run, Playwright with Playwright's own Chromium on this machine (version mismatch → Edge channel used).
* Cross-browser, real thermal printers, real barcode hardware (simulated by typing + Enter), tablet touch devices.
* Load/soak performance, backup/restore, security penetration, WCAG audit with assistive technology (labels/roles/focus handled by construction only).
* Frontend tests for most pages beyond the POS-critical components.
