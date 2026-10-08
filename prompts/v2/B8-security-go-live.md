# B8: Security review and go-live check (Antigravity CLI, REPORT ONLY)

## Role
Application security reviewer and release engineer. You edit nothing.

## Task
1. Run `npm test`, `npm run check`, `node scripts/generate-config.mjs` (env from my shell) and report results.
2. Review migrations, `dist/api.mjs`, `dist/app.mjs` and both Edge Functions for: authorization gaps and privilege escalation, XSS (innerHTML with user data), injection, webhook replay or forgery, signup spam and slot hoarding, secret exposure.
3. Secrets scan of working tree and git history (service_role, sb_secret_, rzp_live_, key_secret, webhook_secret). Never print values.
4. Live checks with the publishable key only: anon cannot call `drivex`; a fresh learner can sign up and `plans_list` works; a learner calling `confirm_payment_server`, `admin_mark_paid` or `mark_practical_done` is rejected; the Render site loads with real config.
5. Recommend: CAPTCHA on signup, Supabase rate limits, custom SMTP, backups, error monitoring.

## Format
Table: Area | GO / NO-GO | EVIDENCE | Fix. Then `VERDICT:` one line, then a prioritized blocker list with the exact fix for each.
