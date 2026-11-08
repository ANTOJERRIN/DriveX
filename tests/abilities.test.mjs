import test from 'node:test';
import assert from 'node:assert/strict';
import { database,ids } from './helpers/database.mjs';
import { notificationWorker,notificationMessage } from '../supabase/functions/_shared/notifications.mjs';
const future=days=>new Date(Date.now()+days*86400000).toISOString().slice(0,10);

test('weekly instructor hours and blocked dates govern real availability and reservations',async t=>{
 const {db,as,paid,vehicle}=await database();t.after(()=>db.close());
 const day=future(3),weekday=new Date(day+'T12:00:00Z').getUTCDay();
 await paid();await paid('other');
 assert.equal((await as('student','availability',{date:day,vehicle})).length,8);
 await t.test('only approved instructor for self or admin can edit; defaults preserve daily slots',async()=>{
  assert.equal((await as('instructor','working_hours')).hours.length,14);
  await assert.rejects(as('student','working_hours'),/Instructor or admin access/);
  await assert.rejects(as('pending','working_hours'),/approval required/);
  await assert.rejects(as('instructor2','set_working_hours',{instructor_id:ids.instructor,hours:[]}),/another instructor/);
  await assert.rejects(db.query("select drivex_private.dispatch_before_availability('reserve','{}')"),/permission denied/);
  await as('instructor','set_working_hours',{hours:[{weekday,start:'08:30',end:'11:30'}]});
  assert.deepEqual((await as('student','availability',{date:day,vehicle})).map(x=>x.time),['08:30','09:30','10:30']);
 });
 await t.test('out-of-hours, overlap and past-date rejections remain authoritative',async()=>{
  await assert.rejects(as('student','reserve',{date:day,time:'12:30',vehicle}),/working hours/);
  await assert.rejects(as('student','reserve',{date:'2020-01-01',time:'08:30',vehicle}),/future lesson/);
  await assert.rejects(as('instructor','set_working_hours',{hours:[{weekday,start:'08:00',end:'10:00'},{weekday,start:'09:00',end:'11:00'}]}),/cannot overlap/);
  await assert.rejects(as('instructor','set_working_hours',{hours:[{weekday,start:'08:15',end:'10:15'}]}),/half-hour boundaries/);
  await assert.rejects(as('instructor','set_working_hours',{hours:[{weekday,start:'08:30',end:'09:00'}]}),/at least one hour/);
  await as('student','reserve',{date:day,time:'08:30',vehicle});
  await assert.rejects(as('other','reserve',{date:day,time:'08:30',vehicle}),/slot was just reserved/);
 });
 await t.test('schedule edits cannot invalidate existing lessons and failed edits roll back',async()=>{
  await assert.rejects(as('instructor','set_working_hours',{hours:[]}),/conflict with an existing lesson/);
  assert.equal((await as('instructor','working_hours')).hours.length,1);
  await assert.rejects(as('admin','set_blocked_date',{instructor_id:ids.instructor,date:day,blocked:true}),/existing lesson/);
  const blocked=future(4);
  await as('instructor','set_blocked_date',{date:blocked,blocked:true,reason:'Private appointment'});
  await assert.rejects(as('other','availability',{date:blocked,vehicle}),/blocked this date/);
  await assert.rejects(as('other','reserve',{date:blocked,time:'08:30',vehicle}),/blocked this date/);
  await as('admin','set_blocked_date',{instructor_id:ids.instructor,date:blocked,blocked:false});
  assert.equal((await as('instructor','working_hours')).blocked_dates.length,0);
 });
});

test('notification queue is private, leased, deduplicated and bounded by retry limits',async t=>{
 const {db,as,paid,server,vehicle}=await database();t.after(()=>db.close());
 const enrollment=await paid();
 const booking=await as('student','reserve',{date:future(3),time:'10:00',vehicle});
 let first;
 await t.test('booking produces two immediate emails and two future reminders; only service can claim',async()=>{
  await assert.rejects(db.query("select public.drivex_notification_jobs('claim','{}')"),/permission denied/);
  await assert.rejects(as('student','notification_status'),/Admin access/);
  const status=await as('admin','notification_status');assert.equal(status.counts.pending,4);assert.equal(status.counts.due,2);
  assert.ok(!JSON.stringify(status).includes('@example.test'));
  const jobs=await server('drivex_notification_jobs',['claim','{}']);assert.equal(jobs.length,2);first=jobs[0];
  assert.equal(jobs[0].delivery.time,'10:00');assert.match(jobs[0].delivery.to,/@example.test$/);
  assert.equal((await server('drivex_notification_jobs',['claim','{}'])).length,0);
  await server('drivex_notification_jobs',['finish',JSON.stringify({id:first.id,claim_token:first.claim_token,success:true,provider_id:'receipt-mail'})]);
 });
 await t.test('cancellation suppresses queued reminders, creates one email per recipient and stale leases cannot finish',async()=>{
  await as('student','cancel_booking',{booking:booking.id});
  const status=await as('admin','notification_status');assert.equal(status.counts.pending,2);
  const cancelled=await server('drivex_notification_jobs',['claim','{}']);assert.equal(cancelled.length,2);assert.ok(cancelled.every(j=>j.delivery.event==='booking_cancelled'));
  assert.equal((await server('drivex_notification_jobs',['finish',JSON.stringify({id:first.id,claim_token:first.claim_token,success:true,provider_id:'duplicate'})])).status,'stale');
  first=cancelled[0];
  await server('drivex_notification_jobs',['finish',JSON.stringify({id:cancelled[1].id,claim_token:cancelled[1].claim_token,success:true,provider_id:'mail-other'})]);
 });
 await t.test('five failures stop automatic retry; admin retry is explicit; provider payload stays stable',async()=>{
  const delivery=first.delivery;
  for(let attempt=1;attempt<=5;attempt++){
   const result=await server('drivex_notification_jobs',['finish',JSON.stringify({id:first.id,claim_token:first.claim_token,success:false,error:'network_error'})]);
   assert.equal(result.status,attempt===5?'dead':'pending');
   await db.exec('reset role');await db.query("update drivex_private.notification_jobs set next_attempt_at=now()-interval '1 minute' where id=$1",[first.id]);
   const claimed=await server('drivex_notification_jobs',['claim','{}']);
   if(attempt<5){assert.equal(claimed.length,1);first=claimed[0];assert.deepEqual(first.delivery,delivery);}else assert.equal(claimed.length,0);
  }
  assert.equal((await as('admin','notification_status')).counts.failed,1);
  await assert.rejects(as('student','retry_notification',{id:first.id}),/Admin access/);
  await as('admin','retry_notification',{id:first.id});
  assert.equal((await server('drivex_notification_jobs',['claim','{}'])).length,1);
 });
 await t.test('an abandoned fifth processing lease is stopped rather than left processing forever',async()=>{
  await db.exec('reset role');await db.query("update drivex_private.notification_jobs set attempts=5,lease_until=now()-interval '1 minute' where id=$1",[first.id]);
  assert.equal((await server('drivex_notification_jobs',['claim','{}'])).length,0);
  assert.equal((await as('admin','notification_status')).counts.failed,1);
 });
 await t.test('actual full refund queues one learner notice; cron reports unavailable configuration honestly',async()=>{
  await as('admin','admin_record_refund',{enrollment_id:enrollment,reference:'returned-payment'});
  const jobs=await server('drivex_notification_jobs',['claim','{}']);assert.equal(jobs.filter(j=>j.delivery.event==='refund_recorded').length,1);
  await db.exec('reset role');const cron=(await db.query('select drivex_private.run_notification_schedule() as result')).rows[0].result;
  assert.equal(cron.configured,false);
 });
 await t.test('scheduler rejects incomplete Vault setup and uses only the dedicated worker endpoint',async()=>{
  await db.exec(`reset role; create schema vault; create table vault.decrypted_secrets(name text,decrypted_secret text);
   create schema cron; create table cron.job(jobname text);insert into cron.job values('drivex-notifications');
   create schema net;create table net.request_checks(endpoint text,timeout_ms integer);
   create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$begin
    if length(headers->>'Authorization')<39 then raise exception 'Missing worker token';end if;
    insert into net.request_checks values(url,timeout_milliseconds);return 42;end;$$;`);
  await db.query('insert into vault.decrypted_secrets values($1,$2),($3,$4)',['drivex_notification_url','http://localhost/private','drivex_notification_token','fixture-'.repeat(8)]);
  let result=(await db.query('select drivex_private.run_notification_schedule() as result')).rows[0].result;assert.equal(result.configured,false);
  await db.query("update vault.decrypted_secrets set decrypted_secret='https://fixture.supabase.co/functions/v1/notification-worker' where name='drivex_notification_url'");
  result=(await db.query('select drivex_private.run_notification_schedule() as result')).rows[0].result;assert.equal(result.configured,true);assert.equal(result.request_id,42);
  assert.equal((await db.query('select count(*) as count from net.request_checks')).rows[0].count,1);
  assert.equal((await as('admin','notification_status')).scheduler.worker_configured,true);
 });
});

test('notification HTTP worker authenticates, sends deterministic messages and stores only sanitized errors',async t=>{
 const token='fixture-'.repeat(8),settings={NOTIFICATION_WORKER_TOKEN:token,SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-service',RESEND_API_KEY:'fixture-mail-key',RESEND_FROM:'DriveX <school@example.test>'};
 const env=name=>settings[name];
 const job={id:'10000000-0000-0000-0000-000000000001',claim_token:'20000000-0000-0000-0000-000000000001',delivery:{event:'booking_confirmed',to:'learner@example.test',name:'Learner',date:'10 Nov 2026',time:'10:00',instructor_name:'Instructor',vehicle_name:'School car'}};
 let outcome,mail,providerStatus=200,calls=0;
 const worker=notificationWorker({env,fetcher:async(url,options)=>{
  calls++;
  if(url.includes('/rpc/')){const body=JSON.parse(options.body);if(body.action==='claim')return new Response(JSON.stringify([job]));outcome=body.payload;return new Response(JSON.stringify({status:body.payload.success?'sent':body.payload.permanent?'dead':'pending'}));}
  mail={headers:options.headers,body:JSON.parse(options.body)};return new Response(JSON.stringify(providerStatus===200?{id:'mail-receipt'}:{message:'Personal provider error learner@example.test'}),{status:providerStatus});
 }});
 const request=authorization=>new Request('https://fixture',{method:'POST',headers:{Authorization:authorization}});
 await t.test('wrong caller and missing provider settings leave the queue untouched',async()=>{
  assert.equal((await worker(request('Bearer invalid'))).status,401);assert.equal(calls,0);
  const missing=notificationWorker({env:name=>name==='RESEND_API_KEY'?'':env(name),fetcher:()=>{throw Error('must not claim');}});
  assert.equal((await missing(request('Bearer '+token))).status,503);
 });
 await t.test('successful delivery uses stable idempotency key, plain text and provider receipt',async()=>{
  const response=await worker(request('Bearer '+token));assert.equal(response.status,200);assert.equal((await response.json()).sent,1);
  assert.equal(mail.headers['Idempotency-Key'],'drivex-'+job.id);assert.ok(mail.body.text.includes('10:00 IST'));assert.equal(mail.body.html,undefined);assert.equal(outcome.provider_id,'mail-receipt');
  assert.match(notificationMessage({event:'refund_recorded',name:'Learner',amount_inr:1500}).text,/1,500/);
  assert.match(notificationMessage({...job.delivery,event:'booking_cancelled',cancellation_pending:true}).text,/cancellation was requested/);
 });
 await t.test('throttling retries; permanent errors stop; provider text never reaches queue or response',async()=>{
  providerStatus=429;let result=await (await worker(request('Bearer '+token))).json();assert.equal(result.retried,1);assert.equal(outcome.error,'provider_throttled');
  providerStatus=400;result=await (await worker(request('Bearer '+token))).json();assert.equal(result.failed,1);assert.equal(outcome.error,'invalid_recipient');assert.equal(outcome.permanent,true);
  assert.ok(!JSON.stringify(outcome).includes('@'));assert.ok(!JSON.stringify(result).includes('@'));
 });
});
