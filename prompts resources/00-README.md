# DriveX prompt pack (Role / Task / Format)

| # | File | Tool | Branch |
|---|------|------|--------|
| 0 | Manual Supabase setup (see below) | You | none |
| 1 | 01-migrations.md | Codex | feat/migrations |
| 2 | 02-deploy-ci.md | Codex | feat/deploy |
| 3 | 03-razorpay.md | Codex | feat/payments |
| 4 | 04-notifications.md | Codex | feat/notify |
| 5 | 05-availability.md | Codex | feat/availability |
| 6 | 06-ui-pwa.md | Antigravity CLI | feat/ui-pwa |
| 7 | 07-security-review.md | Antigravity CLI | review only |

## Workflow per phase
1. `git checkout -b <branch>`
2. Paste the prompt into the tool, from the repo root (AGENTS.md is read automatically).
3. Run `npm test && npm run check` yourself.
4. Open a PR, have the OTHER tool review it, then merge.

## Phase 0: manual Supabase setup (do this yourself)
1. Create Supabase project "DriveX" (check cost first).
2. SQL editor: run `backend/schema.sql`.
3. Auth: set Site URL to your deployed URL, add `http://localhost:3000`, keep email confirmation on, configure SMTP.
4. Put project URL + publishable key in `dist/config.mjs`.
5. Sign up, confirm email, sign in once.
6. Copy your UUID from Auth > Users into `backend/bootstrap-admin.sql` and run it.
