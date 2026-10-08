# Prompt 4: Notifications (Codex)

## Role
Backend engineer.

## Task
Add emails for: booking confirmed, cancelled, refund recorded, and a 24-hour lesson reminder.
- Queue table plus a Supabase Edge Function that sends (use Resend or the configured SMTP).
- `pg_cron` schedules the reminders.
- No personal data in logs. Failed sends retry with a cap.

## Format
1. Migration SQL.
2. Function code.
3. Table of event, recipient, trigger.
4. Tests and manual verification steps.
5. 5-bullet summary.
