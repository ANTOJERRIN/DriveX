# DriveX

A plan-based driving-school app for learners, instructors and school administrators. Frontend: vanilla JavaScript in `dist/`. Backend: Supabase Auth, Postgres and Edge Functions. Hosting: Render.

Learners buy the 10-Day plan (INR 1,500 / 10 credits) or Monthly plan (INR 4,000 / 30 credits), choose an approved instructor and reserve one-hour lessons. One credit is consumed when the assigned instructor completes a lesson. Prices, roles, payment state and credit balances are server-controlled.

## Release status

The local changes are **not a live release**. The dedicated Supabase project `gakrpgdwvtfvfbvtbofu` reported inactive; restoration was rejected because the organization reached its free-project limit. No database migration, Edge Function deployment or Render deployment was performed in this work. The user has authorized publishing the release branch to GitHub. Hosted deployment remains on hold pending environment setup and acceptance checks.

Hosted Auth/SMTP, actual Razorpay test payments, email delivery/cron, production migration history, browser/mobile appearance and concurrent sessions against hosted Postgres are **NOT VERIFIED**. See [the product audit](docs/PRODUCT_AUDIT.md) for the inventory and [the release procedure](docs/RELEASE.md) for remaining steps. The additional requested abilities—editable instructor hours, transactional email and the installable/offline shell—are implemented locally; [their setup guide](docs/ADDITIONAL_ABILITIES.md) lists the hosted checks.

## Product flows

- **Learner:** signup/confirmation, login/recovery, plans, secure checkout, payment status, booking/cancellation, theory videos and learning progress.
- **Instructor:** pending/rejected application status; after admin approval, current learners, practical milestones, schedules, post-lesson assessment and attributable school plan collections.
- **Administrator:** instructor review, all bookings, actual vehicle management, school receipts, full-refund records for eligible unused plans and theory-video resources.
- **Payments:** the server creates and stores a Razorpay order. Signed webhooks reconcile payment events; the browser polls the database and never activates a plan from the checkout callback alone. Test mode is the default. Manual receipt entry records money already received by staff.
- **Credits:** confirmed reservations cannot exceed unspent credits. Completion consumes a credit exactly once; cancellation before start releases the reservation. The database prevents overlapping learner, instructor and vehicle bookings.
- **Availability:** instructor/admin weekly hours and blocked dates control the actual slots. Edits that invalidate an existing lesson are rejected.
- **Notices:** booking, cancellation, refund and reminder events enter a private queue. A protected worker sends plain-text emails through Resend with capped retries and provider idempotency keys. Admins can inspect status and retry failed jobs.
- **Offline/install:** supporting browsers can install DriveX. Offline navigation shows a public reconnect page. Account data, API responses, sessions and payments are not cached or replayed by the service worker.

## Development

Use Node 20+ and Python 3. The existing lockfile pins the single test dependency, PGlite.

```sh
npm ci
npm test && npm run check
npm run audit:secrets
npm start
```

Open `http://localhost:3000`. For public build configuration, set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` locally or in Render, then run `npm run build`. A local ignored `.env` is supported. Never supply service-role or Razorpay secrets to the static build. Public config is validated before being written.

PowerShell users with script execution restrictions can use `npm.cmd`.

An isolated UI fixture is available with `node tests/browser-server.mjs` at `http://127.0.0.1:3100`. It uses test-only Auth responses and the real dispatcher in PGlite, and never contacts the hosted backend or payment provider. It is not production authentication or a production server.

## Source map

| Path | Responsibility |
| --- | --- |
| `dist/app.mjs` | Auth flow, role routing, state, forms and interactions |
| `dist/presentation.mjs` | Escaped views, navigation, progress and formatting |
| `dist/portals/`, `dist/scheduling.mjs` | Role-specific views, teaching-hours editor and email-status screen |
| `dist/pwa.mjs`, `dist/sw.js`, `dist/manifest.webmanifest` | Installation, offline status and public-shell caching |
| `dist/checkout.mjs` | Razorpay SDK loading and database status polling |
| `dist/api.mjs` | Supabase Auth session/refresh and authenticated RPC/Edge requests |
| `dist/public-config.mjs` | Shared frontend/build public-key validation |
| `dist/styles.css`, `dist/product.css` | Responsive presentation and accessibility |
| `supabase/migrations/` | Append-only database history; the new migration repairs the product after 0004 |
| `supabase/functions/_shared/payments.mjs` | Testable order and webhook handlers |
| `supabase/functions/_shared/notifications.mjs` | Protected transactional email worker and deterministic message rendering |
| `supabase/preflight.sql`, `supabase/verify.sql` | Read-only pre-release data and post-migration security checks |
| `backend/schema.sql` | Historical initial schema; never reapply over the connected project |
| `backend/bootstrap-admin.sql` | Owner-controlled initial admin access |
| `tests/` | Database, upgrade, payment-handler, configuration and frontend tests |
| `scripts/check.mjs` | Syntax checks for all JavaScript modules |
| `scripts/audit-secrets.mjs` | Credential-pattern scan of source and reachable Git history; reports locations without values |
| `render.yaml` | Static deployment, config injection, routing and security headers |
| `API_CONTRACT.md` | Actual dispatcher and service-only payment API |

## Backend boundary

Every browser domain-data operation goes through `public.drivex(action,payload)`. The public function is a security-invoker wrapper around the private authorized dispatcher. Application tables have RLS and no direct browser privileges. Roles are read from protected profiles, not user-editable metadata or browser state.

Only server-side Edge Functions can register provider orders or reconcile payment events through their restricted service RPCs. Secrets remain in Supabase. Fresh signup metadata can request an instructor application; it cannot approve that application or grant administrator access.

Existing `0001..0004` migrations are retained unchanged. The new migration preserves historical records, requires renewed instructor review, deactivates exact placeholder fleet entries and flags browser-activated payments for actual receipt review. Review these effects before deployment. Read `docs/RELEASE.md` before applying anything to the live project.
