# DriveX API contract

Browser domain-data calls use `POST /rest/v1/rpc/drivex` with an authenticated bearer JWT and JSON `{ "action": "...", "payload": {} }`. `public.drivex(text,jsonb)` is a security-invoker wrapper; the private security-definer dispatcher enforces identity, protected role and ownership. Browsers have no direct table access. Stored role `student` means learner in the UI.

Pending/rejected instructors may call only `me` or `snapshot`, which return `{me}`. All other instructor capabilities require `approval_status = approved`. UUID fields and integer score fields are validated by PostgreSQL casts and constraints as well as domain checks. Empty collections return arrays, not fabricated records.

## Identity, catalog and snapshot

| Action | Roles | Payload | Response |
| --- | --- | --- | --- |
| `me`, `snapshot` | Learner, instructor, admin | `{}` | Snapshot below; pending/rejected instructor receives only `me` |
| `plans_list` | Learner, approved instructor, admin | `{}` | Active plan objects: `id,name,price_inr,lesson_credits,active,created_at` |
| `instructors_list` | Learner, approved instructor, admin | `{}` | Approved instructor summaries; admin also sees pending/rejected |

Snapshot:

```json
{
  "me": { "id": "uuid", "name": "Name", "phone": "", "role": "student", "approval_status": "approved" },
  "plans": [{ "id": "plan_10_day", "name": "10-Day Plan", "price_inr": 1500, "lesson_credits": 10 }],
  "active_enrollment": {
    "id": "uuid", "plan_id": "plan_10_day", "plan_name": "10-Day Plan",
    "instructor_id": "uuid", "instructor_name": "Instructor",
    "credits_total": 10, "credits_used": 0, "credits_remaining": 10,
    "credits_reserved": 1, "status": "active", "review_required": false
  },
  "instructors": [{ "id": "uuid", "name": "Instructor", "specialty": "Driving instructor", "approval_status": "approved", "phone": "" }],
  "vehicles": [{ "id": "uuid", "name": "School car", "reg": "REGISTRATION", "transmission": "Manual", "active": true }],
  "bookings": []
}
```

`active_enrollment` is null without an active plan. Admin fleet includes inactive vehicles; other roles see active vehicles only. Learners see their own bookings; approved instructors see their own assigned confirmed/completed bookings; admins see all. Booking objects include `id,student_id,student,student_phone,instructor,instructor_name,vehicle,vehicle_name,enrollment_id,date,time,starts_at,ends_at,status,score,notes`. `date,time` are IST; timestamps include a timezone. Learner contact information is disclosed only to the authorized assigned instructor/admin. Instructor phone numbers are visible only to that instructor/admin.

## Learner plans and lessons

| Action | Roles | Payload | Response / rules |
| --- | --- | --- | --- |
| `enroll` | Learner | `{plan_id,instructor_id}` | `{enrollment_id,price_inr,amount_paise,status:"pending_payment"}`; copies price and credits from active server plan; requires approved instructor; reuses an identical pending enrollment; rejects another unfinished plan |
| `get_checkout` | Learner | `{enrollment_id}` | `{enrollment_id,amount_paise,order_id}`; owns pending enrollment; stored provider order or null; price is the enrollment's immutable payment snapshot |
| `availability` | Learner | `{date:"YYYY-MM-DD",vehicle:"uuid"}` | `[{time:"08:00",available:true},...]`; active paid/reviewed plan, unreserved credits, approved assigned instructor, active vehicle, date within 90 days |
| `reserve` | Learner | `{date,time,vehicle}` | `{id,status:"confirmed",starts_at}`; assigned instructor is chosen by server; `instructor`, amount and status supplied by client are ignored |
| `cancel_booking`, `cancel` | Owning learner or admin | `{booking:"uuid"}` | `{id,status:"cancelled"}` for future plan lessons; no credit consumed. Historical paid lessons return `cancellation_requested` and set their receipt to `refund_pending` |
| `my_lessons` | Learner | `{}` | Course objects: `id,kind,title,youtube_url,sort_order,completed,completed_at` |
| `mark_theory_done` | Learner | `{lesson_id:"uuid"}` | `{status:"success"}`; own theory progress only; idempotent |
| `dashboard` | Learner | `{}` | `credits_remaining,confirmed_count,completed_count,progress_percent,next_confirmed_lesson,recent_lessons` |

Dashboard `next_confirmed_lesson` is null or `{id,date,time,instructor_name}` for the earliest future confirmed lesson. `recent_lessons` contains up to five own bookings with `id,starts_at,ends_at,status,score,notes,instructor_name`, newest scheduled time first. Curriculum percentage counts watched theory plus marked practical items out of all course items. Reserved credits remain in `credits_remaining` until completion but cannot be reserved a second time.

All new lessons are one hour, within the enrolled instructor's weekly hours in IST. Defaults produce 08:00, 09:00, 10:00, 11:00, 14:00, 15:00, 16:00 or 17:00; edited windows may start on half-hours. Closed weekdays return no slots and blocked dates produce a specific validation error. An enrollment is locked before counting reservations. GiST exclusion constraints remain the final guard against learner, instructor and vehicle overlap. Expired legacy pending holds are released before snapshot/availability/reserve.

## Instructor actions

| Action | Roles | Payload | Response / rules |
| --- | --- | --- | --- |
| `instructor_overview` | Approved instructor | `{}` | `learners_count,today_lessons,upcoming_lessons,completed_lessons,total_earnings` |
| `instructor_schedule` | Approved instructor | `{}` | Assigned confirmed/completed booking objects from the snapshot |
| `instructor_learners` | Approved instructor | `{}` | Current paid learners: `learner_id,learner_name,phone,plan_name,credits_total,credits_remaining,status,lessons` |
| `learner_lessons` | Current paid instructor | `{learner_id:"uuid"}` | Learner course/progress objects |
| `mark_practical_done` | Current paid instructor | `{learner_id,lesson_id}` | `{status:"success"}`; practical kind only, idempotent |
| `complete_booking`, `assess` | Assigned approved instructor | `{booking,score:1,notes:"..."}` | `{id,status:"completed"}`; after end, score 1–10 and notes 1–1,500 characters; consumes one credit. Repeat completion is idempotent |
| `instructor_earnings` | Approved instructor | `{}` | Paid/reviewed plan payment objects for their own enrollments, with learner first name only |

The current instructor is selected from the learner's most recently activated paid, reviewed active/finished enrollment. A former instructor cannot keep marking another instructor's current learner. Historical attributable plan receipts remain in that instructor's collections. Collections are school receipts, not salary/payout calculations.

## Payments and administrator actions

`my_payments` is available to learners for their own records and admins for all records. A plan payment contains:

```json
{
  "id": "uuid", "enrollment_id": "uuid", "plan_name": "10-Day Plan",
  "learner_name": "Name", "instructor_name": "Instructor", "instructor_id": "uuid",
  "amount_inr": 1500, "status": "created", "paid_at": null, "created_at": "timestamp",
  "reference": "enrollment_uuid", "provider": "razorpay", "review_required": false, "refund_reference": null
}
```

Historical per-lesson receipts are also returned to their learner/admin with `legacy:true`, `booking_id`, null `enrollment_id` and `plan_name:"Legacy lesson receipt"`. There is no new per-lesson purchase path. Their existing refund requests can be resolved through the admin-only legacy action.

| Action | Role | Payload | Response / rules |
| --- | --- | --- | --- |
| `admin_overview` | Admin | `{}` | `total_learners,total_instructors,pending_instructors,active_enrollments,review_payments` |
| `admin_instructors_pending` | Admin | `{}` | Pending instructor profile objects |
| `admin_set_instructor_status` | Admin | `{instructor_id,status:"approved"}` | `{id,status:"success"}`; status must be approved/rejected |
| `add_instructor` | Admin | `{email,specialty}` | `{id,status:"success"}`; account must exist; cannot reassign admin or learner with unfinished enrollment |
| `add_vehicle` | Admin | `{name,reg,transmission:"Manual"}` | `{id,status:"success"}`; registration normalized and unique; Manual/Automatic only |
| `admin_set_vehicle_active` | Admin | `{vehicle_id,active:true}` | `{id,status:"success"}`; history preserved |
| `admin_mark_paid` | Admin | `{enrollment_id,reference}` | `{id,status:"success"}`; actual receipt reference required; repeated identical settled receipt is idempotent; issued online orders must be reconciled first |
| `admin_record_refund` | Admin | `{enrollment_id,reference}` | `{id,status:"success"}`; actual full refund already returned; unused paid plan with no reserved lessons; closes plan; repeated same reference idempotent |
| `record_refund` | Admin | `{booking,reference}` | `{id,status:"success"}`; legacy cancellation_requested lesson with refund_pending receipt only; records returned money and cancels lesson |
| `admin_lessons` | Admin | `{}` | Curriculum objects without learner completion |
| `admin_update_lesson` | Admin | `{lesson_id,youtube_url}` | `{id,status:"success"}`; theory only; nullable HTTPS YouTube watch/youtu.be URL |

Receipt references are 3–120 characters. Plan payment references are unique; provider order IDs, provider payment IDs and enrollment payment rows have unique indexes. Full refund recording never calls a payment provider or moves money.

## Edge Functions and service-only RPCs

`POST /functions/v1/create-order` takes `{enrollment_id}` and a user bearer JWT. It returns only `{order_id,amount,currency:"INR",key_id}`. It refuses a live Razorpay key unless server secret `RAZORPAY_ALLOW_LIVE=true`. It calls the authenticated `get_checkout` action, creates a server-priced provider order when needed, then registers it before returning it. Existing orders are reused; concurrent registration returns the first stored order.

`POST /functions/v1/razorpay-webhook` has gateway JWT verification disabled and requires a valid `X-Razorpay-Signature` over the raw body. It takes event identity from `x-razorpay-event-id`, handles `payment.captured`, `order.paid` and `payment.failed`, checks INR and expected captured/failed entity status and invokes the service-only event RPC. Unknown event types return 200 ignored. Invalid signatures/payloads return 400; transient reconciliation failures return 503 for provider retry. No raw payloads, keys or customer records are logged.

| RPC | Caller | Arguments | Response |
| --- | --- | --- | --- |
| `register_payment_order` | `service_role` only | `p_enrollment_id uuid,p_order_id text,p_amount_paise int` | `{order_id,amount,currency}`; pending enrollment and exact payment snapshot amount required |
| `process_payment_event` | `service_role` only | `p_order_id,p_payment_id,p_amount_paise,p_currency,p_event_id,p_status` | `{status:"success",enrollment_id,idempotent}` or `{status:"success",idempotent:true}`; status paid/failed only |
| `confirm_payment_server` | `service_role` only | `p_provider_order_id,p_provider_payment_id,p_amount_paise,p_event_id` | Compatibility wrapper for a paid INR event; same locking/replay protections |

Processing compares exact stored order and amount, rejects reused event IDs with different payment data, prevents different payments from settling the same plan, keeps paid records paid after late failed attempts and never reactivates refunded plans. Anonymous/authenticated browser roles cannot execute these RPCs.

## Errors

| Code / condition | Meaning / example |
| --- | --- |
| `42501` | Not signed in; role denied; pending instructor; another learner's enrollment/progress; service-only RPC permission denied |
| `P0001` | Domain validation, e.g. active plan required, payment review required, all credits reserved, inactive vehicle, invalid lesson time, lesson not ended, receipt required |
| `23P01` | Overlap: `This slot was just reserved. Choose another time.` |
| `23505` | Duplicate registration/receipt/provider ID; transaction fails without partial writes |
| `23514` / `22P02` | Constraint or type validation, such as invalid transmission, malformed UUID or invalid integer |
| `PGRST202` | RPC missing from deployed schema; client asks the learner to contact the school for a database update |
| Network failure | Client reports that the server could not be reached; it does not supply sample domain data |

Retired browser actions `set_my_role`, `pay_enrollment`, `confirm_payment` and `confirm_online_payment` always raise `42501`. Other unrecognized actions raise an unknown-action error. Application authorization does not depend on a client role selector or mutable metadata after initial profile creation.

## Additional scheduling and notification actions

These actions use the same authenticated `public.drivex` entry point. The prior private dispatchers are owner-only and cannot be called by browser roles to bypass the added rules.

| Action | Roles | Payload | Response / rules |
| --- | --- | --- | --- |
| `working_hours` | Approved instructor for self; admin | `{instructor_id}` for admin, `{}` for instructor | `{instructor_id,hours:[{weekday:0,start:"08:00",end:"12:00"}],blocked_dates:[{date,reason}]}`; Sunday=0; private blocked-date notes are never returned to learners |
| `set_working_hours` | Approved instructor for self; admin | `{instructor_id?,hours:[{weekday,start,end}]}` | Same schedule response. Replaces the week transactionally, up to 28 windows; empty array closes the week. Half-hour boundaries, windows at least one hour, no overlaps. Rejects edits conflicting with existing reserved lessons |
| `set_blocked_date` | Approved instructor for self; admin | `{instructor_id?,date,blocked:true,reason?}` | Same schedule response. Date must be within the next year; note at most 200 characters. `blocked:false` removes the date. Cannot block a date with an unresolved reserved lesson |
| `notification_status` | Admin | `{}` | `{counts:{pending,due,sent,failed,processing},scheduler:{installed,worker_configured},jobs:[{id,event,status,attempts,next_attempt_at,created_at,last_error}]}`; last 30 jobs; no recipient addresses or delivery bodies |
| `retry_notification` | Admin | `{id}` | `{id,status:"pending"}`; explicit reset for a failed job; changed-recipient failures require reconciliation and cannot be retried this way |

New instructor profiles receive the default seven-day teaching week. Blocked dates cause a specific validation error for learner availability/reservation. A closed weekday returns `[]`. Schedule changes and reservations coordinate through a lock on the instructor profile; existing booking exclusion constraints are retained.

### Notification service endpoint

`POST /functions/v1/notification-worker` is a machine endpoint, with gateway JWT verification disabled and a dedicated `Authorization: Bearer <worker-token>` check inside the function. Tokens must be at least 32 characters and match the server's `NOTIFICATION_WORKER_TOKEN`. The request body does not supply recipients or messages. Missing/wrong caller credentials return 401; incomplete server delivery configuration returns 503 before claiming work. Success returns aggregate `{processed,sent,retried,failed}` counts, never addresses, message text or provider error bodies.

The worker uses only this service-only RPC:

| RPC | Caller | Arguments | Response |
| --- | --- | --- | --- |
| `drivex_notification_jobs` | `service_role` only | `action:"claim",payload:{}` | At most ten `{id,claim_token,delivery}` items; five-minute lease; attempts increment on claim |
| `drivex_notification_jobs` | `service_role` only | `action:"finish",payload:{id,claim_token,success,provider_id?,error?,permanent?}` | `{status:"sent"|"pending"|"dead"|"stale"}`; only the current lease can acknowledge; success requires provider receipt |

Private delivery data includes recipient email/name, event and the lesson/refund fields needed for deterministic plain-text rendering. It is cleared after provider acceptance. `sent` means provider accepted, not proven inbox delivery. Last-error values are sanitized categories. Failed sends back off exponentially and stop automatically after five attempts; an abandoned fifth lease also becomes dead. Stale/cancelled/completed lessons are suppressed before delivery, and pending reminders are cancelled when a lesson is cancelled, completed or moved.

`booking_confirmed` and `booking_cancelled` target the learner/instructor; `refund_recorded` targets the learner; `lesson_reminder` targets learner/instructor about 24 hours before start. A late-booking/catch-up policy, provider idempotency limits, cron/Vault setup and hosted acceptance requirements are documented in [docs/ADDITIONAL_ABILITIES.md](docs/ADDITIONAL_ABILITIES.md).
