# DriveX release procedure

The source changes are not a live deployment. Do not publish the new frontend against the old dispatcher. Restore backend access, establish the actual migration history, apply the new backend, configure/test payments and notifications, and then release the frontend. [ADDITIONAL_ABILITIES.md](ADDITIONAL_ABILITIES.md) covers teaching schedules, email/cron setup and offline installation.

## Current external blockers

- Supabase project `gakrpgdwvtfvfbvtbofu` is inactive. The restore tool rejected the request because of the organization's free-project limit. The owner must resolve capacity or upgrade; no unrelated project should be paused or deleted automatically.
- Supabase CLI and Deno were not available in this workspace. Local migration and Edge-handler tests use PGlite and Node; they do not prove hosted deployment.
- Render MCP had no workspace selected, so no hosting settings were changed.
- Browser visual/mobile checks are NOT VERIFIED: Computer Use could not confidently identify the browser URL and stopped.
- GitHub branch publication is authorized by the user's latest instruction; production deployment remains gated by the hosted checks.

## Local checks

Use Node 20+ with the existing lockfile. On PowerShell machines that block `npm.ps1`, use `npm.cmd`.

```sh
npm ci
npm test && npm run check
```

The suite loads every `.sql` migration in filename order. Its upgrade fixture creates historical records before the new migration, then checks that the records survive with the intended review flags. The HTTP integration test runs the actual API client through order/webhook handlers and the actual dispatcher/database using isolated Auth/provider fixtures. The tests make no charges.

`npm run audit:secrets` inspects current source and reachable Git history for credential patterns without printing matched values. This is a pattern scan, not a guarantee that every possible credential format is recognized; `.env` remains ignored and no server secrets belong in the static app.

For isolated manual UI checks:

```sh
node tests/browser-server.mjs
```

Open `http://127.0.0.1:3100`. Test-only accounts are `student@example.test`, `instructor@example.test`, `admin@example.test` and `pending@example.test`, with password `fixture-password`. This local fixture never calls a real Supabase project or Razorpay. Stop it after testing; it is not a production server.

## Database release

1. Restore the dedicated project and take an appropriate backup. Review the owner account and existing instructor/payment records.
2. With an installed, authenticated CLI, inspect `supabase --help`, `supabase migration --help` and `supabase db push --help`, then link the intended project and inspect its migration history:

   ```sh
   supabase link --project-ref gakrpgdwvtfvfbvtbofu
   supabase migration list
   ```

3. Run `supabase/preflight.sql` read-only. Investigate duplicate identifiers, multiple unfinished enrollments and over-reserved balances. Do not delete historical records or change migration history merely to silence errors.
4. The existing files `0001..0004` are unchanged. If some were applied in the SQL editor or under different historical versions, reconcile the actual history before proceeding. Do not blindly reapply `0001` or guess `migration repair` commands.
5. Run `supabase db push --dry-run` and inspect its full output before any actual push. Apply only after the intended pending migrations and existing schema agree, following `AGENTS.md` and the current session's authorization.
6. Run `supabase/verify.sql`; every schema/security check must return true. Inspect Supabase security advisors.
7. Review the deliberate migration effects: existing instructors become pending; the three exact placeholder fleet records become inactive; historical direct/synthetic paid records are flagged for receipt review. Reapprove real instructors, activate only real vehicles, and reconcile receipts in the admin portal. User records, bookings and payment history are retained.

## Authentication and owner setup

- Set Supabase Auth Site URL to the real Render URL. Add only the required production and local callback URLs. Keep email confirmation enabled, configure SMTP and check the project's signup/reset rate limits.
- Create and confirm the owner account and use `backend/bootstrap-admin.sql` with the actual owner Auth UUID. Do not use signup metadata to grant admin access.
- Exercise signup, confirmation, login, refresh, password reset, new password and sign-out. Test an instructor account before and after administrator approval.
- Anonymous Supabase sign-in is not used by this application. Review rate limits before public launch. CAPTCHA is not integrated with the current signup form; do not enable it without adding its client widget/token flow first.

## Razorpay test deployment

Keep test mode until the complete hosted flow is assessed. Configure secrets through Supabase's dashboard or a private, ignored env file, never in chat or tracked source. Required function secrets are `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`; `RAZORPAY_ALLOW_LIVE` defaults to disabled. The functions also require the platform's server-side `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.

```sh
supabase secrets set --env-file <private-ignored-file>
supabase functions deploy create-order
supabase functions deploy razorpay-webhook --no-verify-jwt
```

`create-order` has JWT verification enabled and uses the caller's authenticated dispatcher for enrollment ownership. The webhook has JWT verification disabled and authenticates the raw request body with HMAC. Never disable signature validation.

Register this URL in the Razorpay test dashboard:

```text
https://gakrpgdwvtfvfbvtbofu.supabase.co/functions/v1/razorpay-webhook
```

Subscribe to `payment.captured`, `order.paid` and `payment.failed`, and configure automatic capture. Keep the webhook secret consistent with the function secret. Provider event identity comes from `x-razorpay-event-id`.

Server-created orders and provider capture state follow the [Razorpay integration guide](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps). Raw-body signature and duplicate delivery handling follow [Razorpay webhook validation](https://razorpay.com/docs/webhooks/validate-test).

## Hosted acceptance journey

1. Sign up and confirm a learner; sign up an instructor and approve them through the owner account. Add a real training vehicle.
2. Buy the 10-Day plan using Razorpay's currently documented test payment details. Check the real order is stored, the signed webhook succeeds, Payments shows Paid, and the plan has 10 credits. A browser callback alone must not activate it.
3. Try a failed payment, retry, dismiss checkout, and revisit Payments. Replay the same provider event and send the same payment in an `order.paid` event; neither may grant more credits. Check wrong amounts/currencies and unknown orders are rejected.
4. Reserve a lesson. Test a competing funded learner for the same instructor/vehicle/time in another session. Test cancellation, past dates and all-credit reservation limits.
5. After real lesson end, complete two lessons as the assigned instructor. Check the learner sees 10 → 9 → 8 credits and saved feedback. Retry completion; it must not consume another credit.
6. Mark theory as the learner and practical as the current instructor. Check another instructor cannot view/mark the learner's current progress or see their plan collections.
7. Test admin receipt review and full-refund recording on an unused plan with an actual test refund reference. A refunded plan must remain closed on a webhook replay.
8. Check all screens on phone and desktop, keyboard focus, dialog errors, loading states, network failure, empty fleet and no approved instructors. Check the deployed CSP permits checkout without allowing inline page scripts.
9. Open a screen URL such as `/#/payments`, sign in, refresh and use Back/Forward. Check learner links cannot open admin screens and pending instructors cannot open teaching screens. Follow a real confirmation/recovery link to check Auth fragments are consumed before screen routing.
10. Interrupt connectivity when a session needs refreshing, reconnect and retry. Sign out during a slow workspace refresh and ensure private content disappears immediately and never reappears. Repeat with a different account; no delayed response may overwrite the new account's screen.

## Render and publication

Render serves `dist/` using `render.yaml`. Set only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` for the static build. The build validates the public configuration; no service-role or provider secrets belong in Render's frontend environment.

The reviewed release branch may be published to GitHub under the current authorization. Keep production deployment on hold while mandatory release checks remain incomplete. After backend deployment and hosted acceptance, assess the actual Render deployment; a successful GitHub push alone is not release evidence. Include a real weekly-hours/blocked-date exercise, controlled email deliveries with cron/retry checks, and installation/offline tests on phone and desktop before lifting the release hold.
