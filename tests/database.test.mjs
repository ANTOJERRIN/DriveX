import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

const ids = {
  admin: "00000000-0000-0000-0000-000000000001",
  instructor: "00000000-0000-0000-0000-000000000002",
  student: "00000000-0000-0000-0000-000000000003",
  other: "00000000-0000-0000-0000-000000000004",
};

test("DriveX plan-based schema and lifecycle tests", async (t) => {
  const db = new PGlite({ extensions: { btree_gist } });
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;`);

  // Apply migrations 0001, 0002, 0003 in order
  await db.exec(await readFile(new URL("../supabase/migrations/0001_init.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../supabase/migrations/0002_razorpay.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../supabase/migrations/0003_plans.sql", import.meta.url), "utf8"));

  for (const [name, id] of Object.entries(ids)) {
    await db.query("insert into auth.users values($1,$2,$3)", [
      id,
      name + "@example.test",
      JSON.stringify({ name, phone: "test-only" }),
    ]);
  }

  async function as(user, action, payload = {}) {
    await db.exec("reset role");
    if (user) {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [ids[user] || ""]);
      await db.exec("set role authenticated");
    }
    return (
      await db.query("select public.drivex($1,$2) as result", [
        action,
        JSON.stringify(payload),
      ])
    ).rows[0].result;
  }

  // Promote admin profile
  await as("admin", "me");
  await db.exec("reset role");
  await db.query("update drivex_private.profiles set role='admin' where id=$1", [ids.admin]);

  await t.test("plans are seeded with correct prices", async () => {
    const plans = await as("student", "plans_list");
    assert.equal(plans.length, 2);
    const p10 = plans.find((p) => p.id === "plan_10_day");
    assert.equal(p10.price_inr, 1500);
    assert.equal(p10.lesson_credits, 10);
    const pMonthly = plans.find((p) => p.id === "plan_monthly");
    assert.equal(pMonthly.price_inr, 4000);
    assert.equal(pMonthly.lesson_credits, 30);
  });

  await t.test("instructor approval workflow: pending instructors cannot receive enrollments", async () => {
    // Add instructor through admin
    await as("admin", "add_instructor", { email: "instructor@example.test", specialty: "Defensive Driving" });
    await db.exec("reset role");
    // Initially set instructor approval to pending
    await db.query("update drivex_private.profiles set approval_status='pending' where id=$1", [ids.instructor]);

    // Learner cannot enroll with pending instructor
    await assert.rejects(
      as("student", "enroll", { plan_id: "plan_10_day", instructor_id: ids.instructor }),
      /Instructor not available/
    );

    // Admin approves instructor
    await as("admin", "admin_set_instructor_status", { instructor_id: ids.instructor, status: "approved" });
    const approvedList = await as("student", "instructors_list");
    assert.ok(approvedList.some((i) => i.id === ids.instructor));
  });

  let enrollmentId;
  await t.test("learner enrolls in plan and server sets authoritative amount", async () => {
    const enrollment = await as("student", "enroll", { plan_id: "plan_10_day", instructor_id: ids.instructor });
    assert.equal(enrollment.price_inr, 1500);
    assert.equal(enrollment.amount_paise, 150000);
    assert.equal(enrollment.status, "pending_payment");
    enrollmentId = enrollment.enrollment_id;
  });

  await t.test("learner cannot self-mark enrollment paid or call admin_mark_paid", async () => {
    await assert.rejects(
      as("student", "admin_mark_paid", { enrollment_id: enrollmentId }),
      /Admin access required/
    );
  });

  await t.test("admin marks enrollment paid and credits activate", async () => {
    await as("admin", "admin_mark_paid", { enrollment_id: enrollmentId });
    const snap = await as("student", "me");
    assert.equal(snap.active_enrollment.credits_total, 10);
    assert.equal(snap.active_enrollment.credits_remaining, 10);
  });

  let vehicleId;
  await t.test("admin provisions vehicle", async () => {
    const v = await as("admin", "add_vehicle", { name: "Hyundai i20", reg: "KA05MN1234", transmission: "Manual" });
    vehicleId = v.id;
  });

  const futureDate = new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10);
  let bookingId;
  await t.test("learner books lesson using plan credit", async () => {
    const res = await as("student", "reserve", {
      date: futureDate,
      time: "10:00",
      vehicle: vehicleId,
    });
    assert.equal(res.status, "confirmed");
    bookingId = res.id;
  });

  await t.test("double-booking is prevented by database exclusion constraint", async () => {
    await assert.rejects(
      as("other", "reserve", {
        date: futureDate,
        time: "10:00",
        vehicle: vehicleId,
      }),
      /Active plan with available lesson credits required/
    );
  });

  await t.test("completing lesson consumes 1 credit (10 -> 9)", async () => {
    // Force lesson time to past for completion assessment
    await db.exec("reset role");
    await db.query(`update drivex_private.bookings set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour' where id = $1`, [bookingId]);

    await as("instructor", "complete_booking", {
      booking: bookingId,
      score: 9,
      notes: "Smooth steering control and confident braking.",
    });

    const snap = await as("student", "me");
    assert.equal(snap.active_enrollment.credits_used, 1);
    assert.equal(snap.active_enrollment.credits_remaining, 9);
  });

  await t.test("theory progress can be marked by learner but practical only by instructor", async () => {
    const lessons = await as("student", "my_lessons");
    const theory = lessons.find((l) => l.kind === "theory");
    const practical = lessons.find((l) => l.kind === "practical");

    // Student marks theory
    const tRes = await as("student", "mark_theory_done", { lesson_id: theory.id });
    assert.equal(tRes.status, "success");

    // Student CANNOT mark practical
    await assert.rejects(
      as("student", "mark_practical_done", { lesson_id: practical.id, learner_id: ids.student }),
      /Only instructor can mark practical/
    );

    // Instructor marks practical
    const pRes = await as("instructor", "mark_practical_done", { lesson_id: practical.id, learner_id: ids.student });
    assert.equal(pRes.status, "success");
  });
});
