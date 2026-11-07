import test from 'node:test';
import assert from 'node:assert/strict';
import { database,ids } from './helpers/database.mjs';
import { readFile } from 'node:fs/promises';
const future=(days=3)=>new Date(Date.now()+days*86400000).toISOString().slice(0,10);

test('DriveX full plan lifecycle and authorization with every migration',async t=>{
 const h=await database(),{db,as,paid,enroll,vehicle}=h;t.after(()=>db.close());
 let enrollment,booking;
 await t.test('all migrations load, prices are server controlled and sample fleet stays inactive',async()=>{
  assert.equal(h.migrations.length,8);
  const plans=await as('student','plans_list');assert.deepEqual(plans.map(p=>[p.price_inr,p.lesson_credits]),[[1500,10],[4000,30]]);
  const snap=await as('student','snapshot');assert.equal(snap.bookings.length,0);assert.equal(snap.vehicles.length,1);assert.equal(snap.vehicles[0].id,vehicle);
  await db.exec('reset role');
  for(const file of ['preflight.sql','verify.sql']) {
   const checks=(await db.query(await readFile(new URL('../supabase/'+file,import.meta.url),'utf8'))).rows;
   assert.ok(checks.every(check=>check.ok),JSON.stringify(checks.filter(check=>!check.ok)));
  }
 });
 await t.test('signup only requests an instructor role; pending and rejected users get no portal data',async()=>{
  const pending=await as('pending','snapshot');assert.equal(pending.me.approval_status,'pending');assert.deepEqual(Object.keys(pending),['me']);
  await assert.rejects(as('pending','instructor_learners'),/approval required/);
  await as('admin','admin_set_instructor_status',{instructor_id:ids.pending,status:'rejected'});
  await assert.rejects(as('pending','instructor_schedule'),/approval required/);
  await as('admin','admin_set_instructor_status',{instructor_id:ids.pending,status:'approved'});
  assert.equal((await as('pending','snapshot')).me.approval_status,'approved');
 });
 await t.test('metadata edits and browser role/payment switches cannot grant privileges',async()=>{
  const requestedAdmin='10000000-0000-0000-0000-000000000001';
  await db.exec('reset role');await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[requestedAdmin,'role-request@example.test',JSON.stringify({name:'Role request',role:'admin'})]);
  assert.equal((await as(requestedAdmin,'me')).me.role,'student');
  await db.exec('reset role');await db.query("update auth.users set raw_user_meta_data=raw_user_meta_data||'{\"role\":\"admin\"}' where id=$1",[ids.other]);
  assert.equal((await as('other','me')).me.role,'student');
  for(const action of ['set_my_role','pay_enrollment','confirm_payment','confirm_online_payment'])await assert.rejects(as('other',action,{role:'instructor'}),/only be changed by the server/);
  await assert.rejects(as('student','admin_overview'),/Admin access required/);
  await assert.rejects(as('student','instructor_earnings'),/Instructor access required/);
 });
 await t.test('pending instructors cannot receive enrollments; learner cannot approve them',async()=>{
  await as('admin','admin_set_instructor_status',{instructor_id:ids.pending,status:'rejected'});
  await assert.rejects(as('student','enroll',{plan_id:'plan_10_day',instructor_id:ids.pending}),/Instructor not available/);
  await assert.rejects(as('student','admin_set_instructor_status',{instructor_id:ids.pending,status:'approved'}),/Admin access required/);
 });
 await t.test('enrollment is idempotent, ignores spoofed prices and cannot book before payment',async()=>{
  const result=await as('student','enroll',{plan_id:'plan_10_day',instructor_id:ids.instructor,amount_paise:1,credits_total:999,status:'active'});
  enrollment=result.enrollment_id;assert.equal(result.amount_paise,150000);assert.equal(result.status,'pending_payment');
  assert.equal(await enroll(),enrollment);
  await assert.rejects(as('student','reserve',{date:future(),time:'10:00',vehicle}),/active plan required/);
  await assert.rejects(as('other','get_checkout',{enrollment_id:enrollment}),/Enrollment not found/);
  await assert.rejects(as('student','admin_mark_paid',{enrollment_id:enrollment,reference:'fake'}),/Admin access required/);
 });
 await t.test('actual admin receipt activates credits once, and replay does not reset them',async()=>{
  await assert.rejects(as('admin','admin_mark_paid',{enrollment_id:enrollment}),/actual receipt/);
  await as('admin','admin_mark_paid',{enrollment_id:enrollment,reference:'school_receipt_1'});
  assert.equal((await as('student','snapshot')).active_enrollment.credits_remaining,10);
  assert.equal((await as('admin','admin_mark_paid',{enrollment_id:enrollment,reference:'school_receipt_1'})).idempotent,true);
 });
 await t.test('booking uses assigned instructor, has no lesson price and leaves credits unspent',async()=>{
  const available=await as('student','availability',{date:future(),vehicle,instructor:ids.instructor2});assert.equal(available.length,8);
  const result=await as('student','reserve',{date:future(),time:'10:00',vehicle,instructor:ids.instructor2});booking=result.id;
  const snap=await as('student','snapshot');assert.equal(snap.active_enrollment.credits_remaining,10);assert.equal(snap.active_enrollment.credits_reserved,1);assert.equal(snap.bookings[0].instructor,ids.instructor);
  const dashboard=await as('student','dashboard');assert.equal(dashboard.next_confirmed_lesson.id,booking);assert.equal(dashboard.recent_lessons[0].id,booking);
  await db.exec('reset role');assert.equal((await db.query('select amount_paise from drivex_private.bookings where id=$1',[booking])).rows[0].amount_paise,0);
 });
 await t.test('a funded second learner sees taken slot and real instructor/vehicle exclusion is exercised',async()=>{
  await paid('other');
  assert.equal((await as('other','availability',{date:future(),vehicle})).find(x=>x.time==='10:00').available,false);
  await assert.rejects(as('other','reserve',{date:future(),time:'10:00',vehicle}),/slot was just reserved/);
  await assert.rejects(as('student','reserve',{date:future(),time:'13:00',vehicle}),/valid lesson time/);
  await assert.rejects(as('student','reserve',{date:'2020-01-01',time:'10:00',vehicle}),/future lesson/);
 });
 await t.test('row privacy, anonymous denial, private tables and service RPCs remain protected',async()=>{
  assert.equal((await as('other','snapshot')).bookings.length,0);
  assert.equal((await as('instructor2','snapshot')).bookings.length,0);
  await assert.rejects(as('other','cancel_booking',{booking}),/Cannot cancel/);
  await assert.rejects(as('student','instructor_learners'),/Instructor access/);
  await assert.rejects(db.query('select * from drivex_private.payments'),/permission denied/);
  await assert.rejects(db.query("select public.confirm_payment_server('x','y',1,'z')"),/permission denied/);
  await assert.rejects(db.query("select public.register_payment_order($1,'order_fake',150000)",[enrollment]),/permission denied/);
  await assert.rejects(db.query("select public.process_payment_event('a','b',1,'INR','c','paid')"),/permission denied/);
  await assert.rejects(as(null,'snapshot'),/permission denied/);
 });
 await t.test('only assigned instructor assesses after end with valid feedback; completion is idempotent',async()=>{
  await assert.rejects(as('instructor','complete_booking',{booking,score:9,notes:'Test'}),/after lesson ends/);
  await db.exec('reset role');await db.query("update drivex_private.bookings set starts_at=now()-interval '3 hours',ends_at=now()-interval '2 hours' where id=$1",[booking]);
  await assert.rejects(as('instructor2','complete_booking',{booking,score:9,notes:'Test'}),/assigned instructor/);
  await assert.rejects(as('instructor','complete_booking',{booking,score:0,notes:''}),/score from 1 to 10/);
  await as('instructor','complete_booking',{booking,score:9,notes:'Good steering.'});
  await as('instructor','complete_booking',{booking,score:9,notes:'Good steering.'});
  assert.equal((await as('student','snapshot')).active_enrollment.credits_remaining,9);
 });
 await t.test('second completion reaches 8 credits, not a browser counter',async()=>{
  const second=await as('student','reserve',{date:future(4),time:'10:00',vehicle});
  await db.exec('reset role');await db.query("update drivex_private.bookings set starts_at=now()-interval '5 hours',ends_at=now()-interval '4 hours' where id=$1",[second.id]);
  await as('instructor','assess',{booking:second.id,score:8,notes:'Practice parking.'});
  const snap=await as('student','snapshot');assert.equal(snap.active_enrollment.credits_remaining,8);assert.equal((await as('student','dashboard')).completed_count,2);
 });
 await t.test('credit reservations prevent overspending, and cancellation releases a reserved credit',async()=>{
  const reservations=[];
  for(let i=0;i<8;i++)reservations.push((await as('student','reserve',{date:future(10+i),time:'10:00',vehicle})).id);
  await assert.rejects(as('student','reserve',{date:future(25),time:'10:00',vehicle}),/All remaining credits are reserved/);
  await as('student','cancel_booking',{booking:reservations[0]});
  await as('student','reserve',{date:future(25),time:'10:00',vehicle});
  assert.equal((await as('student','snapshot')).active_enrollment.credits_remaining,8);
  await assert.rejects(enroll('student','instructor','plan_monthly'),/Finish your active plan/);
 });
 await t.test('theory progress is idempotent; practical requires assigned instructor and kind',async()=>{
  const lessons=await as('student','my_lessons'),theory=lessons.find(l=>l.kind==='theory'),practical=lessons.find(l=>l.kind==='practical');
  assert.equal(lessons.length,13);
  await as('student','mark_theory_done',{lesson_id:theory.id});await as('student','mark_theory_done',{lesson_id:theory.id});
  await assert.rejects(as('student','mark_practical_done',{learner_id:ids.student,lesson_id:practical.id}),/Only instructor/);
  await assert.rejects(as('instructor2','mark_practical_done',{learner_id:ids.student,lesson_id:practical.id}),/not assigned/);
  await as('instructor','mark_practical_done',{learner_id:ids.student,lesson_id:practical.id});
  assert.equal((await as('student','my_lessons')).filter(l=>l.completed).length,2);
  assert.equal((await as('instructor2','instructor_learners')).length,0);
  assert.equal((await as('instructor2','instructor_earnings')).length,0);
  assert.equal((await as('instructor','instructor_earnings')).length,2);
 });
 await t.test('school resources accept safe YouTube URLs; learners cannot edit them',async()=>{
  const theory=(await as('admin','admin_lessons')).find(l=>l.kind==='theory');
  await assert.rejects(as('student','admin_update_lesson',{lesson_id:theory.id,youtube_url:'https://youtu.be/test'}),/Admin access/);
  await assert.rejects(as('admin','admin_update_lesson',{lesson_id:theory.id,youtube_url:'javascript:alert(1)'}),/YouTube/);
  await as('admin','admin_update_lesson',{lesson_id:theory.id,youtube_url:'https://www.youtube.com/watch?v=school_video'});
  assert.equal((await as('student','my_lessons')).find(x=>x.id===theory.id).youtube_url,'https://www.youtube.com/watch?v=school_video');
 });
 await t.test('refund records require unused plan, reject duplicate receipts, preserve audit history',async()=>{
  const otherEnrollment=(await as('other','snapshot')).active_enrollment.id;
  await assert.rejects(as('admin','admin_record_refund',{enrollment_id:enrollment,reference:'refund_used'}),/unused paid plan/);
  await assert.rejects(as('other','admin_record_refund',{enrollment_id:otherEnrollment,reference:'refund_other'}),/Admin access/);
  await as('admin','admin_record_refund',{enrollment_id:otherEnrollment,reference:'bank_refund_other'});
  assert.equal((await as('other','my_payments'))[0].status,'refunded');
  assert.equal((await as('other','snapshot')).active_enrollment,null);
 });
});

test('migration repair preserves unsafe historical rows for review',async t=>{
 const legacyLearner='20000000-0000-0000-0000-000000000001',legacyInstructor='20000000-0000-0000-0000-000000000002';
 const {db,as,vehicle}=await database({beforeRepair:async database=>{
  for(const [id,name,role]of [[legacyLearner,'Legacy learner','student'],[legacyInstructor,'Legacy instructor','instructor']]){
   await database.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,name+'@example.test',JSON.stringify({name,role})]);
   await database.query("insert into drivex_private.profiles(id,name,role,approval_status) values($1,$2,$3,'approved')",[id,name,role]);
  }
  const en=(await database.query("insert into drivex_private.enrollments(learner_id,plan_id,instructor_id,credits_total,status) values($1,'plan_10_day',$2,10,'active') returning id",[legacyLearner,legacyInstructor])).rows[0].id;
  await database.query("insert into drivex_private.payments(enrollment_id,amount_paise,status,reference,provider,provider_order_id) values($1::uuid,150000,'paid','order_'||$1::text,'direct','order_'||$1::text)",[en]);
 }});t.after(()=>db.close());
 assert.equal((await as(legacyInstructor,'me')).me.approval_status,'pending');
 const legacy=await as(legacyLearner,'snapshot'),en=legacy.active_enrollment.id;assert.equal(legacy.active_enrollment.review_required,true);
 await assert.rejects(as(legacyLearner,'reserve',{date:future(),time:'10:00',vehicle}),/administrator review/);
 await as('admin','admin_set_instructor_status',{instructor_id:legacyInstructor,status:'approved'});
 await as('admin','admin_mark_paid',{enrollment_id:en,reference:'reviewed_actual_receipt'});
 assert.equal((await as(legacyLearner,'snapshot')).active_enrollment.review_required,false);
 assert.equal((await as(legacyLearner,'my_payments')).length,1);
});

test('only the current paid instructor can mark progress and payments awaiting review cannot be assessed',async t=>{
 const {db,as,paid,vehicle}=await database();t.after(()=>db.close());
 const old=await paid();const booking=await as('student','reserve',{date:future(),time:'10:00',vehicle});
 await db.exec('reset role');await db.query("update drivex_private.bookings set starts_at=now()-interval '3 hours',ends_at=now()-interval '2 hours' where id=$1",[booking.id]);
 await db.query('update drivex_private.payments set review_required=true where enrollment_id=$1',[old]);
 await assert.rejects(as('instructor','assess',{booking:booking.id,score:8,notes:'Practice'}),/administrator review/);
 await as('admin','admin_mark_paid',{enrollment_id:old,reference:'reviewed_receipt'});
 await as('instructor','assess',{booking:booking.id,score:8,notes:'Practice'});
 await db.exec('reset role');await db.query("update drivex_private.enrollments set status='finished',credits_used=credits_total,activated_at=now()-interval '1 day' where id=$1",[old]);
 await paid('student','instructor2');
 const practical=(await as('student','my_lessons')).find(x=>x.kind==='practical');
 await assert.rejects(as('instructor','mark_practical_done',{learner_id:ids.student,lesson_id:practical.id}),/not assigned/);
 assert.equal((await as('instructor','instructor_learners')).length,0);
 await as('instructor2','mark_practical_done',{learner_id:ids.student,lesson_id:practical.id});
});

test('legacy lesson receipts remain visible and refund recording retains authorization and ledger history',async t=>{
 const {db,as,vehicle}=await database();t.after(()=>db.close());
 await db.exec('reset role');
 const booking=(await db.query("insert into drivex_private.bookings(student_id,instructor_id,vehicle_id,starts_at,ends_at,status,amount_paise) values($1,$2,$3,now()+interval '3 days',now()+interval '3 days 1 hour','confirmed',80000) returning id",[ids.student,ids.instructor,vehicle])).rows[0].id;
 await db.query("insert into drivex_private.payments(booking_id,amount_paise,status,reference,recorded_by) values($1,80000,'paid','historical_school_receipt',$2)",[booking,ids.admin]);
 const history=await as('student','my_payments');assert.equal(history.length,1);assert.equal(history[0].legacy,true);
 assert.equal((await as('other','my_payments')).length,0);
 await as('student','cancel_booking',{booking});assert.equal((await as('student','my_payments'))[0].status,'refund_pending');
 await assert.rejects(as('student','record_refund',{booking,reference:'bank_return'}),/Admin access/);
 await as('admin','record_refund',{booking,reference:'bank_return'});await as('admin','record_refund',{booking,reference:'bank_return'});
 assert.equal((await as('student','my_payments'))[0].status,'refunded');
 assert.equal((await as('student','snapshot')).bookings[0].status,'cancelled');
});

test('administrator can assign an existing account as instructor without reassigning admins or active learners',async t=>{
 const {db,as,paid}=await database();t.after(()=>db.close());
 await assert.rejects(as('student','add_instructor',{email:'other@example.test'}),/Admin access/);
 await assert.rejects(as('admin','add_instructor',{email:'admin@example.test'}),/administrator role/);
 await paid();await assert.rejects(as('admin','add_instructor',{email:'student@example.test'}),/Finish learner enrollment/);
 await as('admin','add_instructor',{email:'other@example.test',specialty:'Manual transmission'});
 const profile=(await as('other','snapshot')).me;assert.equal(profile.role,'instructor');assert.equal(profile.approval_status,'approved');assert.equal(profile.specialty,'Manual transmission');
});
