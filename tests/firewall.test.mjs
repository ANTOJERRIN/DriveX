import test from 'node:test';
import assert from 'node:assert/strict';
import { database, ids } from './helpers/database.mjs';

test('Backend firewall: WAF payload inspection, rate limiting, and private table security', async t => {
  const h = await database(), { db, as } = h;
  t.after(() => db.close());

  await t.test('WAF request inspection rejects malformed actions, types, and oversized payloads', async () => {
    // Malformed action names
    await assert.rejects(as('student', 'bad action name with spaces'), /MALFORMED_ACTION|Invalid action name/);
    await assert.rejects(as('student', 'action;drop table profiles;'), /MALFORMED_ACTION|Invalid action name/);
    await assert.rejects(as('student', 'a'), /MALFORMED_ACTION|Invalid action name/);

    // Oversized payload (> 64KB)
    const largeObject = { blob: 'x'.repeat(70000) };
    await assert.rejects(as('student', 'snapshot', largeObject), /PAYLOAD_TOO_LARGE/);
  });

  await t.test('rate limiting enforces threshold on monitored actions and logs violations', async () => {
    // firewall_test_rate_limit is configured with limit: 3 per 60 seconds
    const r1 = await as('student', 'firewall_test_rate_limit');
    assert.equal(r1.status, 'allowed');
    const r2 = await as('student', 'firewall_test_rate_limit');
    assert.equal(r2.status, 'allowed');
    const r3 = await as('student', 'firewall_test_rate_limit');
    assert.equal(r3.status, 'allowed');

    // 4th request must be rejected by the backend rate limiter
    await assert.rejects(
      as('student', 'firewall_test_rate_limit'),
      /RATE_LIMIT_EXCEEDED/
    );
  });

  await t.test('security audit log and firewall status require admin role', async () => {
    // Students cannot view firewall status
    await assert.rejects(as('student', 'firewall_status'), /Admin access required/);

    // Admin can view firewall status and see logged rate limit violations
    const status = await as('admin', 'firewall_status');
    assert.equal(status.status, 'active');
    assert.ok(status.rate_limits_tracked >= 1);
    assert.ok(status.violations_logged >= 1);
    assert.ok(Array.isArray(status.recent_violations));
    assert.equal(status.recent_violations[0].status, 'RATE_LIMITED');
  });

  await t.test('firewall tables have RLS and reject direct client queries', async () => {
    await assert.rejects(db.query('select * from drivex_private.rate_limits'), /permission denied/);
    await assert.rejects(db.query('select * from drivex_private.security_audit_log'), /permission denied/);
    await assert.rejects(db.query("select drivex_private.check_rate_limit('test', 10, 60)"), /permission denied/);
  });
});
