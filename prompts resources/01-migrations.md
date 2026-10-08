# Prompt 1: Migrations (Codex)

## Role
Supabase / Postgres engineer.

## Task
Read `backend/schema.sql` and `tests/database.test.mjs`. Set up the Supabase CLI structure:
- `supabase/config.toml`
- `supabase/migrations/0001_init.sql` (identical behavior to `schema.sql`)
- npm scripts for `db:push` and `db:diff`
Do not change behavior. Keep the tests passing (point them at the migration file). Update the README setup steps to use the CLI.

## Format
1. File tree of changes.
2. Exact commands I run to `supabase login`, `supabase link`, and `supabase db push`.
3. 5-bullet summary per AGENTS.md.
