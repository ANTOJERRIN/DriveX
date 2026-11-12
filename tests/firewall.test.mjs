import test from 'node:test';
import assert from 'node:assert/strict';
import { database, ids } from './helpers/database.mjs';

test('firewall protects actual RPC actions and reports transactional limits honestly', async t => {
  const { db, as } = await database();
  t.after(() => db.close());
  const key = ids.student + ':snapshot';
  async function seed(count, age = '0 seconds', rateKey = key) {
    await db.exec('reset role');
    await db.query(`insert into drivex_private.rate_limits(rate_key,bucket_count,window_start)
      values($1,$2,clock_timestamp()-$3::interval) on conflict(rate_key)
      do update set bucket_count=excluded.bucket_count,window_start=excluded.window_start`, [rateKey,count,age]);
  }

  await t.test('inspection rejects malformed names, non-object payloads and oversized UTF-8 bodies', async () => {
    for (const action of ['bad action', 'action;drop table profiles;', 'a', null]) {
      await assert.rejects(as('student', action), /MALFORMED_ACTION/);
    }
    for (const payload of [[], 'text', 1, true, null]) {
      await assert.rejects(as('student', 'snapshot', payload), /object payload/);
    }
    await assert.rejects(as('student', 'snapshot', {blob:'x'.repeat(70000)}), /PAYLOAD_TOO_LARGE/);
    await assert.rejects(as('student', 'snapshot', {blob:'₹'.repeat(23000)}), /PAYLOAD_TOO_LARGE/);
  });

  await t.test('real read actions allow the last request, reject the next and isolate accounts/actions', async () => {
    await seed(1199);
    assert.equal((await as('student', 'snapshot')).me.id, ids.student);
    for (let i=0;i<2;i++) await assert.rejects(as('student', 'snapshot'), /RATE_LIMIT_EXCEEDED/);
    assert.equal((await as('other', 'snapshot')).me.id, ids.other);
    assert.equal((await as('student', 'plans_list')).length, 2);
    await db.exec('reset role');
    assert.equal((await db.query('select bucket_count from drivex_private.rate_limits where rate_key=$1', [key])).rows[0].bucket_count,1200);
    // Denied statements roll back. The API must not invent a durable audit row.
    assert.equal((await db.query('select count(*)::int as count from drivex_private.security_audit_log')).rows[0].count,0);
  });

  await t.test('expired buckets reset; write actions have their own lower threshold', async () => {
    await seed(1200, '61 seconds');
    await as('student', 'snapshot');
    await db.exec('reset role');
    assert.equal((await db.query('select bucket_count from drivex_private.rate_limits where rate_key=$1', [key])).rows[0].bucket_count,1);
    const payload={plan_id:'plan_10_day', instructor_id:ids.instructor};
    await seed(59,'0 seconds',ids.student+':enroll');
    assert.ok((await as('student','enroll',payload)).enrollment_id);
    await assert.rejects(as('student','enroll',payload),/RATE_LIMIT_EXCEEDED/);
  });

  await t.test('no synthetic route or profile-less authenticated access; status is admin-only', async () => {
    await assert.rejects(as('student','firewall_test_rate_limit'),/Unknown action/);
    await assert.rejects(as('student','firewall_status'),/Admin access required/);
    await assert.rejects(as('10000000-0000-0000-0000-000000000099','firewall_status'),/Sign in required/);
    await assert.rejects(as('','snapshot'),/permission denied/);
    const status=await as('admin','firewall_status');
    assert.equal(status.status,'active');
    assert.equal(status.denial_log,'postgres');
    assert.equal(status.counter_scope,'committed_requests');
    assert.equal(status.violations_logged,0);
    assert.deepEqual(status.recent_violations,[]);
  });

  await t.test('private helpers reject invalid settings and cannot be called by browsers', async () => {
    await db.exec('reset role');
    for (const args of [[null,3,60],['test',0,60],['test',3,0],['test',null,60],['test',3,null]]) {
      await assert.rejects(db.query('select drivex_private.check_rate_limit($1,$2,$3)',args),/Invalid rate limit configuration/);
    }
    await as('student','plans_list');
    for (const table of ['rate_limits','security_audit_log']) {
      await assert.rejects(db.query('select * from drivex_private.'+table),/permission denied/);
    }
    for (const fn of ["check_rate_limit('test',3,60)","inspect_request('snapshot','{}')","dispatch_before_firewall('snapshot','{}')"]) {
      await assert.rejects(db.query('select drivex_private.'+fn),/permission denied/);
    }
  });
});
