import test from 'node:test';
import assert from 'node:assert/strict';
import {createFixtureServer} from './browser-server.mjs';
import {createApi} from '../dist/api.mjs';
import {loadWorkspace} from '../dist/workspace.mjs';
import {createMutationRunner} from '../dist/mutations.mjs';
import {nextLearnerAction,pendingPlanView} from '../dist/learner-state.mjs';
import {learnerOverview,plansView,bookView} from '../dist/portals/learner.mjs';
import {parseWorkingHours,availabilityView,notificationsView} from '../dist/scheduling.mjs';
import {ids} from './helpers/database.mjs';

test('HTTP portal integration covers pending purchase, scheduling, saved-write recovery and lesson lifecycle',async t=>{
 const fixture=await createFixtureServer();t.after(()=>fixture.close());
 for(const [path,type]of [['/sw.js','text/javascript'],['/manifest.webmanifest','application/manifest+json'],['/icons/icon-192.png','image/png']]){
  const response=await fetch(fixture.url+path);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),type);
 }
 assert.equal((await fetch(fixture.url+'/missing-module.mjs')).status,404);
 assert.equal((await fetch(fixture.url+'/functions/v1/unknown',{method:'POST',body:'{}'})).status,404);
 const api=()=>createApi({config:{supabaseUrl:fixture.url,publishableKey:'sb_publishable_fixture'},storage:null});
 const learner=api(),teacher=api(),admin=api(),other=api();
 for(const [client,user]of [[learner,'student'],[teacher,'instructor'],[admin,'admin'],[other,'other']])await client.login(user+'@example.test','fixture-password');
 let loaded=await loadWorkspace(learner.rpc);assert.equal(loaded.state.pending_enrollment,null);assert.equal(nextLearnerAction(loaded.state).page,'plans');
 const purchase=await learner.rpc('enroll',{plan_id:'plan_10_day',instructor_id:ids.instructor,amount_inr:1});
 loaded=await loadWorkspace(learner.rpc);const pending=loaded.state.pending_enrollment;
 assert.equal(pending.id,purchase.enrollment_id);assert.equal(pending.amount_inr,1500);assert.equal(pending.credits_total,10);assert.equal(pending.payment_status,'created');
 assert.equal(nextLearnerAction(loaded.state).page,'payments');assert.equal((await other.rpc('snapshot')).pending_enrollment,null);
 assert.ok(!Object.hasOwn(await teacher.rpc('snapshot'),'pending_enrollment'));
 assert.match(learnerOverview(loaded),/Continue payment/);assert.ok(!learnerOverview(loaded).includes('${esc('));
 assert.match(bookView({state:loaded.state}),/Finish your existing plan purchase/);
 const planHtml=plansView({state:loaded.state});assert.match(planHtml,/data-enroll="[^"]+" disabled/);
 assert.equal((await learner.rpc('enroll',{plan_id:'plan_10_day',instructor_id:ids.instructor})).enrollment_id,purchase.enrollment_id);
 await assert.rejects(learner.rpc('enroll',{plan_id:'plan_monthly',instructor_id:ids.instructor}),/unfinished|existing|active|pending/i);
 await fixture.withDatabase(async db=>{await db.exec('reset role');await db.query("update drivex_private.payments set status='failed' where enrollment_id=$1",[purchase.enrollment_id]);});
 assert.match(pendingPlanView(await learner.rpc('snapshot')),/attempt was marked failed/);
 await admin.rpc('admin_mark_paid',{enrollment_id:purchase.enrollment_id,reference:'school_portal_receipt'});
 loaded=await loadWorkspace(learner.rpc);assert.equal(loaded.state.pending_enrollment,null);assert.equal(nextLearnerAction(loaded.state).page,'book');
 const date=new Date(Date.now()+3*86400000).toISOString().slice(0,10),weekday=new Date(date+'T12:00:00+05:30').getUTCDay();
 const hours=parseWorkingHours(new Map([['day_'+weekday,'08:30-10:30']]));
 await teacher.rpc('set_working_hours',{hours});
 const teacherWorkspace=await loadWorkspace(teacher.rpc);assert.match(availabilityView(teacherWorkspace),/08:30-10:30/);
 assert.deepEqual((await learner.rpc('availability',{date,vehicle:fixture.vehicle})).map(slot=>slot.time),['08:30','09:30']);
 let failRefresh=true,writes=0,current=loaded;
 const runner=createMutationRunner({refresh:async()=>{if(failRefresh)throw Error('read connection lost');current=await loadWorkspace(learner.rpc);}});
 const reserve=()=>{writes++;return learner.rpc('reserve',{date,time:'08:30',vehicle:fixture.vehicle});};
 const saved=await runner.run(reserve);assert.equal(saved.status,'saved_refresh_failed');assert.equal((await runner.run(reserve)).status,'blocked');assert.equal(writes,1);
 assert.equal((await teacher.rpc('instructor_schedule')).length,1);
 failRefresh=false;assert.equal((await runner.reconcile()).status,'refreshed');assert.equal(current.state.bookings.length,1);assert.equal(current.state.active_enrollment.credits_remaining,10);assert.equal(current.state.active_enrollment.credits_reserved,1);
 await assert.rejects(teacher.rpc('set_blocked_date',{date,blocked:true}),/existing lesson/);
 await fixture.withDatabase(async db=>{await db.exec('reset role');await db.query("update drivex_private.bookings set starts_at=now()-interval '3 hours',ends_at=now()-interval '2 hours' where id=$1",[saved.value.id]);});
 await teacher.rpc('complete_booking',{booking:saved.value.id,score:4,notes:'More guided practice.'});
 current=await loadWorkspace(learner.rpc);assert.equal(current.state.active_enrollment.credits_remaining,9);assert.equal(current.recommendations.items[0].kind,'practical');
 const cancelled=await learner.rpc('reserve',{date,time:'09:30',vehicle:fixture.vehicle});
 await learner.rpc('cancel_booking',{booking:cancelled.id});
 current=await loadWorkspace(learner.rpc);assert.equal(current.state.active_enrollment.credits_remaining,9);assert.equal(current.state.active_enrollment.credits_reserved,0);
 assert.equal(current.state.bookings.find(booking=>booking.id===cancelled.id).status,'cancelled');
 assert.equal((await learner.rpc('availability',{date,vehicle:fixture.vehicle})).find(slot=>slot.time==='09:30').available,true);
 const notices=await admin.rpc('notification_status');assert.ok(notices.jobs.some(job=>job.event==='booking_cancelled'));assert.match(notificationsView(notices),/Lesson cancelled/);
 assert.equal((await teacher.rpc('instructor_overview')).learners_count,1);
 await fixture.withDatabase(async db=>{await db.exec('reset role');await db.query('update drivex_private.payments set review_required=true where enrollment_id=$1',[purchase.enrollment_id]);});
 assert.equal((await teacher.rpc('instructor_overview')).learners_count,0);
 await learner.rpc('snapshot');
 await assert.rejects(learner.rpc('instructor_overview'),/Instructor access/);
 await fixture.withDatabase(async db=>{await db.exec('reset role');await db.exec('set role authenticated');await assert.rejects(db.query("select drivex_private.dispatch_before_portal_integration('snapshot','{}')"),/permission denied/);});
});

test('learner views distinguish pending purchase, receipt review, reserved credits and empty fleet',()=>{
 const state={me:{name:'Learner'},bookings:[],vehicles:[],instructors:[],plans:[{id:'plan',name:'10-Day',price_inr:1500,lesson_credits:10}],active_enrollment:null};
 assert.match(plansView({state}),/data-enroll="plan" disabled/);
 state.pending_enrollment={plan_name:'<script>unsafe</script>',amount_inr:1500,instructor_name:'Teacher',payment_status:'created'};
 assert.ok(!pendingPlanView(state).includes('<script>'));assert.equal(nextLearnerAction(state).page,'payments');
 state.pending_enrollment=null;state.active_enrollment={review_required:true,credits_remaining:10,credits_reserved:0};
 assert.equal(nextLearnerAction(state).page,'payments');assert.match(bookView({state}),/Payment review required/);
 state.active_enrollment={credits_remaining:2,credits_reserved:2};assert.equal(nextLearnerAction(state).page,'lessons');assert.ok(!bookView({state}).includes('id="reserve"'));
 state.active_enrollment.credits_reserved=0;
 const html=bookView({state,draft:{date:'2026-11-15',vehicle:'',time:''},times:[]});assert.match(html,/No active training vehicles/);assert.match(html,/id="reserve" disabled/);
});

test('optional schedule/email outages show retries without blocking core portal data',async()=>{
 for(const role of ['instructor','admin']){
  const loaded=await loadWorkspace(async action=>{
   if(action==='snapshot')return {me:{role,approval_status:'approved'},instructors:[{id:'teacher'}]};
   if(['working_hours','notification_status'].includes(action))throw Error('unavailable');
   return [];
  });
  assert.equal(loaded.state.me.role,role);assert.equal(loaded.hours,null);assert.ok(loaded.unavailableFeatures.includes('working_hours'));
  const hoursHtml=availabilityView({...loaded,unavailable:true});assert.match(hoursHtml,/Schedule unavailable/);assert.match(hoursHtml,/Retry schedule/);assert.ok(!hoursHtml.includes('Add an instructor first'));
  if(role==='admin'){assert.equal(loaded.notices,null);assert.match(notificationsView(loaded.notices),/Retry email status/);}
 }
});
