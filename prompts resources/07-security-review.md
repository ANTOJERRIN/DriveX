# Prompt 7: Security review (Antigravity CLI, report only)

## Role
Application security reviewer.

## Task
Review `schema.sql`/migrations, `dist/api.mjs`, `dist/app.mjs` and all Edge Functions for:
- Authorization gaps and privilege escalation.
- Injection and XSS.
- Abuse risks: signup spam, slot hoarding, webhook replay.
- Secret exposure.
Recommend CAPTCHA, Supabase rate limits, backups and error monitoring. **Do not edit any files.**

## Format
Table: Finding | Severity | File:line | Recommended fix. Then a prioritized top-5 list.
