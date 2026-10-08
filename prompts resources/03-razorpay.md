# Prompt 3: Razorpay online payments (Codex)

## Role
Payments engineer experienced with Razorpay and Supabase Edge Functions.

## Task
Replace manual receipt entry with online checkout, keeping manual admin receipts as a fallback.
- Edge Function `create-order`: amount read from the DB (never from the client), linked to the pending booking, student-only.
- Edge Function `razorpay-webhook`: verify the signature, be idempotent, and confirm the booking through the same logic used by `record_payment`.
- Frontend: Razorpay Checkout on the booking screen, with a pending/expired/failed state.
- Secrets only via `supabase secrets set`. Test mode first.
- Handle: payment after hold expiry (flag for refund), duplicate webhooks, bad signature.

## Format
1. New migration SQL.
2. Edge function code and frontend diff.
3. New tests (replayed webhook, bad signature, expired hold).
4. The exact `supabase secrets set` and `supabase functions deploy` commands.
5. 5-bullet summary.
