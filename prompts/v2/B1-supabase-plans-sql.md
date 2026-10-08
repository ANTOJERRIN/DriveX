# B1: Plan-based Supabase migration + API contract (paste into ChatGPT Go chat)

Attach before sending: `supabase/migrations/0001_init.sql`, `supabase/migrations/0002_razorpay.sql`, `tests/database.test.mjs`, and the B0 report if you have it.

## Role
Staff Postgres/Supabase engineer who ships secure, idempotent, incremental migrations that run first time on a real Supabase project.

## Task
DriveX is a driving-school app: learners buy a plan, pick an instructor, book lessons, watch theory videos; instructors teach practical sessions and get paid through plans. The attached 0001 and 0002 may or may not be applied on the live project. Write ONE new migration `0003_plans.sql` that builds on 0001 + 0002 without editing them, is fully idempotent, and never drops user data. If 0001/0002 are not applied, say so in CONFLICTS and explain the minimum extra step.

### Product rules
- Roles: learner, instructor, admin. Signup metadata may only REQUEST learner or instructor. Nobody becomes admin via signup. Instructors start `approval_status = 'pending'`; only `approved` instructors are listed or can receive enrollments. Admin approves/rejects.
- `plans` (seeded, editable): "10-Day Plan" price_inr 1500, lesson_credits 10; "Monthly Plan" price_inr 4000, lesson_credits 30. Integer rupees.
- `enrollments`: learner, plan, chosen instructor, credits_total, credits_used, status (`pending_payment`, `active`, `finished`).
- `payments`: enrollment, amount_inr copied from the plan SERVER-SIDE, status (`created`, `paid`, `failed`, `refunded`), provider, provider_order_id, provider_payment_id (unique), paid_at. Reuse or migrate whatever 0002 created for Razorpay orders instead of duplicating it.
- `webhook_events`: provider event id (unique) for idempotency.
- Credits: consumed when a lesson is COMPLETED, not booked. credits_used can never exceed credits_total. Remaining = total - used.
- Bookings: 1-hour slots, must belong to an active enrollment with credits left, with the chosen instructor. Keep the existing exclusion constraints (instructor, vehicle, learner never double-booked) and the 30-minute hold. Retire per-lesson pricing from the booking flow without breaking old rows.
- `course_lessons` (kind theory|practical, title, youtube_url nullable, sort_order): seed 8 theory lessons (traffic signs, road markings, right of way, speed limits, parking, night driving, highway rules, emergency handling) with youtube_url NULL, and 5 practical lessons.
- `lesson_progress`: theory marked by the learner; practical ONLY by the assigned instructor.
- Timezone Asia/Kolkata.

### Technical rules
- Keep the single-RPC pattern `public.drivex(action text, payload jsonb default '{}')`: SECURITY DEFINER, `set search_path = public`, `auth.uid()` checked, role checks inside.
- RLS on every table, no direct policies. `revoke all` from anon and authenticated on all tables/sequences. EXECUTE on `drivex` only for `authenticated`.
- Profile-creation trigger on `auth.users` that whitelists the requested role (default learner).
- Payment confirmation: create `public.confirm_payment_server(provider_order_id text, provider_payment_id text, amount_paise int, event_id text)` callable ONLY by `service_role` (revoke from public, anon, authenticated). It must be idempotent, check the amount equals the plan price x 100, activate the enrollment, and reject unknown orders. Also add admin-only action `admin_mark_paid` for testing.
- Idempotent: `create table if not exists`, `create or replace function`, `drop policy/trigger if exists`, seeds with `on conflict do nothing`.
- Plain Postgres 15 and PGlite compatible; only `btree_gist` allowed as extension; no pg_cron, no pg_net, no secrets.
- End with `notify pgrst, 'reload schema';`
- Actions needed (plus all existing ones): `me`, `plans_list`, `instructors_list`, `enroll`, `my_payments`, `dashboard` (credits_remaining, confirmed_count, completed_count, next_confirmed_lesson with instructor name, progress_percent, recent_lessons), `availability`, `reserve`, `cancel_booking`, `my_lessons`, `mark_theory_done`, `mark_practical_done`, `instructor_overview`, `instructor_learners`, `instructor_schedule`, `complete_booking`, `instructor_earnings`, `admin_overview`, `admin_instructors_pending`, `admin_set_instructor_status`, `admin_mark_paid`.

## Format
Output EXACTLY these code blocks, nothing between them:
1. `supabase/migrations/0003_plans.sql`
2. `supabase/verify.sql`: SELECTs returning `(check_name, ok boolean)`: tables, RLS on, drivex exists, anon cannot execute drivex, confirm_payment_server not executable by authenticated, plans seeded with correct prices, exclusion constraints exist, course_lessons seeded.
3. `API_CONTRACT.md`: per action: allowed roles | payload JSON | success JSON | error codes and messages.
Then `CONFLICTS` (anything in 0001/0002 that clashes, with the fix), `RUN STEPS` (max 6 bullets: use ONE method only. Preferred: save the file in the repo and `supabase db push --dry-run` then `supabase db push`; if earlier migrations were applied through the SQL Editor, include the `supabase migration repair` commands), and `ASSUMPTIONS` (max 5 bullets). No other prose.
