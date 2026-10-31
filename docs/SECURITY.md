# Security

Implemented controls. Auth, permissions, lockout, token rotation/revocation, idempotency and server-side pricing are covered by automated tests; headers, upload limits, log redaction and CSV-injection guarding are implemented but have no dedicated tests:

| Area | Control |
|---|---|
| Passwords | bcrypt (cost 11) via `bcryptjs`; never logged or returned; policy ≥ 8 chars with letters + digits; constant-time-ish unknown-user path |
| Login | rate limit (20 / 15 min / IP), account lockout after 5 failures (15 min), identical error for unknown email vs wrong password |
| Sessions | 15-min JWT access token in **memory only**; opaque refresh token in an `httpOnly`, `SameSite=Strict`, `Secure` (production) cookie scoped to `/api/v1/auth`; stored hashed; **rotated on every use**; reuse of a rotated token revokes the entire family |
| Immediate revocation | every request re-reads the user: disabling an account, changing role, or resetting/changing a password bumps `tokenVersion` and kills outstanding access tokens at once |
| CSRF | state-changing cookie endpoints (`/auth/refresh`, `/auth/logout`) require the custom header `X-Requested-With: pos-web` in addition to SameSite=Strict; all other endpoints use bearer tokens (not ambient credentials) |
| Authorisation | permission matrix in `config/permissions.ts`, checked by `requirePermission` on every route; cashiers can only read their own sales/shifts; frontend checks are UX only |
| Input | zod validation on bodies/queries; unknown keys stripped; ObjectId params validated; query strings only accept strings (operator objects such as `?q[$ne]=x` fail validation) → NoSQL-injection resistant. Regex searches escape user input |
| Money & stock | prices, discounts, tax, totals, stock checks and payments computed on the server; client-sent totals are only an optional `expectedTotalCents` guard |
| Discount control | cashier limit and absolute maximum are settings; exceeding the limit requires `discount.override` |
| Headers / CORS | Helmet defaults; CORS allow-list from `CORS_ORIGINS`; `x-powered-by` off |
| Uploads | JPEG/PNG/WebP only, 2 MB, random server-chosen filenames, served with `nosniff` |
| Output | React escapes by default; no `dangerouslySetInnerHTML`; CSV export neutralises formula injection (`= + - @`) |
| Errors | central handler; stack traces/messages of unexpected errors hidden in production |
| Logging | pino with redaction of authorization, cookies, passwords, tokens |
| Audit | login/failed login, sales, refunds, price/cost changes, inventory adjustments, receiving, employee changes, password resets, settings, shifts, cash adjustments, promotions |
| Cards | the app records a card tender amount + optional terminal reference. It never handles card numbers/CVV and **makes no PCI claim** |
| Secrets | `.env` is git-ignored; `.env.example` has placeholders; no secrets reach the client bundle |

## Not covered / recommended before real use
* Penetration test and dependency audit (`npm audit` currently reports advisories in dev tooling – review before deployment).
* TLS termination, WAF/reverse-proxy rate limiting by real client IP (`trust proxy` is set to 1 in production).
* Server-side file content sniffing/AV scanning of uploads; object storage instead of local disk.
* MFA, password breach checks, session management UI (list/revoke devices).
* Tamper-evident (append-only/WORM) audit storage – current audit rows are normal documents, protected only by application code and DB permissions.
* Backups, retention policy and privacy-law review for customer personal data (name, phone, email, address).
