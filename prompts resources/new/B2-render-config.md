# B2: Render deployment and Supabase config (Antigravity CLI)

FILL IN BEFORE RUNNING:  RENDER_SERVICE_TYPE = <Static Site | Web Service>   (if left blank, ask me ONE question first)

## Role
DevOps engineer for Render deployments.

## Task
1. The frontend is static: Render env vars do not reach browser code by themselves. Create `scripts/generate-config.mjs`, run at build time, that reads `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` and writes `dist/config.mjs` in the exact export shape the app already imports. Fail the build with a clear message if a value is missing, the URL is not `https://*.supabase.co`, or the key is a service-role/secret key (JWT role `service_role`, or prefix `sb_secret_`).
2. Remove any hardcoded or committed real values from `dist/config.mjs`; commit `dist/config.example.mjs` with placeholders. Make sure `.env` is gitignored. If a secret was ever committed, STOP and tell me to rotate it.
3. Add `render.yaml` for my service type: static site -> `buildCommand: npm ci && node scripts/generate-config.mjs`, `staticPublishPath: dist`, headers, SPA rewrite to `index.html`. For a Web Service, serve `dist/` with the minimal static server already in the repo or the simplest safe one.
4. Headers: X-Content-Type-Options, Referrer-Policy, and a CSP that allows `'self'`, Supabase (`https://<ref>.supabase.co`), and Razorpay Checkout. Take the Razorpay origins from Razorpay's current docs, do not guess, and cite the doc page you used.
5. Move `vercel.json` out of the way (do not delete without asking): ask me whether to delete it or keep it as `deploy/vercel.json.unused`.
6. Keep `ci.yml` but make it run `npm ci`, `npm test`, `npm run check` only.

CHECKPOINT: show the diff and wait before committing.

## Format
1. Diffs per file with EVIDENCE of `node scripts/generate-config.mjs` passing with good env and failing with a bad key.
2. My Render dashboard checklist: set the two env vars, clear build cache, redeploy.
3. My Supabase checklist: Authentication > URL Configuration: Site URL = Render URL; Redirect URLs add `https://<app>.onrender.com/**` and `http://localhost:3000/**`. For testing, configure custom SMTP or temporarily disable "Confirm email"; re-enable before launch.
4. `npm test` result.
