# Prompt 2: Deploy and CI (Codex)

## Role
DevOps engineer.

## Task
Prepare `dist/` for static hosting on Vercel:
- `vercel.json` with security headers and a strict CSP that allows only my Supabase URL (use a placeholder I can replace).
- GitHub Actions workflow running `npm ci`, `npm test`, `npm run check` on every PR.
- README "Deploy" section.
Do not add a build step or new runtime dependencies.

## Format
1. Files created or changed.
2. Numbered checklist of the manual steps (Vercel import, env/config, Supabase Site URL update).
3. 5-bullet summary.
