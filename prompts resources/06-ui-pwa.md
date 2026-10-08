# Prompt 6: UI polish and PWA (Antigravity CLI)

## Role
Senior product designer-developer for mobile-first web apps.

## Task
Audit `dist/app.mjs` and `dist/styles.css`, then improve:
- Mobile layout, accessibility (labels, focus order, contrast), empty/error/loading states.
- Add a web manifest, icons and an offline app shell so it installs as a PWA.
- Split `app.mjs` into modules per role (student, instructor, admin) without changing behavior.
- Do NOT change `api.mjs` or any backend contract.

## Format
1. Before/after list of issues found.
2. The changes, grouped by file.
3. Confirmation that `npm test && npm run check` passes.
