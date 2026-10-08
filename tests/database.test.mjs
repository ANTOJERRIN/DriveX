import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
// Test-only auth fixtures. The deployed database receives no seed data.
const ids = {
  admin: "00000000-0000-0000-0000-000000000001",
  instructor: "00000000-0000-0000-0000-000000000002",
  student: "00000000-0000-0000-0000-000000000003",
  other: "00000000-0000-0000-0000-000000000004",
};
test("real Postgres schema and complete authorized booking lifecycle", async (t) => {
  const db = new PGlite({ extensions: { btree_gist } });
  await db.exec(`create role anon; create role authenticated; create schema auth;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;
 grant execute on function auth.uid() to authenticated;`);
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/0001_init.sql", import.meta.url),
      "utf8",
    ),
  );
  for (const [name, id] of Object.entries(ids))
    await db.query("insert into auth.users values($1,$2,$3)", [
      id,
      name + "@example.test",
      JSON.stringify({ name, phone: "test-only", role: "admin" }),
    ]);
  async function as(user, action, payload = {}) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      ids[user] || "",
    ]);
    await db.exec("set role authenticated");
    return (
      await db.query("select public.drivex($1,$2) as result", [
        action,
        JSON.stringify(payload),
      ])
    ).rows[0].result;
  }
  await t.test(
    "metadata cannot self-assign admin and new account has no sample bookings",
    async () => {
      const s = await as("student", "snapshot");
      assert.equal(s.me.role, "student");
      assert.equal(s.bookings.length, 0);
      assert.equal(s.vehicles.length, 0);
      await assert.rejects(
        as("student", "add_vehicle", {
          name: "Car",
          reg: "TEST1",
          transmission: "Manual",
        }),
        /Admin access/,
      );
    },
  );
  await as("admin", "snapshot");
  await db.exec("reset role");
  await db.query(
    "update drivex_private.profiles set role='admin' where id=$1",
    [ids.admin],
  );
  await t.test("administrator provisions instructor and vehicle", async () => {
    await as("admin", "add_instructor", {
      email: "instructor@example.test",
      specialty: "Parking",
    });
    await as("admin", "add_vehicle", {
      name: "Test car",
      reg: "TEST 01",
      transmission: "Manual",
    });
    assert.equal((await as("instructor", "snapshot")).me.role, "instructor");
  });
  const base = await as("student", "snapshot"),
    vehicle = base.vehicles[0].id,
    date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
    input = { date, time: "10:00", instructor: ids.instructor, vehicle };
  let booking;
  await t.test(
    "reserve writes persistent pending booking and detects resource overlap",
    async () => {
      booking = await as("student", "reserve", input);
      assert.equal(booking.status, "pending");
      assert.equal((await as("student", "snapshot")).bookings.length, 1);
      await assert.rejects(as("other", "reserve", input), /just reserved/);
      assert.equal(
        (await as("student", "availability", input)).find(
          (t) => t.time === "10:00",
        ).available,
        false,
      );
    },
  );
  await t.test(
    "unpaid lesson stays private and students cannot confirm their own payment",
    async () => {
      assert.equal((await as("instructor", "snapshot")).bookings.length, 0);
      assert.equal((await as("other", "snapshot")).bookings.length, 0);
      await assert.rejects(
        as("student", "record_payment", {
          booking: booking.id,
          reference: "fake-payment",
        }),
        /Admin access/,
      );
      await assert.rejects(
        db.query("select * from drivex_private.bookings"),
        /permission denied/,
      );
    },
  );
  await t.test(
    "verified admin receipt confirms booking atomically and replay is idempotent",
    async () => {
      await as("admin", "record_payment", {
        booking: booking.id,
        reference: "real-test-receipt",
      });
      await as("admin", "record_payment", {
        booking: booking.id,
        reference: "real-test-receipt",
      });
      assert.equal((await as("student", "snapshot")).payments.length, 1);
      assert.equal(
        (await as("instructor", "snapshot")).bookings[0].status,
        "confirmed",
      );
    },
  );
  await t.test(
    "assessment requires assigned instructor, end time and valid score",
    async () => {
      await assert.rejects(
        as("student", "assess", {
          booking: booking.id,
          score: 8,
          notes: "Good",
        }),
        /assigned instructor/,
      );
      await assert.rejects(
        as("instructor", "assess", {
          booking: booking.id,
          score: 8,
          notes: "Good",
        }),
        /after a confirmed/,
      );
      await db.exec("reset role");
      await db.query(
        "update drivex_private.bookings set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' where id=$1",
        [booking.id],
      );
      await assert.rejects(
        as("instructor", "assess", {
          booking: booking.id,
          score: 11,
          notes: "Good",
        }),
        /1 to 10/,
      );
      await as("instructor", "assess", {
        booking: booking.id,
        score: 8,
        notes: "Good mirror checks.",
      });
      assert.equal((await as("student", "snapshot")).bookings[0].score, 8);
    },
  );
  await t.test(
    "cancellation requests do not pretend to refund money",
    async () => {
      const b = await as("student", "reserve", { ...input, time: "11:00" });
      await as("admin", "record_payment", {
        booking: b.id,
        reference: "second-receipt",
      });
      await as("student", "cancel", { booking: b.id });
      const s = await as("student", "snapshot");
      assert.equal(
        s.payments.find((p) => p.booking === b.id).status,
        "refund_pending",
      );
      await assert.rejects(
        as("student", "record_refund", {
          booking: b.id,
          reference: "refund-fake",
        }),
        /Admin access/,
      );
      await as("admin", "record_refund", {
        booking: b.id,
        reference: "refund-receipt",
      });
      assert.equal(
        (await as("student", "snapshot")).bookings.find((x) => x.id === b.id)
          .status,
        "cancelled",
      );
      assert.equal(
        (await as("student", "availability", { ...input, time: "11:00" })).find(
          (t) => t.time === "11:00",
        ).available,
        true,
      );
    },
  );
  await t.test(
    "expired reservation rejects payment and releases slot",
    async () => {
      const b = await as("student", "reserve", { ...input, time: "14:00" });
      await db.exec("reset role");
      await db.query(
        "update drivex_private.bookings set expires_at=now()-interval '1 minute' where id=$1",
        [b.id],
      );
      await assert.rejects(
        as("admin", "record_payment", {
          booking: b.id,
          reference: "late-receipt",
        }),
        /expired/,
      );
      assert.equal(
        (await as("student", "snapshot")).bookings.find((x) => x.id === b.id)
          .status,
        "expired",
      );
    },
  );
  await t.test("anonymous and unknown actions are rejected", async () => {
    await assert.rejects(as("student", "make_me_admin"), /Unknown action/);
    await assert.rejects(as(null, "snapshot"), /Please sign in/);
    await db.exec("reset role;set role anon");
    await assert.rejects(
      db.query("select public.drivex('snapshot')"),
      /permission denied/,
    );
  });
  await db.close();
});
