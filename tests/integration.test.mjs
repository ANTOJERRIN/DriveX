import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../dist/api.mjs';
import { createFixtureServer } from './browser-server.mjs';
import { ids } from './helpers/database.mjs';
import { waitForPayment } from '../dist/checkout.mjs';
import { notificationWorker } from '../supabase/functions/_shared/notifications.mjs';

test('HTTP integration: real client → order/webhook handlers → dispatcher → database → learner/instructor',async t=>{
 const fixture=await createFixtureServer();t.after(()=>fixture.close());
 const client=()=>createApi({config:{supabaseUrl:fixture.url,publishableKey:'sb_publishable_fixture'},storage:null,location:{origin:fixture.url,pathname:'/',hash:''}});
 const learner=client(),instructor=client(),other=client(),pending=client();
 await learner.login('student@example.test','fixture-password');
 await instructor.login('instructor@example.test','fixture-password');
 await other.login('other@example.test','fixture-password');
 await pending.login('pending@example.test','fixture-password');
 assert.deepEqual(Object.keys(await pending.rpc('snapshot')),['me']);
 await assert.rejects(pending.rpc('instructor_learners'),/approval required/);
 const enrollment=await learner.rpc('enroll',{plan_id:'plan_10_day',instructor_id:ids.instructor,amount:1});
 await assert.rejects(other.invokeFunction('create-order',{enrollment_id:enrollment.enrollment_id}),/Enrollment not found/);
 const order=await learner.invokeFunction('create-order',{enrollment_id:enrollment.enrollment_id,amount:1});
 assert.equal(order.amount,150000);assert.equal(order.currency,'INR');
 assert.equal((await learner.invokeFunction('create-order',{enrollment_id:enrollment.enrollment_id})).order_id,order.order_id);
 assert.equal((await learner.rpc('snapshot')).active_enrollment,null);
 const body=JSON.stringify({event:'payment.captured',payload:{payment:{entity:{id:'pay_integration',order_id:order.order_id,amount:order.amount,currency:'INR',status:'captured'}}}});
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('fixture-webhook'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=[...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body)))].map(b=>b.toString(16).padStart(2,'0')).join('');
 for(let replay=0;replay<2;replay++) {
  const result=await fetch(fixture.url+'/functions/v1/razorpay-webhook',{method:'POST',headers:{'x-razorpay-event-id':'event_integration','x-razorpay-signature':signature},body});
  assert.equal(result.status,200,await result.text());
 }
 assert.equal((await waitForPayment(enrollment.enrollment_id,{rpc:learner.rpc,delay:async()=>{}})).status,'paid');
 assert.equal((await learner.rpc('snapshot')).active_enrollment.credits_remaining,10);
 const date=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
 assert.equal((await learner.rpc('availability',{date,vehicle:fixture.vehicle})).filter(x=>x.available).length,8);
 const lesson=await learner.rpc('reserve',{date,time:'10:00',vehicle:fixture.vehicle,instructor:ids.instructor2});
 const teacherSchedule=await instructor.rpc('instructor_schedule');assert.equal(teacherSchedule[0].id,lesson.id);
 const token='fixture-'.repeat(8),settings={NOTIFICATION_WORKER_TOKEN:token,SUPABASE_URL:fixture.url,SUPABASE_SERVICE_ROLE_KEY:'test-service',RESEND_API_KEY:'fixture-mail-key',RESEND_FROM:'school@example.test'};
 let emails=0;
 const worker=notificationWorker({env:name=>settings[name],fetcher:async(url,options)=>{
  if(url==='https://api.resend.com/emails'){emails++;return new Response(JSON.stringify({id:'mail-'+emails}));}
  assert.ok(url.startsWith(fixture.url+'/'));return fetch(url,options);
 }});
 assert.equal((await (await worker(new Request(fixture.url,{method:'POST',headers:{Authorization:'Bearer '+token}}))).json()).sent,2);
 assert.equal(emails,2);
 assert.equal((await other.rpc('snapshot')).bookings.length,0);
 await fixture.withDatabase(async db=>{await db.exec('reset role');await db.query("update drivex_private.bookings set starts_at=now()-interval '3 hours',ends_at=now()-interval '2 hours' where id=$1",[lesson.id]);});
 await instructor.rpc('complete_booking',{booking:lesson.id,score:8,notes:'Steering improved.'});
 const snapshot=await learner.rpc('snapshot');assert.equal(snapshot.active_enrollment.credits_remaining,9);assert.equal(snapshot.bookings[0].notes,'Steering improved.');
 await fixture.withDatabase(async db=>{await db.exec('reset role');assert.equal((await db.query("select count(*) as count from drivex_private.notification_jobs where status='pending'")).rows[0].count,0);});
 const practical=(await learner.rpc('my_lessons')).find(l=>l.kind==='practical');
 await instructor.rpc('mark_practical_done',{learner_id:ids.student,lesson_id:practical.id});
 assert.equal((await learner.rpc('my_lessons')).find(l=>l.id===practical.id).completed,true);
 await learner.logout();assert.equal(learner.signedIn(),false);await assert.rejects(learner.rpc('snapshot'),/Please sign in/);
});
