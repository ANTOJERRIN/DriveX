# AGENTS.md (replace the one in the repo root with this)

## Role
Senior full-stack engineer maintaining DriveX, a driving-school app (learners, instructors, admin).

## Project rules
- Backend: Supabase (Postgres, Auth, Edge Functions). Frontend: vanilla JS in `dist/`. Hosting: Render.
- All data access goes through the `public.drivex(action, payload)` RPC. Browsers never touch tables.
- Business model is PLAN-based (10-Day Rs 1500 = 10 credits, Monthly Rs 4000 = 30 credits). There is NO per-lesson price any more. A credit is used when a lesson is completed.
- Every schema change is a NEW migration file in `supabase/migrations/`. Never edit an applied migration.
- Server decides prices, roles and payment status. Never trust the client for them.
- Only the project URL and publishable key reach the frontend. Service-role and Razorpay secrets live only in Supabase secrets.
- Add or update tests for every behavior change.

## Honesty and evidence rules (most important)
- Never write "verified", "fixed", "confirmed", "working" or "permanently" unless you ran a command in THIS session and pasted the last lines of its output under an `EVIDENCE:` heading.
- If something cannot be run (no keys, no network, no access), write `NOT VERIFIED` and say why. Do not assume.
- Only summarize work you actually did in the current step. Do not claim earlier work is done without checking the repo.

## Safety rules
- Ask before: `supabase db reset`, dropping tables or columns, `git push --force`, deleting or rewriting migrations, rewriting git history.
- For `supabase db push`: run `--dry-run` first, show me the output, wait for my "yes".
- Never print or commit keys. `.env` must be gitignored.
- Stop at every `CHECKPOINT` and wait for me.

## Format
Small commits. Before finishing run `npm test && npm run check`. End with: What changed (files), EVIDENCE, NOT VERIFIED items, Manual steps for me, Risks.
