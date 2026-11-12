# Public demo deployment

The public demo is a separate frontend, backend, MongoDB database, and MongoDB user. The private deployment keeps `DEMO_MODE` unset. Never copy the private database URI or private JWT secret into either demo Vercel project.

## MongoDB Atlas and credentials

1. In Atlas, create a new database user for the demo with exactly one role: `readWrite` on **only** `supermarket_pos_demo`. The backend checks the authenticated roles at connection time and refuses broader accounts. Do not give it `atlasAdmin`, `readWriteAnyDatabase`, or access to the private database. Allow network access from the backend deployment as required by your Atlas setup.
2. Create an authenticated URI whose path is exactly `/supermarket_pos_demo`, for example `mongodb+srv://DEMO_USER:DEMO_PASSWORD@CLUSTER/supermarket_pos_demo?retryWrites=true&w=majority`. The values shown here are placeholders. URL-encode special characters in the database user's password.
3. Generate a separate strong `JWT_ACCESS_SECRET` and a separate shared login `DEMO_PASSWORD` (at least 16 characters, with letters and digits). Do not reuse private credentials. `DEMO_EMAIL` and `DEMO_PASSWORD` are used only by the operator initialization command; the public login form never contains them.

## Initialize or reset safely

From `backend/`, set the following environment variables in the operator's shell or a separate ignored demo environment file:

```powershell
$env:NODE_ENV = 'production'
$env:DEMO_MODE = 'true'
$env:MONGODB_URI = '<authenticated URI for supermarket_pos_demo>'
$env:JWT_ACCESS_SECRET = '<new demo-only signing secret>'
$env:DEMO_EMAIL = '<shared demo login email>'
$env:DEMO_PASSWORD = '<strong shared demo login password>'
npm run demo:init
```

`npm run demo:reset` repeats the same guarded operation. Both commands replace only the verified `supermarket_pos_demo` data with synthetic products, suppliers, customers, a purchase order and receipt, stock, and checkout-backed sales. They never create an Owner account. The database name, authenticated URI, mode, and demo login credentials are checked **before connecting**. The command has no public HTTP endpoint. Do not run the legacy `seed:demo` command for the public deployment; it is a local development seed with known test users.

The API rejects requests during a reset and the reset refuses to begin while requests are active. If a reset fails midway, the gate stays closed to prevent a partial dataset being served. Inspect the failure and repair the demo database before unlocking `DemoControl` in `supermarket_pos_demo`; do not unlock it while a reset process is running. A crashed API request can leave an admission count behind, which also requires operator inspection before resetting it.

For a scheduled reset, run `npm run demo:reset` from a trusted scheduler or CI job with the demo-only secrets. Keep those secrets out of public build logs. Schedule during low traffic and alert on a nonzero exit. Do not expose the reset command through an unauthenticated route or a public Vercel Cron URL.

## Vercel projects

1. Create a separate **demo backend** project with root directory `backend`. Set `NODE_ENV=production`, `DEMO_MODE=true`, the demo-only `MONGODB_URI`, the demo-only `JWT_ACCESS_SECRET`, and `CORS_ORIGINS` to the exact demo frontend origin. Set `COOKIE_SECURE=true` or leave it unset in production. Do not set `ADMIN_EMAIL`/`ADMIN_PASSWORD` there. Initialize the demo database before directing visitors to it.
2. Create a separate **demo frontend** project with root directory `frontend`. Set `VITE_DEMO_MODE=true` and `DEMO_API_ORIGIN=https://<demo-backend-host>` (origin only, no path or trailing slash). `frontend/vercel.ts` proxies `/api` to that backend under the frontend origin so the existing strict, secure refresh cookie continues to work. The private frontend keeps `VITE_DEMO_MODE` unset and retains its existing backend proxy destination.
3. Verify the frontend project routes `/api/health` to the demo backend. The API should report `status: ok` after initialization and database connection. Log in using the shared demo email/password, view products, reports and purchase history, then perform a test checkout. Verify that employee, settings, password, product deletion, and inventory adjustment requests return 403.

The demo role can read sample business data, view reports, calculate POS totals, open/close its register shift, hold carts, and create sales. Every other demo write is denied by the API before reaching its route; role permissions also deny administration and employee data. Product uploads are unavailable in demo mode. External product image URLs are permitted by the underlying catalogue; only synthetic seed data is installed by the initializer.

## Limits to plan for

- The demo uses the same shared account for visitors. Test sales and held carts are visible to later visitors until reset. Do not enter real customer information or real payment references.
- The API's current rate limit store is in process memory. It limits each instance but is not a global abuse control across Vercel instances; add Vercel firewall limits for a public launch.
- The demo API requires a MongoDB user with only `readWrite` on the demo database. Application guards also check the database name and authenticated role; Atlas database permissions remain the final boundary against a URI/configuration mistake.
- Express static uploads are not persistent on Vercel. The demo disables local upload serving and write routes; use managed object storage if you later want persistent image uploads.
