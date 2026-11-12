import crypto from 'node:crypto';

export const ACTION_POLICY = Object.freeze({
  snapshot: { roles: ['student', 'learner', 'instructor', 'admin'], rateTier: 'standard' },
  me: { roles: ['student', 'learner', 'instructor', 'admin'], rateTier: 'standard' },
  instructor_overview: { roles: ['instructor', 'admin'], rateTier: 'standard' },
  create_checkout_order: {
    roles: ['student', 'learner'],
    rateTier: 'mutation',
    forbiddenFields: ['amount', 'price', 'price_paise', 'amount_inr', 'status', 'review_required', 'role']
  },
  set_working_hours: { roles: ['instructor', 'admin'], requireApprovedInstructor: true, rateTier: 'mutation' },
  set_blocked_date: { roles: ['instructor', 'admin'], requireApprovedInstructor: true, rateTier: 'mutation' },
  unblock_date: { roles: ['instructor', 'admin'], requireApprovedInstructor: true, rateTier: 'mutation' },
  complete_theory: { roles: ['student', 'learner', 'instructor', 'admin'], rateTier: 'mutation' },
  complete_practical: { roles: ['instructor', 'admin'], requireApprovedInstructor: true, rateTier: 'mutation' },
  add_instructor: { roles: ['admin'], rateTier: 'admin' },
  add_vehicle: { roles: ['admin'], rateTier: 'admin' },
  set_instructor_status: { roles: ['admin'], rateTier: 'admin' },
  set_vehicle_status: { roles: ['admin'], rateTier: 'admin' },
  legacy_refund: { roles: ['admin'], rateTier: 'admin' },
  submit_recommendation_feedback: { roles: ['student', 'learner'], rateTier: 'mutation' },
  my_profile: { roles: ['learner', 'instructor', 'admin'], rateTier: 'standard' },
  list_plans: { roles: ['learner', 'instructor', 'admin'], rateTier: 'standard' },
  enroll_plan: {
    roles: ['learner', 'student'],
    rateTier: 'mutation',
    forbiddenFields: ['amount', 'price', 'price_paise', 'status', 'review_required', 'role', 'approved']
  },
  my_payments: { roles: ['learner', 'student', 'admin'], rateTier: 'standard' },
  list_available_slots: { roles: ['learner', 'student', 'instructor', 'admin'], rateTier: 'standard' },
  book_slot: {
    roles: ['learner', 'student'],
    rateTier: 'booking',
    forbiddenFields: ['instructor_id', 'credits_remaining', 'status', 'approved', 'role', 'price_paise']
  },
  cancel_booking: { roles: ['learner', 'student', 'instructor', 'admin'], rateTier: 'mutation' },
  my_recommendations: { roles: ['learner', 'student', 'instructor', 'admin'], rateTier: 'standard' },
  my_notifications: { roles: ['learner', 'student', 'instructor', 'admin'], rateTier: 'standard' },
  set_availability: {
    roles: ['instructor', 'admin'],
    requireApprovedInstructor: true,
    rateTier: 'mutation',
    forbiddenFields: ['approved', 'role', 'instructor_id']
  },
  mark_practical_done: {
    roles: ['instructor', 'admin'],
    requireApprovedInstructor: true,
    rateTier: 'mutation',
    forbiddenFields: ['role', 'override_time_check']
  },
  approve_instructor: { roles: ['admin'], rateTier: 'admin' },
  admin_mark_paid: { roles: ['admin'], rateTier: 'admin' },
  assign_instructor: { roles: ['admin'], rateTier: 'admin' },
  audit_overview: { roles: ['admin'], rateTier: 'admin' },
  confirm_payment_server: { roles: ['__service_role_only__'], internalOnly: true }
});

const XSS_PATTERNS = [
  /<\s*script\b/i,
  /javascript\s*:/i,
  /\bon(error|load|click|mouseover|focus|submit|animationstart)\s*=/i,
  /<\s*(iframe|object|embed|svg|math)\b/i
];

const SQLI_PATTERNS = [
  /(\bunion\b\s+\bselect\b)/i,
  /(\bdrop\b\s+\b(table|schema|database|function)\b)/i,
  /(;\s*(drop|delete|update|insert|alter|grant|revoke)\b)/i,
  /(\bor\b\s+['"]?\d+['"]?\s*=\s*['"]?\d+['"]?)/i,
  /(\bpg_sleep\s*\(|\bset_config\s*\(|\bdblink\b)/i
];

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function inspectPayloadTree(value, path = 'payload', depth = 0) {
  if (depth > 8) return { ok: false, code: 'WAF_MAX_DEPTH', message: `Payload nesting depth exceeded at ${path}` };
  if (value === null || value === undefined) return { ok: true };
  if (typeof value === 'string') {
    if (value.length > 4096) return { ok: false, code: 'WAF_FIELD_TOO_LARGE', message: `String field at ${path} exceeds 4096 chars` };
    for (const pattern of XSS_PATTERNS) {
      if (pattern.test(value)) return { ok: false, code: 'WAF_XSS_DETECTED', message: `Blocked XSS vector in ${path}` };
    }
    for (const pattern of SQLI_PATTERNS) {
      if (pattern.test(value)) return { ok: false, code: 'WAF_SQLI_DETECTED', message: `Blocked SQL injection signature in ${path}` };
    }
    return { ok: true };
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const res = inspectPayloadTree(value[i], `${path}[${i}]`, depth + 1);
      if (!res.ok) return res;
    }
    return { ok: true };
  }
  if (typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (DANGEROUS_KEYS.has(key)) return { ok: false, code: 'WAF_PROTOTYPE_POLLUTION', message: `Blocked prototype pollution key "${key}" at ${path}` };
      const res = inspectPayloadTree(value[key], `${path}.${key}`, depth + 1);
      if (!res.ok) return res;
    }
  }
  return { ok: true };
}

export function createFirewall(options = {}) {
  const config = {
    windowMs: options.windowMs ?? 60_000,
    limits: {
      auth: options.limits?.auth ?? 5,
      booking: options.limits?.booking ?? 6,
      mutation: options.limits?.mutation ?? 15,
      standard: options.limits?.standard ?? 60,
      admin: options.limits?.admin ?? 30
    },
    rules: {
      anonRpcBlock: true,
      rbacGuard: true,
      tamperGuard: true,
      xssFilter: true,
      sqliFilter: true,
      rateLimiter: true,
      hmacWebhookGuard: true,
      ...(options.rules || {})
    }
  };

  const buckets = new Map();
  const blockedIps = new Set(options.blockedIps || []);
  const processedWebhooks = new Set();

  function checkRateLimit(key, tier = 'standard', now = Date.now()) {
    if (!config.rules.rateLimiter) return { ok: true, remaining: 999 };
    const limit = config.limits[tier] ?? config.limits.standard;
    const bucketKey = `${tier}:${key}`;
    const timestamps = (buckets.get(bucketKey) || []).filter((ts) => now - ts < config.windowMs);
    if (timestamps.length >= limit) {
      buckets.set(bucketKey, timestamps);
      return { ok: false, status: 429, code: 'WAF_RATE_LIMIT_EXCEEDED', message: `Rate limit exceeded for ${tier} tier` };
    }
    timestamps.push(now);
    buckets.set(bucketKey, timestamps);
    return { ok: true, remaining: limit - timestamps.length };
  }

  function inspectRpc({ ip = '127.0.0.1', user = null, action, payload = {}, now = Date.now() }) {
    if (blockedIps.has(ip)) return { ok: false, status: 403, code: 'WAF_IP_BLOCKED', message: `IP ${ip} is blocked by DriveX WAF` };
    if (config.rules.anonRpcBlock && (!user || !user.id || !user.email || user.emailVerified !== true)) {
      return { ok: false, status: 401, code: 'WAF_ANON_RPC_DENIED', message: 'Anonymous or unverified caller cannot execute public.drivex(text, jsonb)' };
    }
    if (typeof action !== 'string' || !/^[a-z][a-z0-9_]{1,48}$/.test(action)) {
      return { ok: false, status: 400, code: 'WAF_INVALID_ACTION', message: 'Invalid RPC action identifier' };
    }
    const policy = ACTION_POLICY[action];
    if (!policy) return { ok: false, status: 403, code: 'WAF_UNKNOWN_ACTION', message: `Action "${action}" is not whitelisted in API_CONTRACT` };
    if (config.rules.rbacGuard && policy.internalOnly) {
      return { ok: false, status: 403, code: 'WAF_SERVICE_ROLE_ONLY', message: `Action "${action}" is restricted to verified server-side webhook execution` };
    }
    const callerRole = user?.role || 'learner';
    if (config.rules.rbacGuard && user?.role && !policy.roles.includes(callerRole)) {
      return { ok: false, status: 403, code: 'WAF_RBAC_VIOLATION', message: `Role "${callerRole}" is forbidden from executing "${action}"` };
    }
    if (config.rules.rbacGuard && policy.requireApprovedInstructor && callerRole === 'instructor' && user?.approved === false) {
      return { ok: false, status: 403, code: 'WAF_INSTRUCTOR_NOT_APPROVED', message: `Instructor account requires explicit admin approval before calling "${action}"` };
    }
    const rateRes = checkRateLimit(`${ip}:${user?.id || 'anon'}`, policy.rateTier, now);
    if (!rateRes.ok) return rateRes;
    if (config.rules.tamperGuard && payload && typeof payload === 'object') {
      const forbidden = new Set(['role', 'is_admin', 'price_paise', 'review_required', 'verified_uid', ...(policy.forbiddenFields || [])]);
      for (const key of Object.keys(payload)) {
        if (forbidden.has(key)) {
          return { ok: false, status: 422, code: 'WAF_TAMPER_ATTEMPT', message: `Client tampering blocked: field "${key}" cannot be supplied on "${action}"` };
        }
      }
    }
    if (config.rules.xssFilter || config.rules.sqliFilter) {
      const deepCheck = inspectPayloadTree(payload);
      if (!deepCheck.ok) return { ok: false, status: 403, ...deepCheck };
    }
    return { ok: true, status: 200, code: 'WAF_ALLOWED', message: 'Request passed all DriveX WAF checks' };
  }

  function verifyRazorpayWebhook({ rawBody, signature, secret, eventId }) {
    if (!config.rules.hmacWebhookGuard) return { ok: true, status: 200, code: 'WAF_WEBHOOK_BYPASSED' };
    if (!signature || typeof signature !== 'string' || !secret) {
      return { ok: false, status: 401, code: 'WAF_WEBHOOK_MISSING_SIGNATURE', message: 'Missing X-Razorpay-Signature header or webhook secret' };
    }
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const sigBuf = Buffer.from(signature, 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return { ok: false, status: 401, code: 'WAF_WEBHOOK_BAD_HMAC', message: 'Invalid X-Razorpay-Signature HMAC-SHA256 digest' };
    }
    if (eventId && processedWebhooks.has(eventId)) {
      return { ok: false, status: 409, code: 'WAF_WEBHOOK_REPLAY_BLOCKED', message: `Duplicate Razorpay webhook event "${eventId}" rejected` };
    }
    if (eventId) processedWebhooks.add(eventId);
    return { ok: true, status: 200, code: 'WAF_WEBHOOK_VERIFIED', message: 'Valid HMAC-SHA256 & unique eventId' };
  }

  return { config, checkRateLimit, inspectRpc, verifyRazorpayWebhook };
}
