import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './helpers/database.mjs';
import { createOrderHandler,webhookHandler } from '../supabase/functions/_shared/payments.mjs';
import { verifyWebhookSignature } from '../supabase/functions/_shared/crypto.mjs';
const enrollmentId='00000000-0000-0000-0000-000000000123';
const settings={SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'test-public',SUPABASE_SERVICE_ROLE_KEY:'test-service',RAZORPAY_KEY_ID:'rzp_test_fixture',RAZORPAY_KEY_SECRET:'fixture-private',RAZORPAY_WEBHOOK_SECRET:'fixture-webhook'};
const env=name=>settings[name];
const response=(data,status=200)=>new Response(JSON.stringify(data),{status});
const request=(body={enrollment_id:enrollmentId},headers={Authorization:'Bearer fixture-token'})=>new Request('https://test/functions/v1/create-order',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
async function sign(raw) {
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(settings.RAZORPAY_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(raw)))].map(b=>b.toString(16).padStart(2,'0')).join('');
}

test('create-order HTTP handler uses authoritative price, authenticates and binds real provider order',async t=>{
 const calls=[];
 const handler=createOrderHandler({env,fetcher:async(url,options)=>{
  calls.push([url,JSON.parse(options.body),options.headers]);
  if(url.endsWith('/drivex'))return response({enrollment_id:enrollmentId,amount_paise:150000,order_id:null});
  if(url.includes('razorpay.com'))return response({id:'order_real123',amount:150000,currency:'INR'});
  return response({order_id:'order_real123',amount:150000,currency:'INR'});
 }});
 await t.test('untrusted request amounts are ignored; server order is registered before returning',async()=>{
  const result=await handler(request({enrollment_id:enrollmentId,amount:1}));assert.equal(result.status,200);
  assert.deepEqual(await result.json(),{order_id:'order_real123',amount:150000,currency:'INR',key_id:settings.RAZORPAY_KEY_ID});
  assert.equal(calls[0][1].action,'get_checkout');assert.equal(calls[0][2].Authorization,'Bearer fixture-token');
  assert.equal(calls[1][1].amount,150000);assert.ok(calls[1][1].receipt.length<=40);
  assert.ok(calls[2][0].endsWith('/register_payment_order'));assert.equal(calls[2][2].Authorization,'Bearer test-service');
 });
 await t.test('auth, UUID, methods, configuration and live mode guard run before provider access',async()=>{
  assert.equal((await handler(request({},{}))).status,401);
  assert.equal((await handler(request({enrollment_id:'invalid'}))).status,400);
  assert.equal((await handler(new Request('https://test',{method:'GET'}))).status,405);
  const live=createOrderHandler({env:name=>name==='RAZORPAY_KEY_ID'?'rzp_live_fixture':env(name),fetcher:()=>{throw Error('must not call');}});
  assert.equal((await live(request())).status,503);
 });
 await t.test('ownership rejection never contacts the provider; stored orders are reused',async()=>{
  let count=0;
  const denied=createOrderHandler({env,fetcher:async()=>{count++;return response({message:'Enrollment not found.'},403);}});
  assert.equal((await denied(request())).status,403);assert.equal(count,1);
  count=0;const reuse=createOrderHandler({env,fetcher:async()=>{count++;return response({amount_paise:150000,order_id:'order_stored'});}});
  assert.equal((await (await reuse(request())).json()).order_id,'order_stored');assert.equal(count,1);
 });
 await t.test('malformed provider amount is rejected; no browser activation is attempted',async()=>{
  let count=0;const invalid=createOrderHandler({env,fetcher:async()=>{count++;return count===1?response({amount_paise:150000}):response({id:'order_bad',amount:1,currency:'INR'});}});
  assert.equal((await invalid(request())).status,502);assert.equal(count,2);
 });
});

test('webhook HTTP handler checks raw signature, event identity, currency, status and failure handling',async t=>{
 let calls=[];
 const handler=webhookHandler({env,fetcher:async(url,options)=>{calls.push([url,JSON.parse(options.body)]);return response({status:'success'});}});
 const event=(kind='payment.captured',changes={})=>({event:kind,payload:{payment:{entity:{id:'pay_fixture',order_id:'order_fixture',amount:150000,currency:'INR',status:kind==='payment.failed'?'failed':'captured',...changes}}}});
 async function deliver(body,{signature,eventId='event_fixture'}={}){const raw=typeof body==='string'?body:JSON.stringify(body);return handler(new Request('https://test',{method:'POST',headers:{'x-razorpay-signature':signature||await sign(raw),...(eventId?{'x-razorpay-event-id':eventId}:{})},body:raw}));}
 await t.test('valid raw-body signature is required, including content and exact digest shape',async()=>{
  const raw=JSON.stringify(event()),signature=await sign(raw);
  assert.equal(await verifyWebhookSignature(raw,signature,settings.RAZORPAY_WEBHOOK_SECRET),true);
  assert.equal(await verifyWebhookSignature(raw+' ',signature,settings.RAZORPAY_WEBHOOK_SECRET),false);
  assert.equal(await verifyWebhookSignature(raw,'x'.repeat(64),settings.RAZORPAY_WEBHOOK_SECRET),false);
  assert.equal((await deliver(event(),{signature:'0'.repeat(64)})).status,400);assert.equal(calls.length,0);
 });
 await t.test('provider event header is preserved; captured and failed events use the service-only RPC',async()=>{
  assert.equal((await deliver(event())).status,200);assert.equal(calls[0][1].p_event_id,'event_fixture');assert.equal(calls[0][1].p_status,'paid');
  assert.equal((await deliver(event('payment.failed'))).status,200);assert.equal(calls[1][1].p_status,'failed');
  assert.ok(calls[0][0].endsWith('/process_payment_event'));
 });
 await t.test('missing event ID, invalid currency, uncaptured status and malformed body are rejected',async()=>{
  const before=calls.length;
  for(const [body,options]of [[event(),{eventId:''}],[event('payment.captured',{currency:'USD'}),{}],[event('payment.captured',{status:'authorized'}),{}],['{',{}]])assert.equal((await deliver(body,options)).status,400);
  assert.equal(calls.length,before);
  assert.equal((await deliver({event:'refund.processed'})).status,200);
 });
});

test('real database order and webhook reconciliation with all migrations',async t=>{
 const {db,enroll,as,server}=await database();t.after(()=>db.close());
 const id=await enroll();
 await server('register_payment_order',[id,'order_database',150000]);
 const event=(status='paid',payment='pay_database',eventId='evt_database',amount=150000,currency='INR')=>server('process_payment_event',['order_database',payment,amount,currency,eventId,status]);
 await t.test('server rejects forged amount, null amount, wrong currency and unknown order',async()=>{
  await assert.rejects(event('paid','pay_database','evt_bad',1),/Invalid amount/);
  await assert.rejects(event('paid','pay_database','evt_bad',null),/Invalid amount/);
  await assert.rejects(event('paid','pay_database','evt_bad',150000,'USD'),/currency/);
  await assert.rejects(server('confirm_payment_server',['order_unknown','pay_database',150000,'evt_unknown']),/order not found/);
 });
 await t.test('failed event stays pending; later capture activates credits; older failures cannot undo payment',async()=>{
  await event('failed','pay_attempt','evt_failed');assert.equal((await as('student','my_payments'))[0].status,'failed');
  await event();assert.equal((await as('student','snapshot')).active_enrollment.credits_remaining,10);
  await event('failed','pay_attempt','evt_failed_late');assert.equal((await as('student','my_payments'))[0].status,'paid');
 });
 await t.test('exact replay and second success event are idempotent, altered replay/payment is rejected',async()=>{
  assert.equal((await event()).idempotent,true);assert.equal((await event('paid','pay_database','evt_order_paid')).idempotent,true);
  await assert.rejects(event('paid','pay_other','evt_database'),/already used/);
  await assert.rejects(event('paid','pay_other','evt_different'),/different payment/);
 });
 await t.test('webhook replay after refund never reactivates a finished plan',async()=>{
  await as('admin','admin_record_refund',{enrollment_id:id,reference:'actual_refund_database'});
  await event('paid','pay_database','evt_after_refund');assert.equal((await as('student','snapshot')).active_enrollment,null);
  assert.equal((await as('student','my_payments'))[0].status,'refunded');
 });
});
