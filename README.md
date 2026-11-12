# DriveX

A driving-school application for learners, instructors and administrators.
Vanilla JavaScript frontend, a Node backend on Render, and Neon Auth/PostgreSQL.

Learners buy 10-Day (INR 1,500 / 10 credits) or Monthly (INR 4,000 / 30 credits)
plans. Booking reserves a credit; instructor completion consumes it once.
The database decides prices, roles, payment status and booking ownership.

## Migration status

The current source targets Neon. Hosted migration and deployment are **NOT
VERIFIED**: no Neon owner connection is configured in this workspace. Historical
Supabase accounts and records have not been imported. Read the
[Neon migration guide](docs-neon-migration.md) before provisioning or switching
production traffic. Existing SQL migrations are preserved in
`supabase/migrations/`; the runtime has no requirement for a Supabase project.

For the production sign-in deployment settings and endpoint checks, follow the
[sign-in deployment procedure](docs-sign-in-deployment.md).

## Development and checks

Use Node 22+. Copy `.env.example` to the ignored `.env` and configure Neon
privately. Never send connection strings in chat or place them in `dist/`.

```sh
npm ci
npm test && npm run check
npm run audit:secrets
npm run build
npm start
```

The server requires the exact HTTPS `APP_ORIGIN`, the branch's
`NEON_AUTH_URL`, and the restricted `DATABASE_URL`. Use TLS database
connections. The migration-owner connection is separate and is never deployed
to the running application. The browser receives only `{provider:'neon'}`.
For local HTTP interface exercises without hosted credentials, use
`node tests/browser-server.mjs` (the isolated legacy fixture on port 3100).

```sh
npm run db:plan
# Show the plan and obtain the owner's explicit yes before:
npm run db:migrate
```

The plan command is read-only. The migration runner applies the historical
schema in order and records it atomically. It omits the Supabase-only
notification scheduler. It refuses unmanaged schemas and unknown history.

## Application flows

- Learner: signup/confirmation, sign-in/reset, plans, checkout, payment polling,
  booking/cancellation, learning progress and recommendations.
- Instructor: administrator-assigned access, teaching hours, schedule, learners,
  practical progress, post-lesson assessments and school plan collections.
- Administrator: instructors, fleet, bookings, receipts/refund records, theory
  resources and notification queue status.
- Payments: verified cookie session, server-priced Razorpay order and signed,
  database-deduplicated webhook. A checkout callback cannot activate credits.
- Emails: restricted worker RPC, transactional queue and Resend. An external
  private scheduler must call `npm run notifications:run`.
- Reliability: role-scoped navigation, stale-session suppression, read-only
  reconciliation after uncertain writes, and a public offline/install shell.

## Backend boundary

The browser calls same-origin `/api/auth/*`, `/api/drivex` and
`/api/create-order`. Neon Auth verifies session ownership and email status.
The Node gateway sets the resulting identity for the current database
transaction and calls `public.drivex(action,payload)`. Browser roles cannot
access tables or private helpers directly.

Payment registration, webhook reconciliation and email jobs use a separate
restricted worker connection (`NEON_SERVICE_DATABASE_URL`). Provider keys,
worker tokens and database URLs stay in server environment variables.
`MIGRATION_DATABASE_URL` belongs only in the operator's private environment.

## Source map

| Path | Responsibility |
| --- | --- |
| `dist/app.mjs`, `dist/portals/` | Application screens and interactions |
| `dist/neon-api.mjs` | Cookie-based same-origin client |
| `backend/neon/http.mjs` | Auth proxy, domain APIs, payment/email routes and static assets |
| `backend/neon/server.mjs` | Production pools, listener and shutdown |
| `backend/neon/gateway.mjs` | Transaction-scoped identity and restricted service RPCs |
| `backend/neon/migrate.mjs` | Read-only migration plan and explicit apply command |
| `backend/neon/*grants.sql` | Owner-run restricted app/worker provisioning |
| `supabase/migrations/` | Immutable historical schema and forward-only corrections |
| `supabase/functions/_shared/` | Shared testable payment/email logic; Neon injects direct RPC adapters |
| `tests/neon*.test.mjs` | Neon migration, privacy, HTTP payment/lesson/email and session tests |
| `render.yaml`, `render.neon.yaml` | Node staging service blueprint |
| `docs-neon-migration.md` | Setup, existing-data limits and acceptance procedure |

The older Supabase client/fixtures are retained for regression coverage and
historical compatibility. They are not selected by the default Neon build.
