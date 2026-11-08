# Scheduling, notifications and installable app

This continuation implements the three remaining abilities in `prompts resources/04-notifications.md`, `05-availability.md` and `06-ui-pwa.md`. Changes are local and are not a hosted release. The user has authorized publishing the release branch; hosted deployment remains on hold.

## Instructor availability

- Approved instructors edit their own weekly hours and blocked dates. Administrators can select any instructor to manage their schedule.
- Existing instructors and new instructor applications receive the prior default hours: 08:00–12:00 and 14:00–18:00, seven days a week. The school can replace that week, leave days empty or use half-hour boundaries such as 08:30–12:30.
- Lessons remain one hour. Starts are generated in one-hour steps from each window's beginning, in Asia/Kolkata. Overlapping windows are rejected.
- Availability and reservation use the same schedule data. Learners cannot book blocked dates or times outside their enrolled instructor's hours. The browser-supplied instructor is still ignored.
- The profile lock shared by reservation and schedule edits prevents a schedule change racing past a reservation. An edit or blocked date that would invalidate a future reserved lesson is rejected; its prior schedule remains intact.
- Existing learner, instructor and vehicle exclusion constraints remain unchanged. No existing lessons are silently moved or cancelled by a schedule edit.

## Transactional email

| Notice | Recipient | Queue trigger |
| --- | --- | --- |
| Lesson booked | Learner and assigned instructor | New booking becomes confirmed |
| Lesson cancelled/requested | Learner and assigned instructor | Booking becomes cancelled or cancellation_requested |
| Refund recorded | Learner | Payment becomes refunded |
| Lesson reminder | Learner and assigned instructor | Scheduled for 24 hours before a future lesson; cron also catches up established bookings inside that window |

Queue entries are inserted in the same transaction as the business change. No historical booking confirmations are backfilled. Existing future bookings can receive reminders. A recently created lesson inside the 24-hour window gets its immediate confirmation; the catch-up scan waits at least an hour before adding a reminder and does not remind within the final hour before start.

The private queue has RLS, no direct browser access, unique event keys and service-only claim/finish RPCs. Claims use five-minute leases and `FOR UPDATE SKIP LOCKED`. At most ten messages are claimed per worker invocation. Automatic attempts are capped at five with exponential backoff. An abandoned fifth lease becomes failed rather than remaining stuck forever. A school admin can explicitly retry a failed notice, except when its recipient address changed.

The worker sends plain-text messages through Resend using one stable provider idempotency key per queue item. Delivery content remains stable while retrying; a changed or unavailable recipient is not silently substituted. Cancellation suppresses queued reminders and unsent booking notices. Claims recheck lesson state before sending. An email already accepted by the provider cannot be recalled; a cancellation racing with an in-flight email can still be followed by a cancellation notice.

`sent` means accepted by the email provider, not proven inbox delivery. Error categories are stored instead of raw provider errors. The worker logs no recipient data, message bodies or secrets. Stored delivery details are cleared after provider acceptance. Resend's idempotency keys expire after 24 hours, so ambiguous failures retried after a long outage/manual retry need operator reconciliation; exactly-once email delivery is not claimed. See [Resend's send-email reference](https://resend.com/docs/api-reference/emails/send-email).

## Server setup

1. Restore the dedicated Supabase project and follow the migration preflight/history procedure in `RELEASE.md`. Apply the three new files in order: instructor availability, notification queue and scheduler. Previously committed migrations are unchanged.
2. Configure a verified sender/domain in Resend. Set only server-side Supabase Function secrets: `RESEND_API_KEY`, `RESEND_FROM`, and a strong random `NOTIFICATION_WORKER_TOKEN` of at least 32 characters. Set optional `DRIVEX_APP_URL` to the HTTPS app URL for email links. Do not put these values in Render's public build, tracked files or chat.
3. Deploy the worker:

   ```sh
   supabase functions deploy notification-worker --no-verify-jwt
   ```

   Gateway JWT verification is disabled for this machine endpoint. The handler checks its dedicated bearer token before touching the queue. Browser/user JWTs are not accepted as scheduler credentials. The worker uses the platform-provided `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` only on the server.

4. In Supabase Vault, create these named entries using the dashboard, keeping actual values outside source/chat:

   | Vault name | Value |
   | --- | --- |
   | `drivex_notification_url` | `https://gakrpgdwvtfvfbvtbofu.supabase.co/functions/v1/notification-worker` |
   | `drivex_notification_token` | The same dedicated worker token stored in Function secrets |

5. The scheduler migration enables `pg_cron` and `pg_net` when available, and registers `drivex-notifications` every minute. Its command contains only a private function call. Endpoint/token values are read from Vault at execution, never embedded in cron SQL. Calls are skipped while configuration is absent or invalid. The intended [Supabase scheduling pattern](https://supabase.com/docs/guides/functions/schedule-functions) combines cron, pg_net and Vault.
6. Run `supabase/verify.sql`. In the admin portal, open **School emails**. Check configuration, queued/due/sent/failed counts, and capped retry status. Test actual provider acceptance and receipt at controlled school test addresses before enabling public use.

PGlite has no live `pg_cron`, `pg_net` or Vault extensions. Tests exercise the queue and scheduler function logic with isolated SQL stand-ins, not real scheduled HTTP requests. Hosted scheduling, Deno execution and actual email delivery remain NOT VERIFIED.

## PWA and offline behavior

- A manifest, PNG icons (180/192/512), SVG brand icon and service worker support installation on capable browsers. The app presents an install button only after the browser supplies an install prompt; iOS users may use the browser's Add to Home Screen option.
- Navigation is network-only with a static public offline fallback. No account page, session, Supabase config, application module, API response, booking or payment is cached by the service worker. API calls are never replayed after reconnecting.
- Only the fixed offline page, styles and icons are cached. Requests with authorization headers, query strings, other origins or non-GET methods are excluded from the static cache. Cache cleanup removes only DriveX's own shell versions.
- An offline banner warns that an already open workspace may be out of date. A cold offline launch shows a public reconnect page, not a stored dashboard. If the public cache was evicted, a plain reconnect message remains available.
- Role-specific views now live in `dist/portals/learner.mjs`, `instructor.mjs` and `admin.mjs`; auth, routing and mutations remain in the application controller. The existing Auth/API client is unchanged in this continuation.

Install/offline behavior follows the [service-worker lifecycle and fetch model](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers). Actual browser/mobile installation and visual checks remain NOT VERIFIED; the tests exercise the worker's handlers and rendered view functions.

## Manual acceptance

1. Change an instructor's week, add a half-hour window and close one weekday. Check the learner's live slot list. Block/unblock a date. Try removing a window containing an existing lesson; the edit must fail without losing the old schedule.
2. In separate hosted sessions, attempt a reservation while changing the same instructor's hours. Assess the real database locking and overlap guards.
3. Book and cancel a test lesson, and record an eligible actual test refund. Check one notice per intended recipient and the expected queue states. Advance to a reminder due time in a dedicated non-production environment.
4. Test a temporarily unavailable email provider and confirm retry/backoff, failure after five attempts, and the explicit admin retry. Test expired leases and no duplicate email from immediate repeated delivery.
5. On phone and desktop, install the app if offered. Go offline and reload. Inspect browser cache storage: only the public shell/styles/icons should be present. Reconnect and ensure no booking or payment action is automatically submitted.
6. Check form labels, keyboard focus, narrow screens, blocked-date notes and email error states. Hosted email, cron and browser acceptance are release gates, not inferred from local tests.
