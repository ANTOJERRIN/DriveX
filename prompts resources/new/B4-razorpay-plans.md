# B4: Rework Razorpay to plan enrollments (Antigravity CLI)

## Role
Payments engineer experienced with Razorpay and Supabase Edge Functions.

## Task
The existing `create-order`, `razorpay-webhook` and checkout button were built for per-lesson bookings. Rework them for plan enrollments using API_CONTRACT.md. TEST MODE ONLY.

- `create-order` (JWT verification ON): get the caller from the JWT; load the enrollment; it must belong to the caller and be `pending_payment`; amount = plan price from the DB x 100 paise (never from the request); create the Razorpay order with the key secret from Supabase secrets; store the order id; return only `order_id`, `amount`, `currency` and the PUBLIC key id.
- `razorpay-webhook` (JWT verification OFF, deploy with `--no-verify-jwt`): verify `X-Razorpay-Signature` HMAC-SHA256 over the RAW body with the webhook secret; reject on mismatch; dedupe on event id via `webhook_events`; handle `payment.captured`/`order.paid` and `payment.failed`; compare order id, amount and currency with the DB; call `confirm_payment_server` with the service role; return 200 quickly for already-processed events; ignore unknown events safely.
- Frontend: open Checkout, then poll `my_payments`/`dashboard` until the server shows Paid. Never trust the browser success callback alone. UI text: "Paid" / "Failed" / "Pending", no "record payment" or "refund" buttons.
- Refuse `rzp_live_` keys unless `RAZORPAY_ALLOW_LIVE=true`.
- No secrets in code, logs or repo.

CHECKPOINT: show the plan and the diff before deploying anything.

## Format
1. Diffs per file.
2. Tests: valid signature, bad signature, replayed event, amount mismatch, payment after enrollment already paid, unknown order.
3. EVIDENCE of `npm test`.
4. My manual steps with exact commands: `supabase secrets set RAZORPAY_KEY_ID=... RAZORPAY_KEY_SECRET=... RAZORPAY_WEBHOOK_SECRET=...`, `supabase functions deploy create-order`, `supabase functions deploy razorpay-webhook --no-verify-jwt`, and the dashboard setting: webhook URL `https://<ref>.supabase.co/functions/v1/razorpay-webhook` with events payment.captured, order.paid, payment.failed.
5. A test-card payment walkthrough using Razorpay test mode.
