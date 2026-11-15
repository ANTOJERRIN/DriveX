# Sign-in deployment procedure

Source: [sign-in implementation plan](prompts/DriveX-Sign-In-Fix-Plan.md).
The prompt's deployment findings describe an earlier revision; inspect the
current service before treating them as current production state.

The local default `npm start` launches `backend/neon/server.mjs` and
`npm run build` generates only the Neon provider selector. Both `render.yaml`
and `render.neon.yaml` describe a Node staging service. There is no legacy
Supabase Blueprint in the current repository. Do not use a Python static server
for the Neon application: it cannot serve the authentication API.

## Before cutover

1. Inspect the existing [production service settings](https://dashboard.render.com/web/srv-db3lekm0tbcc73813860/settings).
   Establish whether it is a Node web service or a static-site resource.
2. In Neon, select the intended production branch, enable Neon Auth, and set
   `https://drivex-2spi.onrender.com` as a trusted origin. Configure confirmation
   and reset email delivery. Keep the Auth base URL in `NEON_AUTH_URL`.
3. Set Render `APP_ORIGIN=https://drivex-2spi.onrender.com` and a restricted
   app-role `DATABASE_URL` for that same environment. Check runtime grants
   using the [migration guide](docs-neon-migration.md). Never deploy the owner
   connection or put secrets in the browser config.
4. If schema setup is needed, run `npm run db:plan`, show its pending migration
   output, and obtain the owner's explicit **yes** before `npm run db:migrate`.
5. Establish whether historical users, roles, bookings and receipts have been
   imported and reconciled. Fresh schema setup does not transfer records or
   passwords. Arrange verified Neon account setup. Use staging while account
   migration or data reconciliation remains pending.

## Existing Node service settings

Retain the existing production service URL after the preceding gates pass.

| Setting | Value |
| --- | --- |
| Build Command | `npm ci && npm run check` |
| Start Command | `node backend/neon/server.mjs` |
| Health Check Path | `/healthz` |

`npm start` is also a Node entry point in the current package. The staging
Blueprint additionally runs `npm run build` to regenerate the provider-only
file; the Node server serves `/config.mjs` directly. A successful static asset
build alone does not demonstrate API readiness.

## Acceptance after deploy

Run the public, read-only check from this repository:

```sh
npm run deploy:smoke -- https://drivex-2spi.onrender.com
```

It requires HTTP 200 from all three endpoints: `/config.mjs` selects Neon,
`/healthz` reports `ready: true`, and `/api/auth/get-session` returns JSON with
`signedIn: false` without credentials. It rejects redirects and HTML fallbacks
and prints only endpoint paths and status codes. Readiness checks the database
dispatcher, not Auth configuration, grants or historical data completeness.

Then use a verified test learner over HTTPS. Check email sign-in, session
restoration, dashboard loading and refresh, sign-out, invalid credentials and
password reset. Test a verified instructor and its database-assigned role.
Inspect browser Network status codes and correlate with Render logs privately;
never copy passwords, cookies or tokens into the deployment record.

Record the deployed commit, Render deploy ID, commands, health path, public
check output and dated browser acceptance results. Until these pass, describe
production sign-in as **NOT VERIFIED**. If cutover fails, restore an earlier
app-and-backend configuration with recorded passing acceptance results, then
repeat these checks. Keep historical data intact.

## EVIDENCE: 2026-11-12 implementation

Local `npm test` followed by `npm run check` (via `npm.cmd` because PowerShell
blocks `npm.ps1`):

```text
ℹ tests 110
ℹ suites 0
ℹ pass 110
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 18499.1192

> drivex@0.2.0 check
> node scripts/check.mjs

Syntax checks passed for 54 JavaScript modules.
```

`npm run build`:

```text
Generated Neon provider configuration; no database credentials included.
```

Public `deploy:smoke` against the production URL, with network access outside
the sandbox, exited 1:

```text
FAIL /config.mjs (HTTP 200)
FAIL /healthz (HTTP 404)
FAIL /api/auth/get-session (HTTP 404)
Public readiness only; account sign-in, cookies and historical data still require acceptance checks.
```

`npm run db:plan` exited 1 before connecting:

```text
Set MIGRATION_DATABASE_URL privately for the dedicated Neon database.
```

Production sign-in, Neon Auth origin configuration, database grants and
historical account/data availability are **NOT VERIFIED**. Render MCP reported
no selected workspace; service inspection awaits the owner's workspace
selection. No hosted migration or deployment was performed in this step.
