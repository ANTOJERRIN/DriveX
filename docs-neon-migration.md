# DriveX migration to Neon (staging)

The separate Node service hosts the current frontend and talks to Neon Auth and PostgreSQL. The original static deployment remains on its existing provider. This branch does not migrate accounts or existing records.

## Provision

1. In the Neon Console, create a dedicated DriveX staging project and enable Neon Auth (email/password, require verified emails). Add the staging Render origin to Neon Auth's trusted domains; configure and test email delivery for signup and password reset.
2. Use the database owner connection as the private environment variable `MIGRATION_DATABASE_URL` and run `npm ci` then `node backend/neon/migrate.mjs`. This is for a fresh database. It records each migration under a transaction lock and skips the Supabase-specific Vault/cron scheduler. It does not edit the historical SQL files.
3. Create a dedicated Postgres LOGIN role named `drivex_app` without owner/admin privileges. As migration owner, apply `backend/neon/runtime-grants.sql`. Use the restricted login's TLS connection string as `DATABASE_URL`, never the owner string.
4. Deploy a separate Render web service from this branch using `render.neon.yaml` or the equivalent commands. Set `APP_ORIGIN` to the HTTPS origin Render assigned, `NEON_AUTH_URL` to the branch's Neon Auth base URL, and `DATABASE_URL` in Render secrets. Do not commit these values. `/healthz` checks the database and dispatcher, not email delivery.
5. Confirm a learner account by email and sign in. The first authorized snapshot registers its verified Neon identity. Promote only the intended owner explicitly using `backend/bootstrap-admin.sql` with the corresponding local UUID in `auth.users`. Instructors sign up as learners and an administrator assigns their access by email after their first sign-in.

## Before switching production

- Verify the actual Neon Auth session cookie round trip on Render, confirmation, sign-out, and the password-reset email callback. Check that two distinct learners see only their own records.
- Add a real car and instructor in staging; enroll a learner, record a receipt, book and complete a lesson, and check credit use and overlapping-slot rejection.
- Online checkout and email notifications are not migrated. Manual receipts are supported by the existing SQL. Plan any payment and notification worker cutover separately.
- If the inactive Supabase project can be recovered, export and reconcile users, roles, enrollments, bookings and receipts before any production cutover. Do not join existing accounts to new identities by unverified email; design a reviewed identity mapping first. Neon credentials do not restore old user passwords.
- Keep the old deployment and database intact until staging and the data plan are approved.

The server checks the Neon session on each protected call, ignores browser identity claims, maps the verified provider subject to a UUID, and sets that identity only for the current database transaction. Booking, pricing and role rules stay in the existing dispatcher. The PostgreSQL endpoint is never used directly from the browser.
