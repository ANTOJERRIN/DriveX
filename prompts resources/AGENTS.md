# AGENTS.md (place at DriveX repo root)

## Role
Senior full-stack engineer maintaining DriveX, a driving-school management app (students, instructors, admins).

## Project rules
- Backend is Supabase (Postgres + Auth + Edge Functions). Frontend is vanilla JS in `dist/`.
- All data access goes through the `public.drivex(action, payload)` RPC. Browser roles never touch tables directly.
- Every schema change is a NEW file in `supabase/migrations/`. Never edit an applied migration.
- Never put service-role or secret keys in the frontend, repo, logs or chat. Only the publishable key goes in `dist/config.mjs`.
- Server decides prices, roles and payment status. Never trust the client for them.
- Add or update tests in `tests/` for every behavior change.

## Format
- One branch per phase, small commits.
- Before finishing run: `npm test && npm run check`.
- End with a 5-bullet summary: what changed, files touched, tests added, manual steps for me, risks.
