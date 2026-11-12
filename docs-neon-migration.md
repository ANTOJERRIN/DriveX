# DriveX on Neon

## Review of the requested implementation brief

Source: [DriveX-Neon-Auth-and-Database.md](prompts%20resources/new/DriveX-Neon-Auth-and-Database.md).
Its PR #4 / 98-test status describes the earlier staging implementation, now
merged into main. The current continuation preserves that architecture and
completes the code connections that its final section left pending.

| Brief requirement | Current implementation / local coverage |
| --- | --- |
| Same-origin signup, sign-in, sign-out, session and reset | `backend/neon/http.mjs`, `dist/neon-api.mjs`; session/privacy/reset-forwarding tests |
| Verify Neon identity and email before protected operations | Server session lookup plus `gateway.mjs`; anonymous/unverified access tests |
| Stable UUID and database-owned roles | Provider-subject mapping in a transaction; separate users and role-spoof tests |
| Fresh Neon migrations, skip Supabase scheduler | Read-only plan, explicit apply, transaction lock/ledger; replay and unmanaged-schema tests |
| Restricted server login; no browser DB credentials | App and worker grant scripts; direct-table/service-call denial tests; provider-only build |
| Plan/credit/booking/receipt rules | HTTP tests for signed payment/replay, manual receipt, overlapping reservation rejection, completion and cancellation |
| Razorpay and notification cutover | Direct server RPC adapters for the existing handlers; HTTP purchase and email-queue tests |
| Actual provisioning, deployment and acceptance | NOT VERIFIED: requires target Neon access and hosted environment configuration |
| Historical account/data migration | Not performed; requires recoverable source data and reviewed identity mapping |

## Runtime

The default runtime is the Node web service in `backend/neon/`, Neon Auth and
Neon PostgreSQL. The browser uses same-origin APIs and receives only a provider
selector. Prices, roles, payments, bookings and credits remain in the authorized
`public.drivex(action,payload)` dispatcher. The historical SQL directory is
retained unchanged; its name does not imply a hosted Supabase dependency.

## Database preparation

1. Select a dedicated DriveX staging database/branch and enable Neon Auth with
   verified email required. Configure its trusted application origin and email
   delivery. This bootstrap expects no existing `auth` or `drivex_private`
   schema unless the DriveX Neon migration ledger already exists. Do not enable
   a direct browser Data API or reuse an unrelated application's database.
2. Put the owner's TLS connection string in `MIGRATION_DATABASE_URL` in the
   ignored local `.env` file. Never put it in chat, frontend config or the running
   web service. Use Node 22+ and run `npm ci`.
3. Run `npm run db:plan`. It opens a read-only transaction, reports pending
   migration filenames, and makes no schema changes. Show the output to the
   owner and obtain explicit approval before `npm run db:migrate`.
4. The apply command serializes migrations with a transaction lock, applies them
   and records each filename atomically. Reruns skip recorded files. The
   Supabase Vault/pg_net notification scheduler is deliberately omitted. Unknown
   recorded migrations or unmanaged existing schemas require investigation.
5. Create separate restricted LOGIN roles `drivex_app` and `drivex_worker`
   using the Neon console/private owner session. Neither may own schemas or
   have platform admin privileges. Apply `backend/neon/runtime-grants.sql` for
   the app and `backend/neon/service-grants.sql` for the worker.
6. Run `supabase/verify.sql` as the owner. All returned checks must be true.
   Inspect grants and hosted cross-connection booking/credit behavior separately.
   Store the app login as `DATABASE_URL` and worker login as
   `NEON_SERVICE_DATABASE_URL` in the Node environment. These are distinct from
   the owner connection.

The compatibility `auth.users` table contains stable local UUID mappings; it
does not contain Neon passwords. Each protected request checks its cookie with
Neon Auth, then maps the verified provider subject to a local UUID within the
same transaction as its dispatcher call. User-supplied roles and IDs do not
establish identity. Existing accounts start as learners; after their first
sign-in an administrator can assign instructor access. Bootstrap only the actual
owner, using the local `auth.users.id` and `backend/bootstrap-admin.sql`.

## Render service

Use `render.yaml` (or identical `render.neon.yaml`) for a **new Node service**
when staging is needed. The blueprint uses a free staging service and manual
deploys. For the existing production Node web service, follow the
[sign-in cutover procedure](docs-sign-in-deployment.md) to retain its URL and
replace any legacy static-server commands. A Render static-site resource needs
a separate Node web service. Database migrations are operator commands, never
part of the build or startup.

Required settings: `APP_ORIGIN` (exact HTTPS origin), `NEON_AUTH_URL` (the
branch's full Auth base URL), `DATABASE_URL`. Optional payment/email features
also need `NEON_SERVICE_DATABASE_URL`. See `.env.example` for variable names.
Build: `npm ci && npm run build && npm run check`. Start: `npm start`.
The service binds `0.0.0.0:$PORT` and exposes a read-only `/healthz`.
Health does not establish Auth, email or payment readiness.

The default frontend build includes no database URLs, provider credentials or
public Supabase keys. Auth cookies are forwarded only to the configured Neon
Auth endpoint; responses rewrite the cookie's scope to the application origin.
Browser acceptance of the actual secure cookies must be tested over HTTPS.

## Payments and notifications

- Configure `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and
  `RAZORPAY_WEBHOOK_SECRET` privately. Live mode remains disabled unless
  `RAZORPAY_ALLOW_LIVE=true`. Start with test mode.
- Browser checkout calls `POST /api/create-order`. The verified session must
  own the enrollment. The server reads the price from the dispatcher, creates
  a Razorpay order, and binds it using the restricted worker connection.
- Set the provider webhook URL to `APP_ORIGIN/api/razorpay-webhook`, with
  `payment.captured`, `order.paid`, and `payment.failed` events. This endpoint
  checks the raw-body HMAC and uses persistent database event deduplication.
  Replays return success without granting extra credits. Browser callbacks
  never activate a plan.
- Configure `RESEND_API_KEY`, `RESEND_FROM`, `DRIVEX_APP_URL` and a private
  `NOTIFICATION_WORKER_TOKEN` of at least 32 characters. Schedule
  `npm run notifications:run` every minute in a private external scheduler.
  The script calls `POST /api/notification-worker` with a bearer header.
  Never put the token in a URL. No paid scheduler is provisioned automatically.
- The notification queue claims at most ten jobs, enqueues due reminders,
  retries failed sends with leases/backoff and limits attempts. Without an
  external schedule, queued messages are not delivered automatically.
- SQL firewall inspection/atomic limits run on actual dispatcher calls.
  `backend/neon/firewall.mjs` is a historical, unused prototype; its action
  aliases and in-memory webhook replay set are not the runtime authority.

## Existing data and acceptance

This migrates schema and runtime code. It **does not import historical Supabase
users, passwords, enrollments, bookings or receipts**. Keep the old database
intact. If there is historical data, recover an export and design/review an
identity mapping that preserves UUIDs and ledger relationships. Never associate
accounts using unverified email or re-run fresh bootstrap over existing data.

Local tests exercise the actual Neon HTTP server, database dispatcher and
payment/email handlers with PGlite and external-service fixtures. Hosted Auth
cookies, confirmation/reset emails, Razorpay, Resend delivery, Neon permissions,
cross-connection locking and mobile appearance remain NOT VERIFIED until run
against the intended staging service.

Before production, exercise two learners, the owner and an instructor through
confirmation, sign-in/reset/sign-out, instructor assignment, plans, test payment,
webhook replay, booking/cancellation, completion, progress, email retry and
reminders. Check payment polling and saved-write recovery, screen refresh,
network failures, session isolation and mobile/offline behavior. Do not switch
traffic before historical data and hosted acceptance have been reviewed.

References: [Neon Auth flow](https://neon.com/docs/auth/authentication-flow),
[Supabase migration guide](https://neon.com/docs/auth/migrate/from-supabase),
[Render web-service deployment](https://render.com/docs/deploys).

## EVIDENCE: 2026-11-12 continuation

Final local `npm test && npm run check` output:

```text
ℹ tests 107
ℹ suites 0
ℹ pass 107
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 17851.0646

> drivex@0.2.0 check
> node scripts/check.mjs

Syntax checks passed for 52 JavaScript modules.
```

Build and credential-pattern scan:

```text
Secret audit: 135 files and 40 Git commits inspected; no credential matches.
Generated Neon provider configuration; no database credentials included.
```

Hosted `npm run db:plan` stopped before connecting:

```text
Set MIGRATION_DATABASE_URL privately for the dedicated Neon database.
```

No hosted migration, historical data import or Render deployment was performed.
