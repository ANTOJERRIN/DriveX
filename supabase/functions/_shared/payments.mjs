import { verifyWebhookSignature } from './crypto.mjs';

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', ...headers },
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function rpc(fetcher, env, name, body, authorization) {
  const service = name !== 'drivex';
  const key = env(service ? 'SUPABASE_SERVICE_ROLE_KEY' : 'SUPABASE_ANON_KEY');
  if (!key || !env('SUPABASE_URL')) throw Error('Payment service configuration is incomplete.');
  const response = await fetcher(`${env('SUPABASE_URL')}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { apikey: key, Authorization: service ? `Bearer ${key}` : authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = Error(data?.message || 'Payment service request failed.');
    error.status = service ? 503 : (response.status === 401 || response.status === 403 ? 403 : 409);
    throw error;
  }
  return data;
}

export function createOrderHandler({ env, fetcher = fetch, callRpc = (name, body, authorization) => rpc(fetcher, env, name, body, authorization) }) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  return async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, cors);
    try {
      const authorization = req.headers.get('Authorization') || '';
      if (!/^Bearer \S+$/.test(authorization)) return json({ error: 'Please sign in.' }, 401, cors);
      let body;
      try { body = await req.json(); } catch { return json({ error: 'Invalid JSON.' }, 400, cors); }
      if (!uuid.test(body?.enrollment_id || '')) return json({ error: 'A valid enrollment_id is required.' }, 400, cors);
      const key = env('RAZORPAY_KEY_ID') || '';
      if (!/^rzp_(test|live)_[A-Za-z0-9]+$/.test(key) || !env('RAZORPAY_KEY_SECRET')) return json({ error: 'Online payments are not configured. Contact the school.' }, 503, cors);
      if (key.startsWith('rzp_live_') && env('RAZORPAY_ALLOW_LIVE') !== 'true') return json({ error: 'Live payments are disabled.' }, 503, cors);
      const details = await callRpc('drivex', { action: 'get_checkout', payload: { enrollment_id: body.enrollment_id } }, authorization);
      if (details.order_id) return json({ order_id: details.order_id, amount: details.amount_paise, currency: 'INR', key_id: key }, 200, cors);
      const response = await fetcher('https://api.razorpay.com/v1/orders', {
        method: 'POST', headers: { Authorization: `Basic ${btoa(`${key}:${env('RAZORPAY_KEY_SECRET')}`)}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: details.amount_paise, currency: 'INR', receipt: `dx_${body.enrollment_id.replaceAll('-', '')}`, notes: { enrollment_id: body.enrollment_id } }),
      });
      if (!response.ok) return json({ error: 'Payment provider could not create an order. Try again later.' }, 502, cors);
      const order = await response.json();
      if (order.amount !== details.amount_paise || order.currency !== 'INR' || !/^order_[A-Za-z0-9]+$/.test(order.id || '')) return json({ error: 'Invalid payment provider order.' }, 502, cors);
      const stored = await callRpc('register_payment_order', { p_enrollment_id: body.enrollment_id, p_order_id: order.id, p_amount_paise: order.amount });
      return json({ ...stored, key_id: key }, 200, cors);
    } catch (error) {
      return json({ error: error.status ? error.message : 'Payment service is unavailable. Try again later.' }, error.status || 503, cors);
    }
  };
}

export function webhookHandler({ env, fetcher = fetch, callRpc = (name, body) => rpc(fetcher, env, name, body) }) {
  return async (req) => {
    if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
    try {
      if (!env('RAZORPAY_WEBHOOK_SECRET')) return json({ error: 'Webhook is not configured.' }, 503);
      const raw = await req.text();
      if (!(await verifyWebhookSignature(raw, req.headers.get('x-razorpay-signature'), env('RAZORPAY_WEBHOOK_SECRET')))) return json({ error: 'Invalid signature.' }, 400);
      let body;
      try { body = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON.' }, 400); }
      if (!['payment.captured', 'order.paid', 'payment.failed'].includes(body.event)) return json({ status: 'ignored' });
      const eventId = req.headers.get('x-razorpay-event-id');
      const payment = body.payload?.payment?.entity;
      if (!eventId || !/^pay_[A-Za-z0-9]+$/.test(payment?.id || '') || !/^order_[A-Za-z0-9]+$/.test(payment?.order_id || '') || !Number.isSafeInteger(payment?.amount) || payment.amount <= 0 || payment.currency !== 'INR') return json({ error: 'Invalid payment event.' }, 400);
      const failed = body.event === 'payment.failed';
      if (failed ? payment.status !== 'failed' : payment.status !== 'captured') return json({ error: 'Unexpected payment state.' }, 400);
      const result = await callRpc('process_payment_event', {
        p_order_id: payment.order_id, p_payment_id: payment.id, p_amount_paise: payment.amount,
        p_currency: payment.currency, p_event_id: eventId, p_status: failed ? 'failed' : 'paid',
      });
      return json({ status: 'success', result });
    } catch {
      return json({ error: 'Payment reconciliation is unavailable. Retry delivery.' }, 503);
    }
  };
}
