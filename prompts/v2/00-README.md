# DriveX prompt pack v2 (use ONLY this folder; older packs are obsolete)

## Where things stand (from your Antigravity screenshot)
```
 CLAIMED DONE by the CLI (UNVERIFIED)            PROBLEMS I SEE
 ───────────────────────────────────            ──────────────
 config.mjs wired from .env                 ─►  static sites can't read .env; may leak a secret
 "live DB + drivex RPC responsive"          ─►  contradicts your "booking not available"
 config.toml + 0001_init.sql, db:push       ─►  was it applied? history may mismatch
 vercel.json strict CSP + ci.yml            ─►  you deploy on RENDER; CSP may block Razorpay
 0002_razorpay.sql + 2 edge functions       ─►  built on the OLD per-lesson Rs 800 model
 checkout button in app.mjs                 ─►  conflicts with the new plan model
 "CLI hook fixed permanently"               ─►  unverifiable claim, ignore it
```

## Run order
```
B0 audit (CLI) ─► B1 SQL (ChatGPT Go) ─► apply migration ─► B2 Render ─► B3 wire API
      │                                                                     │
  read-only                                                        B4 Razorpay (plans)
                                                                           │
                              B5 auth/landing ─► B6 learner ─► B7 instructor ─► B8 final check
```

| Step | File | Tool |
|------|------|------|
| 0 | B0-audit-state.md | Antigravity CLI (read-only) |
| 1 | B1-supabase-plans-sql.md | ChatGPT Go chat (attach files listed inside) |
| 2 | apply the migration (see B1 RUN STEPS) | You |
| 3 | B2-render-config.md | Antigravity CLI |
| 4 | B3-wire-api.md | Antigravity CLI |
| 5 | B4-razorpay-plans.md | Antigravity CLI |
| 6 | B5-auth-landing.md | Antigravity CLI |
| 7 | B6-learner-portal.md | Antigravity CLI |
| 8 | B7-instructor-portal.md | Antigravity CLI |
| 9 | B8-security-go-live.md | Antigravity CLI (report only) |

Later (not needed to launch): email reminders, instructor working hours, PWA polish.

## How to run a CLI prompt
1. Copy `AGENTS.md` from this folder into the repo root (replace the old one).
2. Put this folder in the repo as `prompts/v2/`.
3. Tell the CLI exactly: `Read prompts/v2/B0-audit-state.md and execute it exactly. Stop at each CHECKPOINT.`
4. Set keys in YOUR shell only, never in a prompt:
   `$env:SUPABASE_URL="..."; $env:SUPABASE_PUBLISHABLE_KEY="..."` (PowerShell)
5. If the CLI says "done/verified" with no EVIDENCE block, reply: `Show EVIDENCE or mark NOT VERIFIED.`

## Hard rules
- Never paste service-role/secret keys, Razorpay key secret or webhook secret into ChatGPT, the CLI or chat.
- One git branch per step. `npm test` must pass before merge.
- Razorpay TEST mode only until B8 says GO.
