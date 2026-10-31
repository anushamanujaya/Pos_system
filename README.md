# Supermarket POS & Management System

A MERN-stack point of sale and inventory system for a small-to-medium supermarket in Sri Lanka: barcode checkout,
stock with batches/expiry, purchasing, returns, cash-drawer shifts, reports and an audit trail.
Single store today; the model is organised so branches can be added later.

> Status: working and tested in development (see [Verification status](#verification-status)). It is **not** certified
> for tax or payment compliance and has not been load-tested or pen-tested. See [Known limitations](#known-limitations).

## Features

POS terminal (barcode/keyboard-wedge scanning, search, line/order discounts, split cash+card tenders, hold/resume,
shortcuts, 58/80 mm/A4 receipts) · products, categories, brands, units (decimal-aware) · CSV import/export ·
inventory with movement ledger, adjustments, FEFO batches and expiry · suppliers, purchase orders, partial goods
receiving · customers · sales history · returns/refunds (partial, restock or write-off) · cash registers and
shifts with reconciliation · promotions · dashboard and 7 report types with CSV export · notifications ·
employees with roles/permissions · store settings (configurable tax) · audit log.

## Tech stack

| Layer | Tools |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, Radix UI primitives (shadcn-style components), Lucide, React Router, TanStack Query, Zustand, React Hook Form + Zod, Recharts, Axios, Sonner |
| Backend | Node.js (≥ 20), Express, TypeScript, Mongoose/MongoDB, Zod, bcryptjs, JWT, Helmet, CORS allow-list, express-rate-limit, pino |
| Tests | Vitest + Supertest + mongodb-memory-server (replica set), React Testing Library, Playwright |
| DevOps | npm workspaces, ESLint, Prettier, Docker Compose, GitHub Actions |

## Architecture (short)

```
frontend/   React SPA  ──/api/v1──▶  backend/   Express  ──▶  MongoDB replica set
                                   modules/<area>/{routes,service}.ts   (thin routes, logic in services)
```
Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DATABASE.md](docs/DATABASE.md).

Key rules: money = integer cents, quantities = integer thousandths; the server re-prices every cart; checkout, receiving and
refunds run in MongoDB transactions with atomic conditional stock updates and idempotency keys.

## Prerequisites

* Node.js 20+ and npm 10+
* A MongoDB **replica set** (transactions require it). Pick one:
  1. **Docker**: `docker compose up -d mongo` (recommended), or
  2. **No Docker**: `npm run dev:db` starts a persistent single-node replica set using `mongodb-memory-server`
     (first run downloads a ~600 MB MongoDB binary; keep that terminal open), or
  3. An existing replica set / MongoDB Atlas dev cluster – put its URI in `MONGODB_URI`.

## Quick start

Two independent projects: `backend/` and `frontend/`. Each has its own `package.json`, `node_modules` and scripts.

```bash
# --- backend ---
cd backend
npm install
npm start                   # http://localhost:4000   (npm run dev = auto-restart)

# --- frontend (new terminal) ---
cd frontend
npm install
npm run dev                 # http://localhost:5173
```

**MongoDB**: point `MONGODB_URI` in `backend/.env` at your own MongoDB. It **must be a replica set** (MongoDB Atlas always is;
a local `mongod` needs `--replSet rs0` + `rs.initiate()`). No database script is needed if you already have one.
Without a database: `cd backend && npm run dev:db` (or `docker compose up -d mongo`).
For an empty production-style start use `ADMIN_EMAIL`/`ADMIN_PASSWORD` in `backend/.env` and `npm run init:admin` instead of the demo seed.

Demo logins (after `seed:demo`, password `Demo@12345`): `owner@demo.local`, `manager@demo.local`, `cashier@demo.local`, `cashier2@demo.local`.
The demo password is public; never seed demo data in production (the seed refuses when `NODE_ENV=production`).

Generate a secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

## Environment variables

See [.env.example](.env.example). `JWT_ACCESS_SECRET` is required. Secrets stay on the server; the client bundle contains none.

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | Replica-set connection string |
| `JWT_ACCESS_SECRET`, `ACCESS_TOKEN_TTL` | Access-token signing / lifetime (default 15m) |
| `REFRESH_TOKEN_TTL_DAYS` | Refresh session lifetime (default 7) |
| `CORS_ORIGINS` | Comma-separated allowed browser origins |
| `COOKIE_SECURE` | Refresh-cookie `Secure` flag (default on in production; `false` only for plain-HTTP demos) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | Used only by `npm run init:admin` |

## Scripts

| Where | Command | What it does |
|---|---|---|
| backend | `npm start` | Run the API (tsx, no build step) |
| backend | `npm run dev` | API with auto-restart |
| backend | `npm run build` then `npm run start:prod` | Compiled production run |
| backend | `npm run dev:db` | Local replica set without Docker |
| backend | `npm run seed` / `seed:demo` / `init:admin` | Dev data / dev data + demo sales / first owner from env |
| backend | `npm test` · `npm run typecheck` | Backend tests (61) / types |
| frontend | `npm run dev` | Vite dev server (proxies `/api` to :4000) |
| frontend | `npm run build` · `npm test` | Production build / tests (15) |
| root (optional) | `npm install` then `npm run lint` / `npm run test:e2e` | ESLint and Playwright only; not needed to run the app |

Windows note: if the bundled Playwright Chromium isn't installed, run `npx playwright install chromium` or use an installed
browser: `E2E_CHANNEL=msedge npm run test:e2e`. If mongodb-memory-server cannot download, set
`MONGOMS_SYSTEM_BINARY` to a local `mongod` (7.x).

## User roles

| Role | Highlights |
|---|---|
| OWNER | Everything incl. settings, employees, audit log |
| MANAGER | Catalogue, inventory, purchasing, reports, discount override, refund approval, cash in/out |
| CASHIER | POS, own sales, refunds (policy permitting), own shift, customer lookup |

The full matrix lives in [backend/src/config/permissions.ts](backend/src/config/permissions.ts) and the **Employees → Roles & permissions** screen. Enforced server-side on every route.

## API

REST under `/api/v1`, JSON envelope `{ success, data, meta? }` / `{ success:false, error:{ code, message, details? } }`.
Reference: [docs/API.md](docs/API.md).

## Receipt printing

Receipts print through the **browser print dialog** with print-specific CSS (58 mm, 80 mm, A4). Browser printing cannot
cut paper, open a cash drawer or silently choose a printer; those need a native/ESC-POS integration that is **not** included.
Details and tips: [docs/USER_GUIDE.md](docs/USER_GUIDE.md#receipts-and-printing).

## Docker

```bash
export JWT_ACCESS_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
docker compose up -d --build   # web on http://localhost:8080
ADMIN_EMAIL=owner@example.com ADMIN_PASSWORD='choose-a-strong-one1' docker compose up -d api   # then:
docker compose exec api node dist/database/initAdmin.js                                         # creates units, settings, register, first owner
```
The Docker files were written but **not executed** in the environment this was built in (Docker daemon unavailable) – see status below.

## Deployment considerations

Terminate TLS in front of the app, keep `COOKIE_SECURE` on, use a managed replica set with backups, rotate secrets, restrict `CORS_ORIGINS`.
See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) and [docs/SECURITY.md](docs/SECURITY.md).

## Verification status

Honest summary of what was actually executed (details in [docs/TESTING.md](docs/TESTING.md)):

| Check | Result |
|---|---|
| Server tests (61, real MongoDB replica set) | ✅ pass |
| Client tests (15) | ✅ pass |
| Playwright E2E (13-step flow, 8 tests, Microsoft Edge) | ✅ pass |
| ESLint, TypeScript (both packages), production builds | ✅ pass |
| Seed → API → dashboard against a live local replica set | ✅ verified |
| Docker Compose / Dockerfiles | ⚠️ not run |
| GitHub Actions workflow | ⚠️ not run |
| Load / pen testing, WCAG audit, tablet device testing | ❌ not done |

## Known limitations

* Card = **recording** an externally completed terminal payment; no gateway, no card data stored. No PCI claims.
* Tax: no rate is built in; admins configure rates. This is not tax advice or compliance certification.
* Single store (no branch-level stock/pricing yet). Single currency display (LKR).
* Void of a whole sale is done as a full return (no separate void state).
* Receipt numbers are allocated inside the checkout transaction; a rolled-back checkout leaves no gap, but a hard crash between commit and response can only be recovered by retrying with the same idempotency key.
* Product images are stored on local disk (`uploads/`); use object storage for multi-instance deployments.
* Dark mode and offline mode are not implemented; chart palette validated for light mode only.
