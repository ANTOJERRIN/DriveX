# B7: Instructor portal (Antigravity CLI)

## Role
Frontend + Postgres-aware engineer.

## Task
Separate portal for approved instructors:
- Overview: learner count, today's lessons, upcoming lessons, total earnings.
- Learners: each learner's plan, credits left, theory %, practical %.
- Schedule: confirmed lessons by day; "Mark lesson completed" after the slot ends (uses a credit) with a 1-10 score and notes.
- Practical progress: mark practical course lessons done per learner.
- Earnings: payments received (plan, learner first name, amount, date).
- Pending state: "Waiting for admin approval" only.
Admin portal: "Approve / Reject instructors" screen.
Use only existing contract actions. If one is missing, STOP and list it.

CHECKPOINT: show the screen map first.

## Format
ASCII screen map, diffs, tests (pending instructor sees only the waiting screen; an instructor cannot see another instructor's learners or earnings), EVIDENCE of `npm test && npm run check`.
