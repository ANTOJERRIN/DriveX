# B3: Wire frontend and tests to the plan-based API (Antigravity CLI)

## Role
Senior JS engineer who treats API_CONTRACT.md as the source of truth.

## Task
Prerequisite: `supabase/migrations/0003_plans.sql`, `supabase/verify.sql` and `API_CONTRACT.md` (from B1) are in the repo, and I have applied the migration and run verify.sql with all rows true. If I have not, ask me.

1. Update `dist/api.mjs`: one typed wrapper per action in the contract; keep auth, refresh and the existing error handling shape.
2. Replace generic messages ("booking is not available") with specific ones mapped from contract error codes: no active plan, no credits left, slot taken, instructor pending approval, not signed in, server unreachable, schema not installed (`PGRST202`).
3. Update `tests/` to load all migrations 0001..0003 into PGlite. Cover: credits 10 -> 9 -> 8 on completion; cannot overspend; learner cannot mark practical done; learner cannot call `confirm_payment_server` or `admin_mark_paid`; pending instructor cannot be chosen; double-booking blocked; price cannot be spoofed from the client.
4. Do NOT edit SQL or the contract. If the contract, SQL and frontend disagree, STOP and list each: contract says / SQL does / suggested fix.

CHECKPOINT: report mismatches (or "none") before changing files.

## Format
Mismatch list, changed files, EVIDENCE of `npm test && npm run check`, NOT VERIFIED items.
