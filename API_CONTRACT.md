# DriveX API Contract: `public.drivex(action, payload)`

All calls require an authenticated user JWT bearer token. `drivex` is a `SECURITY DEFINER` RPC running in the `drivex_private` schema.

---

## 1. Authentication & Common Actions

### `me` / `snapshot`
* **Allowed Roles:** `student`, `instructor`, `admin`
* **Payload:** `{}`
* **Success JSON:**
  ```json
  {
    "me": { "id": "uuid", "name": "string", "phone": "string", "role": "string", "approval_status": "string" },
    "plans": [{ "id": "plan_10_day", "name": "10-Day Plan", "price_inr": 1500, "lesson_credits": 10 }],
    "active_enrollment": { "id": "uuid", "plan_id": "string", "credits_total": 10, "credits_used": 0, "credits_remaining": 10 },
    "instructors": [{ "id": "uuid", "name": "string", "specialty": "string" }],
    "vehicles": [{ "id": "uuid", "name": "string", "reg": "string", "transmission": "Manual" }],
    "bookings": []
  }
  ```
* **Error:** `42501`: "Please sign in."

---

## 2. Plan & Enrollment Actions

### `plans_list`
* **Allowed Roles:** Any authenticated user
* **Payload:** `{}`
* **Success JSON:** `[{"id": "plan_10_day", "name": "10-Day Plan", "price_inr": 1500, "lesson_credits": 10}]`

### `instructors_list`
* **Allowed Roles:** Any authenticated user
* **Payload:** `{}`
* **Success JSON:** `[{"id": "uuid", "name": "Instructor Name", "specialty": "Manual"}]`

### `enroll`
* **Allowed Roles:** `student`
* **Payload:** `{"plan_id": "plan_10_day", "instructor_id": "uuid"}`
* **Success JSON:** `{"enrollment_id": "uuid", "plan_name": "10-Day Plan", "price_inr": 1500, "amount_paise": 150000, "status": "pending_payment"}`
* **Errors:**
  * `42501`: "Only learners can enroll in plans."
  * "Plan not found."
  * "Instructor not available."

### `my_payments`
* **Allowed Roles:** `student`, `admin`
* **Payload:** `{}`
* **Success JSON:** `[{"id": "uuid", "enrollment_id": "uuid", "plan_name": "10-Day Plan", "amount_inr": 1500, "status": "paid", "paid_at": "timestamp"}]`

---

## 3. Booking & Credit Lifecycle Actions

### `dashboard`
* **Allowed Roles:** `student`
* **Payload:** `{}`
* **Success JSON:**
  ```json
  {
    "credits_remaining": 10,
    "confirmed_count": 1,
    "completed_count": 0,
    "next_confirmed_lesson": { "id": "uuid", "date": "2026-10-15", "time": "10:00", "instructor_name": "John" },
    "progress_percent": 15
  }
  ```

### `availability`
* **Allowed Roles:** `student`
* **Payload:** `{"date": "YYYY-MM-DD", "instructor": "uuid", "vehicle": "uuid"}`
* **Success JSON:** `[{"time": "08:00", "available": true}, {"time": "09:00", "available": false}]`

### `reserve` (Book 1-hour lesson using Plan Credit)
* **Allowed Roles:** `student` (Must have active plan with `credits_remaining > 0`)
* **Payload:** `{"date": "YYYY-MM-DD", "time": "10:00", "vehicle": "uuid"}`
* **Success JSON:** `{"id": "uuid", "status": "confirmed", "starts_at": "timestamp"}`
* **Errors:**
  * "Active plan with available lesson credits required to book."
  * "Choose a valid lesson time."
  * `23P01`: "This slot was just reserved. Choose another time."

### `cancel_booking`
* **Allowed Roles:** `student` (owner), `admin`
* **Payload:** `{"booking": "uuid"}`
* **Success JSON:** `{"id": "uuid", "status": "cancelled"}`

### `complete_booking` / `assess`
* **Allowed Roles:** Assigned `instructor` only
* **Payload:** `{"booking": "uuid", "score": 9, "notes": "Great lane change maneuvers."}`
* **Success JSON:** `{"id": "uuid", "status": "completed"}`
* **Side-effect:** Automatically increments `credits_used` by 1 on learner's enrollment.

---

## 4. Syllabus & Learning Progress

### `my_lessons`
* **Allowed Roles:** `student`
* **Payload:** `{}`
* **Success JSON:** `[{"id": "uuid", "kind": "theory", "title": "Traffic Signs", "youtube_url": null, "completed": true}]`

### `mark_theory_done`
* **Allowed Roles:** `student`
* **Payload:** `{"lesson_id": "uuid"}`
* **Success JSON:** `{"status": "success"}`

### `mark_practical_done`
* **Allowed Roles:** `instructor`
* **Payload:** `{"learner_id": "uuid", "lesson_id": "uuid"}`
* **Success JSON:** `{"status": "success"}`

---

## 5. Server-to-Server Payment Webhook RPC

### `public.confirm_payment_server(...)`
* **Allowed Role:** `service_role` ONLY (Revoked from public, anon, authenticated)
* **Signature:** `confirm_payment_server(provider_order_id text, provider_payment_id text, amount_paise int, event_id text)`
* **Success JSON:** `{"status": "success", "enrollment_id": "uuid"}`
* **Idempotency:** Replays with same `event_id` return `{"status": "success", "idempotent": true}`.
