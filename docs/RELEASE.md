# DriveX release procedure

The current release target is **Neon Auth/PostgreSQL plus a Node web service on
Render**. The previous Supabase restoration instructions are superseded by the
owner's Neon migration request.

Follow [the Neon migration guide](../docs-neon-migration.md) for all current
setup commands, restricted login grants, environment variables, Razorpay,
notification scheduling, existing-data handling and hosted acceptance.

Release order:

1. Identify the dedicated staging Neon project/database/branch and configure
   verified-email Auth with the actual HTTPS application origin.
2. Inspect the database and migration history. Run `npm run db:plan`, show its
   pending filenames and obtain the owner's yes before `npm run db:migrate`.
   Do not run fresh bootstrap against an existing schema without a reviewed
   ledger/data plan.
3. Provision separate restricted app and worker logins; run the owner SQL
   verification checks. Never give the web service the migration owner's URL.
4. Build and deploy a new Render **Node** service. A static site cannot execute
   the Neon gateway. Keep the old deployment/data intact until acceptance.
5. Complete real Auth cookie/confirmation/reset, test-mode Razorpay
   purchase/replay, booking/completion/concurrency, email/scheduler and
   desktop/mobile/offline acceptance.
6. Reconcile/import historical records with a reviewed identity mapping before
   switching production traffic. This source change does not import records.

NOT VERIFIED: hosted schema application, data import, Auth, payments, email,
multi-connection locking or browser/mobile appearance. The attempted migration
plan currently stops because `MIGRATION_DATABASE_URL` is not configured.

The local full-suite output and continuation evidence are recorded separately;
passing fixture tests is not a live deployment.
