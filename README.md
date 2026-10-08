# DriveX

Driving-school management with Supabase authentication and persistent Postgres operations. **The mock application has been removed.** Production starts empty; there are no sample users, bookings, scores or payments.

## Current deployment status

Connected to the dedicated **Drivex** project (`gakrpgdwvtfvfbvtbofu`) in **ANTOJERRIN's Org**. The initial backend schema and extension relocation migrations have been applied. The frontend uses the project's public publishable key.

All four private tables have RLS enabled and no direct browser read/write privileges. The anonymous RPC is denied; authenticated calls are authorized in the dispatcher. No sample application records were inserted.

The owner must still configure the Supabase Auth Site URL / redirect URLs, create and confirm their account, and bootstrap administrator access. SMTP/email delivery and a complete user booking journey remain to be verified. Online checkout is not connected; payments are recorded from actual school receipts.

## Local run and tests

Node 20+ and Python 3:

```sh
npm ci
npm test
npm run check
npm start
# http://localhost:3000
```

There is no frontend build or CDN JavaScript dependency. Google Fonts is optional; system fonts are the fallback.

## Connect the real backend

1. The dedicated **Drivex** project in ANTOJERRIN's Org is already connected.
2. `backend/schema.sql` is already applied. Do not apply it again to the connected project. It is retained for reproducible setup in a fresh database.
3. Configure Supabase Auth's Site URL to your deployed app URL and allow `http://localhost:3000` for local testing. Keep email confirmation enabled. Configure SMTP for reliable signup/password-reset delivery.
4. The project URL and **publishable** key in `dist/config.mjs` are configured. They are public client configuration. Never place a service-role/secret key in the frontend, GitHub, or chat.
5. Deploy the configured frontend, create the owner's account, confirm email and sign in once. It initially has student access.
6. Bootstrap the first administrator with the account's verified Auth user UUID using `backend/bootstrap-admin.sql`. The SQL deliberately requires a UUID; the first arbitrary signup never gets administrator access.
7. Have instructors create their accounts. An admin can assign instructor access by account email, and add real training vehicles. Students can now reserve lessons.

## Functional flows

- **Authentication:** email/password signup and sign-in, confirmation callback, password reset, refresh tokens and sign-out. Only auth session tokens are stored in sessionStorage; domain records always come from Postgres.
- **Roles:** student/instructor/admin role is a protected database field. There is no client role switcher and no user-metadata authorization.
- **Booking:** real availability, one-hour lessons within 90 days, server-set ₹800 price, 30-minute unpaid reservations, atomic database exclusion constraints for instructor/vehicle/student overlap.
- **Payments:** administrator records an actual payment received directly by the school, with a unique receipt/reference and explicit verification. This is a persistent receipt ledger, **not online payment processing**. Students cannot mark themselves paid.
- **Cancellation:** unpaid reservations release immediately; paid lessons become cancellation/refund requests. Only an administrator can record the actual completed refund. The app never claims to move money.
- **Instructor:** sees only assigned confirmed/completed lessons and relevant student contact information. Can assess only their own completed-in-time lessons; scores and notes persist and appear in student progress.
- **Admin:** manages real instructor accounts and vehicles; views bookings, records payments and refund receipts.

Online Razorpay/UPI checkout is not connected and requires separate payment-provider configuration. No simulated checkout remains.

## Backend security and architecture

`public.drivex(action, payload)` is a restricted, security-invoker RPC entrypoint. It delegates to one authenticated dispatcher in the non-exposed `drivex_private` schema. The private security-definer function intentionally owns transactions spanning bookings and payments; it checks `auth.uid()` on every call and validates role and row ownership per action.

All tables have RLS enabled and browser roles have **no direct table privileges**. Privileged execution is granted only to authenticated users on the bounded dispatcher. The function uses an empty search path and schema-qualified objects. Roles are read from protected rows on every call, so no stale JWT role claims are used.

Expiration is evaluated on reads, availability and reservations. A periodic cleanup task is not required for correctness: overdue holds are ignored for availability and expired transactionally before new reservations. GiST exclusion constraints remain the final concurrency guard. Payment receipt replay is idempotent for an already-confirmed booking with the same reference.

## Source layout

| Path                          | Responsibility                                           |
| ----------------------------- | -------------------------------------------------------- |
| `dist/app.mjs`                | Role-specific screens, forms, loading/empty/error states |
| `dist/api.mjs`                | Supabase Auth and authenticated RPC client               |
| `dist/config.mjs`             | Public project URL/publishable key                       |
| `dist/styles.css`             | Responsive design                                        |
| `backend/schema.sql`          | Real tables, transaction rules and authorization         |
| `backend/bootstrap-admin.sql` | Explicit owner-controlled first-admin setup              |
| `tests/database.test.mjs`     | PostgreSQL integration tests                             |

## Validation

10 passing test entries (one parent plus nine scenarios) execute the actual schema and functions in the PGlite PostgreSQL engine. Only the test harness creates isolated auth fixtures; these never ship as application records. Checks cover role escalation denial, empty initial state, instructor/vehicle provisioning, persistent reservations, overlap rejection, row privacy, direct-table denial, admin-only receipts, idempotency, feedback timing/ownership/range, refund workflow, expiry, and anonymous access rejection.

JavaScript syntax checks also pass. Supabase-hosted Auth/email delivery, PostgREST grants in a live project, cross-session concurrency, browser visual QA, and WebMCP runtime support remain unverified until the project is connected. The app is not represented as a completed live service while configuration is missing.
