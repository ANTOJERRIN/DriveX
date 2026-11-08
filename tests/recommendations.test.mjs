import test from 'node:test';
import assert from 'node:assert/strict';
import {database,ids} from './helpers/database.mjs';
import {recommendationsView} from '../dist/recommendations.mjs';
import {loadWorkspace} from '../dist/workspace.mjs';
import {createApi} from '../dist/api.mjs';
import {createFixtureServer} from './browser-server.mjs';

test('database recommendations use private progress, server scores and SHA-256 feedback identities',async t=>{
 const h=await database();t.after(()=>h.db.close());
 const {as,db}=h;let initial,theory,practical;
 await t.test('cold start is deterministic, follows curriculum order and does not change credits',async()=>{
  initial=await as('student','learning_recommendations');
  assert.equal(initial.algorithm,'curriculum-v1');assert.match(initial.fingerprint,/^[a-f0-9]{64}$/);assert.equal(initial.completed,false);
  assert.equal(initial.items.length,2);[theory,practical]=initial.items;
  assert.equal(theory.kind,'theory');assert.equal(practical.kind,'practical');assert.match(theory.title,/Traffic signs/);assert.match(practical.title,/Cockpit/);
  assert.equal(theory.resource_available,false);assert.deepEqual(await as('student','learning_recommendations'),initial);
  assert.equal((await as('student','snapshot')).active_enrollment,null);
  const other=await as('other','learning_recommendations');assert.notEqual(other.fingerprint,initial.fingerprint);assert.notEqual(other.items[0].recommendation_id,theory.recommendation_id);
  const spoofed=await as('student','learning_recommendations',{score:1,priority:999,credits:999,role:'admin'});assert.deepEqual(spoofed,initial);
 });
 await t.test('identity, roles, payloads and result bounds are enforced',async()=>{
  await assert.rejects(as(null,'learning_recommendations'),/permission denied/);
  await assert.rejects(as('other','learning_recommendations',{learner_id:ids.student}),/own recommendations/);
  await assert.rejects(as('instructor','learning_recommendations',{learner_id:ids.student}),/not assigned/);
  await assert.rejects(as('pending','learning_recommendations',{learner_id:ids.student}),/approval required/);
  await assert.rejects(as('admin','learning_recommendations',{learner_id:ids.instructor}),/not available/);
  for(const limit of [0,11,-1,1.5,'2',null])await assert.rejects(as('student','learning_recommendations',{limit}),/integer from 1 to 10/);
  for(const payload of [[],null,'input'])await assert.rejects(as('student','learning_recommendations',payload),/object payload/);
  assert.equal((await as('student','learning_recommendations',{limit:1})).items.length,1);
  assert.deepEqual(await as('admin','learning_recommendations',{learner_id:ids.student}),initial);
  await as('student','me');
  await assert.rejects(db.query('select * from drivex_private.recommendation_feedback'),/permission denied/);
  await assert.rejects(db.query('select drivex_private.learning_recommendations($1,3,false)',[ids.student]),/permission denied/);
  await assert.rejects(db.query("select drivex_private.dispatch_before_recommendations('learning_recommendations','{}')"),/permission denied/);
 });
 await t.test('feedback is current, owned, bounded and idempotent, and does not alter scores',async()=>{
  const payload={recommendation_id:theory.recommendation_id,feedback:'helpful'};
  assert.equal((await as('student','recommendation_feedback',payload)).idempotent,false);
  assert.equal((await as('student','recommendation_feedback',payload)).idempotent,true);
  let current=await as('student','learning_recommendations');assert.equal(current.fingerprint,initial.fingerprint);assert.equal(current.items[0].feedback,'helpful');assert.equal(current.items[0].priority,theory.priority);
  assert.equal((await as('student','recommendation_feedback',{...payload,feedback:'dismissed'})).idempotent,false);
  assert.equal((await as('student','recommendation_feedback',{...payload,feedback:'dismissed'})).idempotent,true);
  current=await as('student','learning_recommendations');assert.equal(current.items.length,1);assert.equal(current.items[0].kind,'practical');assert.equal(current.completed,false);
  await assert.rejects(as('other','recommendation_feedback',payload),/Recommendation changed/);
  await assert.rejects(as('student','recommendation_feedback',{...payload,feedback:'complete'}),/helpful or dismissed/);
  await assert.rejects(as('student','recommendation_feedback',{...payload,recommendation_id:'forged'}),/identifier/);
  await assert.rejects(as('student','recommendation_feedback',{...payload,recommendation_id:'0'.repeat(64)}),/Recommendation changed/);
  await assert.rejects(as('admin','recommendation_feedback',{...payload,learner_id:ids.student}),/Only learners/);
  await db.exec('reset role');assert.equal((await db.query('select count(*)::int as count from drivex_private.recommendation_feedback')).rows[0].count,1);
 });
 await t.test('progress and resource edits invalidate stale feedback without skipping unfinished skills',async()=>{
  await as('student','mark_theory_done',{lesson_id:theory.lesson_id});
  let current=await as('student','learning_recommendations');assert.notEqual(current.fingerprint,initial.fingerprint);
  const nextTheory=current.items.find(i=>i.kind==='theory');assert.match(nextTheory.title,/Right of way/);assert.notEqual(nextTheory.lesson_id,theory.lesson_id);
  await assert.rejects(as('student','recommendation_feedback',{recommendation_id:theory.recommendation_id,feedback:'helpful'}),/Recommendation changed/);
  await as('student','recommendation_feedback',{recommendation_id:nextTheory.recommendation_id,feedback:'dismissed'});
  await as('admin','admin_update_lesson',{lesson_id:nextTheory.lesson_id,youtube_url:'https://youtu.be/school-reviewed'});
  current=await as('student','learning_recommendations');const updated=current.items.find(i=>i.lesson_id===nextTheory.lesson_id);
  assert.equal(updated.resource_available,true);assert.equal(updated.feedback,null);assert.notEqual(updated.recommendation_id,nextTheory.recommendation_id);
 });
 await t.test('low real assessment scores prioritize guided practice and respect instructor assignment',async()=>{
  await h.paid();
  const date=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
  const booking=await as('student','reserve',{date,time:'10:00',vehicle:h.vehicle});
  await db.exec('reset role');await db.query("update drivex_private.bookings set starts_at=now()-interval '3 hours',ends_at=now()-interval '2 hours' where id=$1",[booking.id]);
  await as('instructor','complete_booking',{booking:booking.id,score:4,notes:'More guided practice needed.'});
  const current=await as('student','learning_recommendations');assert.equal(current.items[0].kind,'practical');assert.match(current.items[0].reason,/Recent lesson scores/);
  assert.deepEqual(await as('instructor','learning_recommendations',{learner_id:ids.student}),current);
  await assert.rejects(as('instructor2','learning_recommendations',{learner_id:ids.student}),/not assigned/);
  await as('instructor','mark_practical_done',{learner_id:ids.student,lesson_id:practical.lesson_id});
  assert.match((await as('student','learning_recommendations')).items[0].title,/Starting, stopping/);
  assert.equal((await as('student','snapshot')).active_enrollment.credits_remaining,9);
  await db.exec('reset role');await db.query("update drivex_private.bookings set starts_at=now()-interval '12 hours',ends_at=now()-interval '11 hours' where id=$1",[booking.id]);
  for(let day=4;day<=6;day++){
   const newer=await as('student','reserve',{date:new Date(Date.now()+day*86400000).toISOString().slice(0,10),time:'10:00',vehicle:h.vehicle});
   await db.exec('reset role');await db.query("update drivex_private.bookings set starts_at=now()-make_interval(hours=>$2),ends_at=now()-make_interval(hours=>$2-1) where id=$1",[newer.id,21-day*3]);
   await as('instructor','complete_booking',{booking:newer.id,score:9,notes:'Consistent guided practice.'});
  }
  const recovered=await as('student','learning_recommendations');assert.equal(recovered.items[0].kind,'theory');
  assert.ok(!recovered.items.find(item=>item.kind==='practical').reason.includes('Recent lesson scores'));
  await db.exec('reset role');await db.query('update drivex_private.bookings set score=1 where id=$1',[booking.id]);
  assert.equal((await as('student','learning_recommendations')).fingerprint,recovered.fingerprint);
  await db.exec('reset role');await db.query("update drivex_private.enrollments set status='finished',credits_used=credits_total,activated_at=now()-interval '1 day' where learner_id=$1",[ids.student]);
  await h.paid('student','instructor2');
  await assert.rejects(as('instructor','learning_recommendations',{learner_id:ids.student}),/not assigned/);
  assert.equal((await as('instructor2','learning_recommendations',{learner_id:ids.student})).algorithm,'curriculum-v1');
 });
 await t.test('a completed curriculum has an honest empty result',async()=>{
  const course=await as('student','my_lessons');
  for(const lesson of course)if(!lesson.completed){
   if(lesson.kind==='theory')await as('student','mark_theory_done',{lesson_id:lesson.id});
   else await as('instructor2','mark_practical_done',{learner_id:ids.student,lesson_id:lesson.id});
  }
  const completed=await as('student','learning_recommendations');assert.equal(completed.completed,true);assert.deepEqual(completed.items,[]);
  await db.exec('reset role');
  const hash=(await db.query("select encode(sha256(convert_to('abc','UTF8')),'hex') as value")).rows[0].value;
  assert.equal(hash,'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
 });
});

test('recommendation screens escape content and keep failures separate from curriculum completion',()=>{
 const html=recommendationsView({items:[{title:'<script>unsafe</script>',reason:'<img onerror=alert(1)>',recommendation_id:'fixture',feedback:null,resource_available:false}]});
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.match(html,/school has not added a video/);assert.match(html,/data-recommendation-feedback/);assert.match(html,/data-nav="syllabus"/);
 assert.match(recommendationsView(null),/unavailable/);assert.match(recommendationsView({completed:true,items:[]}),/All curriculum milestones completed/);
 assert.match(recommendationsView({completed:false,items:[]}),/No suggestions to show/);
 assert.ok(!recommendationsView({items:[{title:'Skill'}]},{feedback:false}).includes('data-recommendation-feedback'));
});

test('an unavailable optional recommendation endpoint leaves the core workspace accessible',async()=>{
 const loaded=await loadWorkspace(async action=>{
  if(action==='snapshot')return {me:{role:'student'},bookings:[]};
  if(action==='learning_recommendations')throw Error('Backend update pending');
  return [];
 });
 assert.equal(loaded.state.me.role,'student');assert.equal(loaded.recommendations,null);assert.deepEqual(loaded.course,[]);
});

test('HTTP client recommendation and feedback flow reaches the real dispatcher and database',async t=>{
 const fixture=await createFixtureServer();t.after(()=>fixture.close());
 const client=createApi({config:{supabaseUrl:fixture.url,publishableKey:'sb_publishable_fixture'},storage:null});
 await client.login('student@example.test','fixture-password');
 const loaded=await loadWorkspace(client.rpc),bundle=loaded.recommendations;
 assert.equal(bundle.items.length,2);assert.match(recommendationsView(bundle),/Suggested next steps/);
 const theory=bundle.items.find(item=>item.kind==='theory');
 const payload={recommendation_id:theory.recommendation_id,feedback:'dismissed'};
 assert.equal((await client.rpc('recommendation_feedback',payload)).idempotent,false);
 assert.equal((await client.rpc('recommendation_feedback',payload)).idempotent,true);
 assert.equal((await client.rpc('learning_recommendations')).items.length,1);
 await client.rpc('mark_theory_done',{lesson_id:theory.lesson_id});
 const updated=await client.rpc('learning_recommendations');assert.notEqual(updated.fingerprint,bundle.fingerprint);assert.equal(updated.items.length,2);
 await assert.rejects(client.rpc('recommendation_feedback',payload),/Recommendation changed/);
 await assert.rejects(client.rpc('learning_recommendations',{learner_id:ids.other}),/own recommendations/);
 await client.logout();await assert.rejects(client.rpc('learning_recommendations'),/Please sign in/);
});
