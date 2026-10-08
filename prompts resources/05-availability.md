# Prompt 5: Instructor availability (Codex)

## Role
Postgres engineer.

## Task
Replace the hardcoded 8 daily slots with per-instructor weekly working hours and blocked dates.
- Admin (and the instructor for their own) can edit them.
- The `availability` and `reserve` actions must respect them.
- Do not weaken or remove the existing exclusion constraints.
- Times stay in Asia/Kolkata.

## Format
1. Migration SQL.
2. Updated dispatcher actions.
3. UI changes for editing hours.
4. Tests: blocked day, outside hours, past date, overlap race.
5. 5-bullet summary.
