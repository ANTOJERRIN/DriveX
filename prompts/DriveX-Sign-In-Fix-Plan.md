# DriveX sign-in failure

## Problem

The [production sign-in page](https://drivex-2spi.onrender.com/) loads, but submitting the learner form shows “DriveX could not reach the server.” The confirmed deployment fault is that **Render is serving the legacy Supabase frontend configuration while the Neon authentication server is present in the deployed commit but never started.**

| Checked | Finding |
| --- | --- |
| [Render production settings](https://dashboard.render.com/web/srv-db3lekm0tbcc73813860/settings) | Build Command is `npm install; npm run build`. Start Command is `npm run start`. The HTTP Health Check Path is blank. |
| [Live deploy](https://dashboard.render.com/web/srv-db3lekm0tbcc73813860/deploys/dep-dbquk8mc6qcc7382qgag) and [package.json at be4b356](https://github.com/ANTOJERRIN/DriveX/blob/be4b356766419cb0995923b7ba119dda209112d6/package.json#L6-L14) | `npm run start` launches Python’s static server. `npm run build` generates a Supabase config file. A successful deploy can therefore serve the sign-in page without serving the Neon API. |
| [Browser authentication code](https://github.com/ANTOJERRIN/DriveX/blob/be4b356766419cb0995923b7ba119dda209112d6/dist/api.mjs) | The browser selects Neon only when `config.mjs` sets `provider: "neon"`. The legacy path sends password sign-in to Supabase and displays the exact screenshot message when the browser’s request fails before JavaScript can read an HTTP response. |
| [Neon server entry point](https://github.com/ANTOJERRIN/DriveX/blob/be4b356766419cb0995923b7ba119dda209112d6/backend/neon/server.mjs) | The Node server serves the Neon config, exposes same-origin `/api/auth/*` endpoints and checks PostgreSQL readiness at `/healthz`. |

The specific browser failure on the legacy Supabase request was unverified. The Render settings and deployed code confirm the provider mismatch independently of that request. Existing-account availability in Neon also remains unverified.

## Implementation plan

1. **Check the production Neon project and data before switching traffic.** Confirm that Neon Auth is enabled, that `NEON_AUTH_URL` points to the intended production branch, and that `https://drivex-2spi.onrender.com` is configured as a trusted origin. Set `APP_ORIGIN=https://drivex-2spi.onrender.com` in Render. Confirm the restricted `DATABASE_URL` points to the same intended environment and that the DriveX migrations and runtime grants are present. Use the [migration guide](https://github.com/ANTOJERRIN/DriveX/blob/be4b356766419cb0995923b7ba119dda209112d6/docs-neon-migration.md) for fresh database setup. Check whether existing Supabase users and records were transferred. If they still live only in Supabase, reconcile users, roles, bookings and receipts and arrange verified Neon account setup before cutover. Keep the database connection string in Render secrets.

2. **Point the existing Render web service at the Neon server.** Keep the production URL and set the commands below using the [Neon Blueprint](https://github.com/ANTOJERRIN/DriveX/blob/be4b356766419cb0995923b7ba119dda209112d6/render.neon.yaml) as the reference. Apply the settings in staging first if a production data or account migration is still pending. Save the configuration and deploy so the running process uses the new commands and variables.

   | Render setting | Value |
   | --- | --- |
   | Build Command | `npm ci && npm run check` |
   | Start Command | `node backend/neon/server.mjs` |
   | Health Check Path | `/healthz` |

3. **Verify the running service before calling sign-in fixed.** Check that `GET /config.mjs` returns `provider: 'neon'`, `GET /healthz` returns HTTP 200 with `{"ready":true}`, and `GET /api/auth/get-session` returns JSON with `{"signedIn":false}` in a fresh browser session. The health endpoint checks the database and dispatcher. Use a verified test learner to check that `POST /api/auth/sign-in/email` succeeds, the next session request reports `signedIn: true`, and the learner dashboard loads and survives a refresh. Check sign-out, invalid credentials, password reset and a verified instructor’s role. Use the Network panel for status codes and correlate any failure with [Render logs](https://dashboard.render.com/web/srv-db3lekm0tbcc73813860/logs) without copying credentials or session cookies.

4. **Record the working deployment settings.** Update the production deployment instructions so the next release starts the Neon server. Mark the static Supabase Blueprint as legacy and record the live deploy ID after the browser checks pass. If cutover fails, restore a previously verified app-and-backend configuration and re-run the sign-in checks.
