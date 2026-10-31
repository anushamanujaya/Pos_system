# Implementation status

Last full verification: lint clean · `tsc` (server + client) · server build · client `vite build` · server 61/61 · client 15/15 · Playwright 8/8 (Edge).

## Completed and tested
Auth/sessions/RBAC · products, categories, brands, units, CSV import/export (API + tests) · inventory ledger, adjustments, batches/FEFO/expiry ·
purchase orders and (partial) receiving · POS checkout (server pricing, tax, discounts, split tender, change, idempotency, concurrency-safe stock, rollback) ·
receipts (data + preview) · returns/refunds (partial, concurrent-safe, restock/damaged) · cash shifts & reconciliation · reports numbers · notifications creation · audit trail ·
full 13-step browser flow.

## Implemented but not (or only lightly) tested
Frontend pages other than POS/payment/login/route-guard (products, inventory, purchases UI, suppliers, customers, employees, settings, promotions UI, reports/dashboard rendering) were exercised only through the E2E flow, typecheck and build — not unit-tested; promotions UI, customers/suppliers CRUD UI and employee management UI were not driven in a browser ·
product image/logo upload · hourly expiry job · held sales UI · CSV exports in the browser · print CSS (preview only; never printed on paper) · responsive/tablet layouts (built responsive, not checked on devices) ·
Docker Compose + Dockerfiles + GitHub Actions (written, never executed).

## Partially implemented / deviations
* Whole-sale **void** is handled as a full return (no separate VOIDED workflow; the enum value exists).
* `SaleItem`/`Payment` embedded in `Sale`; roles are code, not a collection (see DATABASE.md).
* Unit conversions are stored (`baseUnit`, `factor`) but not used to convert quantities automatically.
* Purchase returns (`PURCHASE_RETURN` movement type) exist in the schema but there is no UI/API flow.
* Dark mode not implemented. Accessibility: labelled controls, roles, focus-visible, keyboard shortcuts; no formal WCAG audit.
* Store "branch" concept: a single store; naming kept branch-agnostic.

## Not implemented
Native printer / cash-drawer integration · payment gateway (by design) · multi-branch · email/SMS · offline mode · backup tooling.

## Known defects / risks
* `seed.ts` was reformatted by Prettier into a very long file; cosmetic only.
* `npm audit` reports advisories in dev dependencies (not reviewed).
* Bundled Playwright Chromium on the dev machine was an older build; E2E ran on installed Microsoft Edge.
* Receipt number format tokens are validated lightly (`{SEQ:n}` required).

## Remaining production hardening
TLS + reverse proxy, managed replica set + backups, secret rotation, pen-test, load test, audit-log immutability, object storage for uploads, MFA, dependency audit, WCAG review, real-printer testing, tax advisor review of the configured rates, privacy review for customer data.

## Continuing
```bash
npm install && cp .env.example .env     # set JWT_ACCESS_SECRET
npm run dev:db                          # or docker compose up -d mongo
npm run seed:demo && npm run dev
```
