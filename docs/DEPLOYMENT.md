# Deployment

> The Docker artefacts and CI workflow in this repo were written but **not executed** by the author's environment (no Docker daemon). Treat first deployment as a test run.

## Requirements
* MongoDB **replica set** (a single-node replica set is fine for one store). Required for transactions — the API fails checkout without it.
* Node 20+ (Docker image uses 22). HTTPS termination in front (nginx/Caddy/cloud LB).

## Docker Compose (single host)
```bash
export JWT_ACCESS_SECRET=<48+ random bytes hex>
export ADMIN_EMAIL=owner@yourstore.lk ADMIN_PASSWORD='<strong password>'
docker compose up -d --build
docker compose exec api node dist/database/initAdmin.js     # idempotent; creates units, settings, register 1, first owner
```
* `web` (nginx) serves the SPA on :8080 and proxies `/api` and `/uploads` to `api`.
* The compose file sets `COOKIE_SECURE=false` **only so the plain-HTTP demo works**. Behind HTTPS remove that line (the cookie must be `Secure`) and set `CORS_ORIGINS` to your real origin.
* Volumes: `mongo-data`, `uploads`. Back both up.

## Without Docker
```bash
npm ci && npm run build
NODE_ENV=production MONGODB_URI=… JWT_ACCESS_SECRET=… CORS_ORIGINS=https://pos.example.lk npm start --prefix backend
# serve frontend/dist with any static host; reverse-proxy /api and /uploads to the API
```
If the SPA and API are on different origins, add the SPA origin to `CORS_ORIGINS` and change the axios `baseURL` (client `src/lib/api.ts`); same-origin via reverse proxy is recommended (the refresh cookie is SameSite=Strict).

## MongoDB Atlas / managed
Use the `mongodb+srv://…` URI (Atlas clusters are replica sets). Create a least-privilege DB user. Whitelist the API host.

## Production checklist
- [ ] Unique strong `JWT_ACCESS_SECRET`; never reuse the dev secret
- [ ] `NODE_ENV=production`; no demo seed (`seed` refuses in production)
- [ ] HTTPS everywhere; `COOKIE_SECURE` on; correct `CORS_ORIGINS`
- [ ] Owner password rotated; employees on individual accounts
- [ ] Tax rates configured by the owner/accountant
- [ ] Automated MongoDB backups + restore drill; uploads backed up
- [ ] Log shipping / alerts (pino JSON on stdout), `/api/health` monitored
- [ ] `npm audit` reviewed; images rebuilt regularly
- [ ] Time sync on the host (reports use Asia/Colombo day boundaries)

## Operational notes
* Transactions retry automatically on transient errors; clients should retry failed checkouts **with the same `Idempotency-Key`** (the POS does).
* An hourly job raises expiry notifications; `POST /inventory/scan-expiry` triggers it on demand.
* Run only one API process per host unless you move uploads to shared storage.
