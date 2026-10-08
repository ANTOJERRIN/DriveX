# B6: Learner portal (Antigravity CLI)

## Role
Frontend engineer building a clean, simple learner experience. Plain language, no admin jargon.

## Task
Build with the B3 API wrappers:
1. Overview: "Welcome, <name>". Cards: Lessons left, Confirmed lessons, Completed lessons, Next lesson (date, time, instructor), Learning progress bar, Recent lessons.
2. Choose plan: 10-Day Rs 1500 and Monthly Rs 4000 (from `plans_list`), pick an approved instructor, pay with the B4 checkout.
3. Book a lesson: slots with the enrolled instructor. If no active plan, show "Buy a plan to book". Always show the real reason when blocked, never a generic "not available".
4. My Lessons: Theory list with YouTube links (new tab) and "Mark as watched"; Practical list with sessions and status set by the instructor.
5. My Progress: percent = (theory watched + practical completed) / total, with separate theory and practical bars.
6. Payments: plan, instructor, amount, date, badge Paid/Failed/Pending. No "record payment" or "refund" buttons; refunds are a "Contact support" note.
Mobile-first, accessible (labels, focus, contrast), clear empty/loading/error states.

CHECKPOINT: show the screen map first.

## Format
ASCII screen map, diffs, manual test (buy 10-Day plan in Razorpay test mode, complete 2 lessons, dashboard shows 8 left), EVIDENCE of `npm test && npm run check`.
