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

## Vercel split deployment

Deploy `frontend/` and `backend/` as separate Vercel projects. The frontend rewrite in
`frontend/vercel.json` proxies `/api/*` to the backend so refresh cookies remain first-party.

Backend environment requirements:

```text
NODE_ENV=production
MONGODB_URI=<dedicated MongoDB Atlas URI>
JWT_ACCESS_SECRET=<strong backend-only secret>
FRONTEND_ORIGIN=https://<canonical-frontend-domain>
CORS_ORIGINS=https://<canonical-frontend-domain>,https://<exact-preview-domain-if-needed>
COOKIE_SECURE=true
```

Origins are exact allowlist entries. Do not use `*` when credentials are enabled. Add each preview
domain explicitly or use a stable custom preview domain. After changing Vercel environment variables,
redeploy the backend because existing deployments retain their old environment snapshot.

`GET /api/health` establishes/reuses the cached MongoDB connection and performs a real `ping`; it
returns 503 if initialization or the ping fails. `GET /` on the backend is intentionally 404 because
the backend is API-only. The frontend project owns `/` and rewrites SPA routes to `index.html`.

Vercel's function filesystem is not permanent product-image storage. Local disk uploads remain
available for Docker/traditional Node hosting, but Vercel returns `UPLOAD_STORAGE_UNAVAILABLE` for
image/logo mutations. Configure durable object storage (for example an S3-compatible service) and
store durable public/object URLs before enabling uploads on Vercel. `/tmp` must not be used for
permanent product images.
- [ ] `npm audit` reviewed; images rebuilt regularly
- [ ] Time sync on the host (reports use Asia/Colombo day boundaries)

## Operational notes
* Transactions retry automatically on transient errors; clients should retry failed checkouts **with the same `Idempotency-Key`** (the POS does).
* An hourly job raises expiry notifications; `POST /inventory/scan-expiry` triggers it on demand.
* Run only one API process per host unless you move uploads to shared storage.
