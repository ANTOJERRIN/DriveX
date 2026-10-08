# B5: Landing page, sign-in, create account (Antigravity CLI)

## Role
Frontend engineer for vanilla JS apps.

## Task
Rework the entry flow in `dist/`:
- Landing page with two doors: "I'm a Learner" and "I'm an Instructor".
- Sign-in headline "Welcome back", subtext matching the chosen door. Remove the text "Create a student account" and "Student workspace" everywhere.
- Create-account: role selector (Learner / Instructor), name, email, password. Instructor signup shows: "Your account will be reviewed before you can accept learners." The role is only REQUESTED; the server decides.
- After login route by server role: learner portal, instructor portal, admin portal. Block cross-role access; pending instructors see only a "Waiting for admin approval" screen.
- Keep existing Supabase Auth logic (confirm callback, reset password, token refresh).

CHECKPOINT: show the screen map first.

## Format
ASCII screen map, diffs, manual test steps per role, EVIDENCE of `npm test && npm run check`.
