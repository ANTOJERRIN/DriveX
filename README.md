# DriveX

A responsive driving-school management review build, based on `driving_school_simple.md`.

## Run and review

Requires Node 20+ and Python 3. No dependency installation or build step.

```sh
npm start
# Open http://localhost:3000
npm test
npm run check
```

The shipped app is an explicitly labelled **review demo**, not a live booking service. Sample data is stored in this browser tab's sessionStorage and resets on a new day. The role selector is a preview control, not authentication. Do not enter real personal or payment information.

### Review flow

1. Student: book a future lesson, pick instructor/car/time, reserve, simulate payment.
2. My lessons: inspect, retry a failed payment, or cancel. Cancellation releases the time and marks demo payments refunded.
3. Instructor: open My schedule; select the relevant instructor. Confirmed bookings appear here.
4. For immediate assessment testing, choose **Add finished demo lesson** in the instructor schedule. Assess yesterday's lesson. Future lessons cannot be assessed early.
5. Student: view My progress and the new feedback.
6. Admin: add instructors or vehicles and inspect bookings/payments. New resources become available in student booking selectors.
7. Reset demo restores the sample data after confirmation.

## Architecture

- `dist/index.html`: semantic app entry and metadata.
- `dist/styles.css`: responsive visual system.
- `dist/app.mjs`: dashboard rendering, forms, accessible native modal dialogs, role previews.
- `dist/model.mjs`: booking lifecycle, expiry, conflict checks, idempotent mock payment and assessment rules.
- `tests/booking.test.mjs`: domain integration tests.
- `database/schema-draft.sql`: unapplied Supabase schema proposal with RLS, protected writes, integer money, overlap exclusions and assessment constraints.

Demo assumptions: one school, one sample student, fixed one-hour slots, ₹800 per lesson, Asia/Kolkata time. Demo conflict checks are tab-local and are **not** a substitute for database concurrency controls.

## Backend connection work still required

No DriveX Supabase project was identified. No existing Supabase database was modified. The SQL is a design draft, not a tested migration or a connected backend.

1. Select a dedicated Supabase project; apply and test the schema in a disposable environment first.
2. Implement Supabase Auth, student profile provisioning, and trusted instructor/admin invitations. Replace the preview role selector with authenticated roles; never trust user-editable metadata for authorization.
3. Add a safe instructor directory endpoint exposing only necessary public instructor fields. Profile reads intentionally do not expose all phone numbers.
4. Implement transactional reservation, validating roles, working hours, resource activity, price and future times. Expire stale pending rows before reservation and with a scheduled cleanup. The database exclusion constraints reject concurrent overlapping reservations.
5. Add server-side payment-order creation, authenticated checkout verification and signature-verified idempotent webhooks. Verify provider amount, currency and captured status before marking paid. Keep secrets server-side. Reconcile late payments; do not confirm an already-released slot.
6. Implement transactional cancellation/refund handling and instructor assessment completion. Validate assigned instructor, end time and booking state in the server. Browser roles have no direct money/booking write grants.
7. Wire the frontend to these endpoints; add RLS integration, concurrency and webhook replay tests. Make live cancellation/refund policy an explicit product decision.

The demo's automatic simulated refund is not a real refund policy. No live Razorpay integration is shipped.

## Validation

`npm test` covers booking/payment/assessment lifecycle, instructor/vehicle/student conflicts, cancellation and slot reuse, payment failure/retry/idempotency, expiry/late payment rejection, feedback authorization/timing/range, and invalid booking input. `npm run check` validates JavaScript syntax.

Browser WebMCP tools are feature-detected (`read_demo_bookings`, `open_booking_form`) and use the same visible state. Full WebMCP browser validation was unavailable in this build environment.
