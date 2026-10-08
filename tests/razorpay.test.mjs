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

test("Razorpay online payments, webhook verification and idempotency", async (t) => {
  // Test 1: Signature verification test
  await t.test("webhook signature verification", async () => {
    const secret = "test_webhook_secret_123";
    const body = JSON.stringify({ event: "payment.captured", id: "pay_123" });

    // Compute valid signature using Web Crypto HMAC SHA256
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

  // Test 2: Database online payment confirmation lifecycle
  const db = new PGlite({ extensions: { btree_gist } });
  await db.exec(`create role anon; create role authenticated; create schema auth;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;`);

  // Apply migrations in order
  await db.exec(await readFile(new URL("../supabase/migrations/0001_init.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../supabase/migrations/0002_razorpay.sql", import.meta.url), "utf8"));

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

  // Provision admin, instructor and vehicle
  await as("admin", "snapshot");
  await db.exec("update drivex_private.profiles set role='admin' where id='" + ids.admin + "'");
  await as("admin", "add_instructor", { email: "instructor@example.test", specialty: "Highway driving" });
  const vehicle = await as("admin", "add_vehicle", { name: "Swift", reg: "KA01AB1234", transmission: "Manual" });

  // Reserve a slot as student
  const futureDate = new Date(Date.now() + 86400000 * 5).toISOString().slice(0, 10);
  const booking = await as("student", "reserve", {
    instructor: ids.instructor,
    vehicle: vehicle.id,
    date: futureDate,
    time: "10:00",
  });
  assert.equal(booking.status, "pending");

  await t.test("get_order_details returns correct server-authoritative amount", async () => {
    const details = await as("student", "get_order_details", { booking: booking.id });
    assert.equal(details.amount_paise, 80000);
    assert.equal(details.booking_id, booking.id);
  });

  await t.test("online payment confirmation confirms booking atomically", async () => {
    const res = await as("student", "confirm_online_payment", {
      booking: booking.id,
      payment_id: "pay_test_001",
      order_id: "order_test_001",
    });
    assert.equal(res.status, "confirmed");

    const snapshot = await as("student", "snapshot");
    const b = snapshot.bookings.find((x) => x.id === booking.id);
    assert.equal(b.status, "confirmed");
    const p = snapshot.payments.find((x) => x.booking === booking.id);
    assert.equal(p.status, "paid");
    assert.equal(p.reference, "pay_test_001");
    assert.equal(p.gateway, "razorpay");
  });

  await t.test("replayed webhook with same payment_id is idempotent", async () => {
    const res = await as("student", "confirm_online_payment", {
      booking: booking.id,
      payment_id: "pay_test_001",
      order_id: "order_test_001",
    });
    assert.equal(res.status, "confirmed");
    assert.equal(res.idempotent, true);
  });

  await t.test("payment after hold expiry is flagged for refund", async () => {
    // Create an expired reservation
    const booking2 = await as("student", "reserve", {
      instructor: ids.instructor,
      vehicle: vehicle.id,
      date: futureDate,
      time: "11:00",
    });
    // Force expiration in DB
    await db.exec(`update drivex_private.bookings set expires_at = now() - interval '5 minutes' where id = '${booking2.id}'`);

    const res = await as("student", "confirm_online_payment", {
      booking: booking2.id,
      payment_id: "pay_test_002_late",
      order_id: "order_test_002",
    });
    assert.equal(res.status, "refund_pending");
    assert.equal(res.reason, "expired_hold");

    const snapshot = await as("admin", "snapshot");
    const b2 = snapshot.bookings.find((x) => x.id === booking2.id);
    assert.equal(b2.status, "cancellation_requested");
    const p2 = snapshot.payments.find((x) => x.booking === booking2.id);
    assert.equal(p2.status, "refund_pending");
  });
});
