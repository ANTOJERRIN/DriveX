# DriveX implementation plan

Reviewed on 2026-11-12 against GitHub `ANTOJERRIN/DriveX`, feature branch
`feat/drivex-product-completion`, head `e4de51e`.

## Scope and architecture

Continue the existing learner, instructor and administrator application. Retain
vanilla JavaScript in `dist/`, Supabase Auth/Postgres/Edge Functions and Render
unless the owner explicitly chooses a hosting migration. Domain data stays behind
`public.drivex(action, payload)`. Plan prices, roles, payment state and credit
consumption stay server-controlled.

## Review findings

- The feature branch adds a backend firewall beyond the existing main branch.
- The initial local test run reported 99 passes and two failures (the failed
  firewall subtest and its parent). A denial audit inserted before an exception
  rolls back with the RPC transaction; it cannot be advertised as a durable log.
- The rate limiter has a separate first-insert conflict path without the limit
  predicate. Replace it with one atomic, bounded upsert.
- A synthetic firewall test action is exposed to authenticated callers. Exercise
  actual application actions in tests and remove this production test route.
- Existing release notes describe historical hosting blockers. Recheck connected
  resources before treating those notes as current environment evidence.

## Implementation sequence and acceptance

1. **Backend reliability:** add a new migration; make bucket updates atomic;
   emit denial diagnostics to Postgres logs; describe transactional counters
   honestly; remove the synthetic action and require a real profile. Test real
   RPC thresholds, reset boundaries, account isolation and privilege boundaries.
2. **Application journeys:** run the actual HTTP client/dispatcher/payment-handler
   tests for pending purchases, signed events, booking, cancellation, completion,
   progress, schedule changes and recovery after connection failures.
3. **Interface acceptance:** inspect the existing application in a browser with
   the isolated fixture, including learner, approved/pending instructor and admin
   screens. Inspect mobile layout, keyboard access, errors and empty states.
4. **Release preparation:** run `npm test && npm run check`, the secret scan and
   public-config build. Record actual evidence and distinguish local fixtures
   from hosted acceptance. Keep changes in small commits.
5. **Hosted acceptance:** inspect the intended Supabase and Render resources,
   migration history, environment setup and Auth redirects. Run the database
   push dry-run, show its output and wait for the owner's explicit yes before
   applying migrations. Then exercise real Auth, test-mode payments, email and
   deployed-browser journeys before declaring a live release.

## Current continuation status

- Added `20261112152548_firewall_reliability.sql` through the Supabase CLI.
  Existing migration files remain unchanged.
- The targeted firewall run passed all six tests. Regression coverage now uses
  real application actions and includes reset, role, payload and helper boundaries.
- The public-config build completed. The generated local configuration is not a
  requested source change and is excluded from the continuation commit.
- Connected Supabase status and restoration were retried: inactive and rejected
  for the active free-project limit. Hosted acceptance is blocked.
- Browser/native access reported unavailable. Visual/mobile acceptance is
  NOT VERIFIED. No new hosting platform has been created.
- Full local checks passed: 102 tests, zero failures, and syntax checks for
  43 JavaScript modules. The real HTTP client/dispatcher/payment-handler journeys
  are included in that suite. These results establish local fixture behavior.

## EVIDENCE:

Last output lines from this continuation's commands:

```text
ℹ tests 102
ℹ suites 0
ℹ pass 102
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 15054.9221

> drivex@0.2.0 check
> node scripts/check.mjs

Syntax checks passed for 43 JavaScript modules.
```

```text
> drivex@0.2.0 build
> node scripts/generate-config.mjs

Generated dist/config.mjs with validated public configuration.
```

The generated config was restored to the tracked version after the build.

```text
Secret audit: 119 files and 37 Git commits inspected; no credential matches.
```

## Remaining release work

Hosted deployment and visual acceptance are incomplete. Resolve the Supabase
capacity limit; then inspect actual migration history and run the approved
dry-run process. Apply only after the owner says yes to its output. Complete
hosted Auth, Razorpay test-mode, email, concurrency and phone/desktop acceptance
before releasing the frontend. Follow `RELEASE.md` for those steps.

## Validation limits

PGlite runs the migrations and authorization tests locally; it does not establish
cross-connection locking in hosted Postgres. SQL exceptions roll back table
writes, including denial audits. Provider logs must be checked in the hosted
environment. No production reset, migration rewrite or automatic payment charge
is part of this plan.
