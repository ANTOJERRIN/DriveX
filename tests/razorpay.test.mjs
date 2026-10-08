import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { verifyWebhookSignature } from "../supabase/functions/_shared/crypto.mjs";

const ids = {
  admin: "00000000-0000-0000-0000-000000000001",
  instructor: "00000000-0000-0000-0000-000000000002",
  student: "00000000-0000-0000-0000-000000000003",
};

test("Razorpay webhook verification and plan enrollment confirmation", async (t) => {
  // Test 1: Webhook signature verification
  await t.test("webhook signature verification", async () => {
    const secret = "test_webhook_secret_123";
    const body = JSON.stringify({ event: "order.paid", id: "pay_123" });

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signatureBytes = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(body)
    );
    const validSignature = Array.from(new Uint8Array(signatureBytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    assert.equal(await verifyWebhookSignature(body, validSignature, secret), true);
    assert.equal(await verifyWebhookSignature(body, "bad_signature", secret), false);
    assert.equal(await verifyWebhookSignature(body, validSignature, "wrong_secret"), false);
  });

  // Test 2: Database server-to-server confirmation
  const db = new PGlite({ extensions: { btree_gist } });
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;`);

  await db.exec(await readFile(new URL("../supabase/migrations/0001_init.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../supabase/migrations/0002_razorpay.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../supabase/migrations/0003_plans.sql", import.meta.url), "utf8"));

  for (const [name, id] of Object.entries(ids)) {
    await db.query("insert into auth.users values($1,$2,$3)", [
      id,
      name + "@example.test",
      JSON.stringify({ name, phone: "test-only" }),
    ]);
    await db.query("insert into drivex_private.profiles(id, name, phone, role, approval_status) values($1, $2, 'test-phone', $3, 'approved')", [
      id,
      name,
      name === "instructor" ? "instructor" : (name === "admin" ? "admin" : "student"),
    ]);
  }

  // Student enrolls in 10-day plan
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [ids.student]);
  await db.exec("set role authenticated");
  const enrollRes = (await db.query("select public.drivex('enroll', '{\"plan_id\":\"plan_10_day\",\"instructor_id\":\"" + ids.instructor + "\"}') as result")).rows[0].result;
  assert.equal(enrollRes.status, "pending_payment");
  const enrollmentId = enrollRes.enrollment_id;

  // Test 3: confirm_payment_server
  await db.exec("reset role");
  await db.exec("set role service_role");

  await t.test("confirm_payment_server rejects amount mismatch", async () => {
    await assert.rejects(
      db.query("select public.confirm_payment_server($1, $2, $3, $4)", [
        "order_" + enrollmentId,
        "pay_123",
        50000, // Expected 150000 paise
        "evt_001",
      ]),
      /Invalid amount/
    );
  });

  await t.test("confirm_payment_server activates enrollment with correct amount", async () => {
    const res = (await db.query("select public.confirm_payment_server($1, $2, $3, $4) as result", [
      "order_" + enrollmentId,
      "pay_123",
      150000,
      "evt_001",
    ])).rows[0].result;
    assert.equal(res.status, "success");

    await db.exec("reset role");
    const en = (await db.query("select * from drivex_private.enrollments where id=$1", [enrollmentId])).rows[0];
    assert.equal(en.status, "active");
  });

  await t.test("confirm_payment_server is idempotent on replayed event_id", async () => {
    await db.exec("set role service_role");
    const res = (await db.query("select public.confirm_payment_server($1, $2, $3, $4) as result", [
      "order_" + enrollmentId,
      "pay_123",
      150000,
      "evt_001",
    ])).rows[0].result;
    assert.equal(res.status, "success");
    assert.equal(res.idempotent, true);
  });
});
