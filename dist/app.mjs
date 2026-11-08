import {authView} from './auth-view.mjs';
import {brand,workspaceView,pageTitle} from './layout.mjs';
import {createRouter} from './router.mjs';
import {createWorkspaceLoader} from './workspace.mjs';
import {disableButtons,lockMutations} from './controls.mjs';
import {createMutationRunner} from './mutations.mjs';
import {recommendationsView} from './recommendations.mjs';
import {learnerOverview,plansView,bookView} from './portals/learner.mjs';
import {instructorOverview,learnersView} from './portals/instructor.mjs';
import {instructorsView,fleetView,adminOverview} from './portals/admin.mjs';
import {availabilityView,notificationsView,parseWorkingHours} from './scheduling.mjs';
import {registerPwa} from './pwa.mjs';
import { configured,signedIn,login,signup,logout,recover,changePassword,handleCallback,getCallbackError,rpc,invokeFunction } from './api.mjs';
import { esc,money,today,intro,bookingsView,paymentsView,syllabusView } from './presentation.mjs';
import { checkout } from './checkout.mjs';
const $=s=>document.querySelector(s);
let state=null, page='overview', filter='all', door='student', course=[], payments=[], learners=[], metrics={}, times=[], slotError='', loadingSlots=false, slotRequest=0;
let draft={date:today(),time:'',vehicle:''};
let hours=null,notices=null,selectedInstructor='',recommendations=null,unavailableFeatures=[],syncIssue='';
const recovery=handleCallback();
const role=()=>state?.me?.role;
const router=createRouter({onChange:showPage});
const workspace=createWorkspaceLoader({rpc,onLoad:applyWorkspace});
const mutations=createMutationRunner({refresh:reload});
function toast(message) { const t=$('#toast');t.textContent=message;t.style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.style.display='none',7000); }
function modal(title,body) { const m=$('#modal');m.innerHTML=`<div class="modal-top"><h2 id="modal-title">${esc(title)}</h2><button class="close" aria-label="Close dialog">×</button></div>${body}`;m.querySelector('.close').onclick=()=>m.close();if(!m.open)m.showModal(); }
function errorMessage(error) { return error?.message||'Unable to complete this action. Please try again.'; }
function clearState() {workspace.invalidate();mutations.reset();unavailableFeatures=[];syncIssue='';state=null;course=[];payments=[];learners=[];metrics={};times=[];hours=null;notices=null;recommendations=null;selectedInstructor='';draft={date:today(),time:'',vehicle:''};page='overview';slotRequest++;}
async function signOut() { const request=logout();router.reset();clearState();$('#modal').close();auth();try {await request;} catch {} }
function unavailable(error) {
  clearState();$('#app').innerHTML=`<main class="auth-panel"><section class="panel panel-pad">${brand}${intro('Unable to load DriveX',errorMessage(error))}<button class="primary" id="retry">Try again</button> <button class="secondary" id="logout">Sign out</button></section></main>`;
  $('#retry').onclick=()=>start();$('#logout').onclick=signOut;
}
async function reload() {
  const loaded=await workspace.load({selectedInstructor});
  if(loaded&&page==='book')await availability();
  return loaded;
}
function applyWorkspace(next) {
  ({state,course,payments,learners,metrics,hours,notices,selectedInstructor,recommendations,unavailableFeatures}=next);
  if(!state.vehicles?.some(v=>v.id===draft.vehicle&&v.active)) draft.vehicle=state.vehicles?.find(v=>v.active)?.id||'';
  page=router.activate(role(),{pending:next.pending});
  render();
}
function auth(mode='login',message='') {
  const ready=configured();
  $('#app').innerHTML=authView({ready,mode,door,message});
  document.title='Sign in · DriveX';
  document.querySelectorAll('[data-door]').forEach(b=>b.onclick=()=>{door=b.dataset.door;auth(mode);});
  document.querySelectorAll('[data-auth]').forEach(b=>b.onclick=()=>auth(b.dataset.auth));
  if(!ready)return;
  $('#auth-form').onsubmit=async event=>{
    event.preventDefault();const form=event.currentTarget,button=form.querySelector('button'),f=new FormData(form);button.disabled=true;
    try {
      if(mode==='recover'){await recover(f.get('email'));auth('login','If an account exists, a reset email has been sent.');return;}
      if(mode==='password'){await changePassword(f.get('password'));await signOut();auth('login','Password saved. Sign in with your new password.');return;}
      if(mode==='signup'){
        const active=await signup(f.get('name'),f.get('email'),f.get('password'),f.get('phone'),f.get('role'));
        if(!active){auth('login','Check your email and confirm your account before signing in.');return;}
      }else await login(f.get('email'),f.get('password'));
      clearState();await reload();
    }catch(error){$('#auth-error').textContent=errorMessage(error);button.disabled=false;}
  };
}
function render() {
 if(!state)return;
 const r=role(), pending=r==='instructor'&&state.me.approval_status!=='approved';
 let body;
 if(pending)body=`${intro(state.me.approval_status==='rejected'?'Application needs attention':'Waiting for admin approval',state.me.approval_status==='rejected'?'Contact the school to discuss your application.':'Your account will be reviewed before you can accept learners.')}<button class="secondary" id="refresh">Refresh status</button>`;
 else if(page==='availability')body=availabilityView({state,hours,selectedInstructor,unavailable:unavailableFeatures.includes('working_hours')});
 else if(page==='notifications')body=notificationsView(notices);
 else if(page==='lessons')body=intro(r==='student'?'My lessons':r==='admin'?'All bookings':'My schedule','All lesson times are in India Standard Time.')+bookingsView(state.bookings,r,filter);
 else if(page==='payments'||page==='earnings')body=intro(r==='instructor'?'Plan collections':'Payments',r==='admin'?'Record actual school receipts and completed refunds.':'Your plan payment history.')+paymentsView(payments,r)+'<button class="secondary section-gap" id="refresh">Refresh status</button>';
 else if(page==='syllabus')body=intro(r==='admin'?'Theory resources':'Learning & progress',r==='admin'?'Add school-reviewed YouTube videos to the syllabus.':'Theory is marked by you. Practical progress is marked by your instructor.')+syllabusView(course,r==='admin');
 else if(r==='student')body=page==='plans'?plansView({state}):page==='book'?bookView({state,draft,times,slotError,loadingSlots,busy:mutations.blocked}):learnerOverview({state,course,metrics})+recommendationsView(recommendations);
 else if(r==='instructor')body=page==='learners'?learnersView({learners}):instructorOverview({state,metrics,filter});
 else if(page==='instructors')body=instructorsView({state});
 else if(page==='fleet')body=fleetView({state});
 else body=adminOverview({metrics});
 $('#app').innerHTML=workspaceView({me:state.me,page,body:(syncIssue?`<section class="banner-alert" role="alert"><div><h2>Refresh required</h2><p>${esc(syncIssue)}</p></div><button class="secondary" id="sync-refresh">Refresh saved data</button></section>`:'')+body,pending});
 document.title=pending?'Instructor review · DriveX':pageTitle(r,page);
 bind();
 lockMutations(document,mutations.blocked);
 if($('#sync-refresh'))$('#sync-refresh').disabled=mutations.busy;
}
function navigate(next) {router.go(next);}
async function showPage(next) {page=next;filter='all';times=[];draft.time='';slotError='';slotRequest++;render();if(page==='book')await availability();$('#page-title')?.focus();window.scrollTo(0,0);}
async function availability() {
 if(!state?.active_enrollment||state.pending_enrollment||state.active_enrollment.review_required||Number(state.active_enrollment.credits_remaining)<=Number(state.active_enrollment.credits_reserved)){times=[];draft.time='';slotError='';loadingSlots=false;render();return;}
 const request=++slotRequest,values={date:draft.date,vehicle:draft.vehicle};times=[];draft.time='';slotError='';loadingSlots=true;render();
 try {if(!values.vehicle)throw Error('No active training vehicles. Contact the school.');const rows=await rpc('availability',values);if(request===slotRequest)times=rows||[];}
 catch(error){if(request===slotRequest)slotError=errorMessage(error);}
 finally{if(request===slotRequest){loadingSlots=false;if(page==='book')render();}}
}
async function mutate(operation,{message='',errorSelector,onSaved=()=>{}}={}) {
 if(mutations.blocked)return {status:'blocked'};
 const restoreButtons=disableButtons(document);
 const outcome=await mutations.run(operation,{onSaved});
 restoreButtons();
 if(outcome.status==='stale')return outcome;
 if(outcome.status==='saved'){syncIssue='';if(message)toast(message);}
 else if(outcome.status==='saved_refresh_failed')syncIssue='Your change was saved, but the latest data could not be loaded. Refresh before submitting another change.';
 else if(outcome.status==='unknown'){syncIssue=errorMessage(outcome.error)+' Check the saved data before trying again; do not submit the same action twice.';$('#modal').close();}
 else if(outcome.status==='rejected'){
  const field=(errorSelector&&$(errorSelector))||($('#modal').open&&$('#modal .error'));
  if(field)field.textContent=errorMessage(outcome.error);else toast(errorMessage(outcome.error));
 }
 if(state&&outcome.status!=='rejected')render();
 lockMutations(document,mutations.blocked);
 return outcome;
}
async function perform(action,payload,message,options={}) {
 return mutate(()=>rpc(action,payload),{message,onSaved:()=>$('#modal').close(),...options});
}
async function refreshScreen() {
 const outcome=await mutations.reconcile();
 if(outcome.status==='stale'||outcome.status==='blocked')return;
 if(outcome.status==='refreshed'){syncIssue='';render();return;}
 if(!signedIn()){router.reset();clearState();auth('login','Your session expired. Please sign in again.');return;}
 syncIssue='The latest data could not be loaded. Check your connection and refresh again before making changes.';
 if(state)render();else unavailable(outcome.error);
}
function formModal(title,fields,submit,callback,note='') {
 modal(title,`<form id="action-form" class="modal-body"><p class="sub">${esc(note)}</p>${fields}<p class="error" role="alert"></p><button class="primary">${esc(submit)}</button></form>`);
 $('#action-form').onsubmit=event=>{event.preventDefault();if(mutations.blocked)return;callback(new FormData(event.currentTarget));};
}
async function pay(id) {
 if(mutations.blocked)return;
 toast('Opening secure checkout...');
 return mutate(()=>checkout(id,{invokeFunction,rpc,onPending:()=>toast('Payment submitted. Waiting for server confirmation...')}),{message:'Payment received. Your plan is active.'});
}
function bind() {
 $('#logout').onclick=signOut;
 document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>navigate(b.dataset.nav));
 document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;render();});
 if($('#refresh'))$('#refresh').onclick=refreshScreen;
 if($('#sync-refresh'))$('#sync-refresh').onclick=refreshScreen;
 if($('#hours-instructor'))$('#hours-instructor').onchange=async event=>{selectedInstructor=event.target.value;await refreshScreen();};
 const scheduleChange=(action,payload,errorSelector)=>perform(action,{instructor_id:hours.instructor_id,...payload},'Teaching availability saved.',{errorSelector});
 if($('#hours-form'))$('#hours-form').onsubmit=event=>{event.preventDefault();try{const hours=parseWorkingHours(new FormData(event.currentTarget));scheduleChange('set_working_hours',{hours},'#hours-error');}catch(error){$('#hours-error').textContent=errorMessage(error);}};
 if($('#block-date-form'))$('#block-date-form').onsubmit=event=>{event.preventDefault();const f=new FormData(event.currentTarget);scheduleChange('set_blocked_date',{date:f.get('date'),reason:f.get('reason'),blocked:true},'#blocked-error');};
 document.querySelectorAll('[data-unblock]').forEach(b=>b.onclick=()=>scheduleChange('set_blocked_date',{date:b.dataset.unblock,blocked:false},'#blocked-error'));
 document.querySelectorAll('[data-retry-notice]').forEach(b=>b.onclick=()=>perform('retry_notification',{id:b.dataset.retryNotice},'Notice queued for retry.'));
 document.querySelectorAll('[data-recommendation-feedback]').forEach(b=>b.onclick=()=>perform('recommendation_feedback',{recommendation_id:b.dataset.recommendationFeedback,feedback:b.dataset.feedback},'Learning suggestion updated.'));
 if($('#lesson-date'))$('#lesson-date').onchange=event=>{draft.date=event.target.value;availability();};
 if($('#vehicle'))$('#vehicle').onchange=event=>{draft.vehicle=event.target.value;availability();};
 if($('#slots-retry'))$('#slots-retry').onclick=availability;
 document.querySelectorAll('[data-time]').forEach(b=>b.onclick=()=>{draft.time=b.dataset.time;render();});
 if($('#reserve'))$('#reserve').onclick=()=>perform('reserve',{...draft},'Lesson reserved. Your credit is used after completion.');
 document.querySelectorAll('[data-enroll]').forEach(b=>b.onclick=()=>{
  const plan=state.plans.find(p=>p.id===b.dataset.enroll);
  formModal('Choose your instructor',`<p>${esc(plan.name)} · ${money(plan.price_inr)}</p><label>Instructor<select name="instructor_id" required><option value="">Select an approved instructor</option>${state.instructors.map(i=>`<option value="${esc(i.id)}">${esc(i.name)} · ${esc(i.specialty)}</option>`).join('')}</select></label>`,'Continue to payment',async f=>{
   const outcome=await perform('enroll',{plan_id:plan.id,instructor_id:f.get('instructor_id')},'');
   if(outcome.status==='saved')await pay(outcome.value.enrollment_id);
  },'Your plan starts only after payment is received.');
 });
 document.querySelectorAll('[data-pay]').forEach(b=>b.onclick=()=>pay(b.dataset.pay));
 document.querySelectorAll('[data-theory]').forEach(b=>b.onclick=()=>perform('mark_theory_done',{lesson_id:b.dataset.theory},'Theory lesson marked as watched.'));
 document.querySelectorAll('[data-practical]').forEach(b=>b.onclick=()=>perform('mark_practical_done',{lesson_id:b.dataset.practical,learner_id:b.dataset.learner},'Practical progress saved.'));
 document.querySelectorAll('[data-instructor]').forEach(b=>b.onclick=()=>perform('admin_set_instructor_status',{instructor_id:b.dataset.instructor,status:b.dataset.status},'Instructor review saved.'));
 document.querySelectorAll('[data-vehicle]').forEach(b=>b.onclick=()=>perform('admin_set_vehicle_active',{vehicle_id:b.dataset.vehicle,active:b.dataset.active==='true'},'Fleet updated.'));
 document.querySelectorAll('[data-cancel]').forEach(b=>b.onclick=()=>{const lesson=state.bookings.find(x=>x.id===b.dataset.cancel);formModal('Cancel this lesson?',lesson?.enrollment_id?'<p>The reserved credit becomes available for another lesson.</p>':'<p>An old paid receipt will need school refund review.</p>','Cancel lesson',()=>perform('cancel_booking',{booking:b.dataset.cancel},'Lesson cancellation saved.'));});
 document.querySelectorAll('[data-legacy-refund]').forEach(b=>b.onclick=()=>formModal('Record returned refund','<label>Actual refund reference<input name="reference" minlength="3" maxlength="120" required></label>','Save refund record',f=>perform('record_refund',{booking:b.dataset.legacyRefund,reference:f.get('reference')},'Refund receipt saved.'),'Record only money already returned for this historical lesson.'));
 document.querySelectorAll('[data-assess]').forEach(b=>b.onclick=()=>formModal('Complete & assess lesson','<label>Score (1–10)<input name="score" type="number" min="1" max="10" required></label><label>Feedback notes<textarea name="notes" maxlength="1500" required></textarea></label>','Complete lesson',f=>perform('complete_booking',{booking:b.dataset.assess,score:Number(f.get('score')),notes:f.get('notes')},'Lesson completed. One credit used.')));
 document.querySelectorAll('[data-receipt],[data-refund]').forEach(b=>b.onclick=()=>{const refund=!!b.dataset.refund;formModal(refund?'Record completed full refund':'Record actual payment received','<label>Receipt/reference<input name="reference" minlength="3" maxlength="120" required></label>','Save receipt',f=>perform(refund?'admin_record_refund':'admin_mark_paid',{enrollment_id:b.dataset.refund||b.dataset.receipt,reference:f.get('reference')},'Receipt recorded.'),refund?'Record only money already returned. Full refunds require an unused plan with no reserved lessons.':'Enter the actual school receipt reference. This does not charge the learner.');});
 document.querySelectorAll('[data-resource]').forEach(b=>b.onclick=()=>{const lesson=course.find(x=>x.id===b.dataset.resource);formModal('Edit theory video',`<label>YouTube video URL<input name="url" type="url" value="${esc(lesson.youtube_url||'')}" placeholder="https://www.youtube.com/watch?v=…"></label>`,'Save resource',f=>perform('admin_update_lesson',{lesson_id:lesson.id,youtube_url:f.get('url')},'Theory resource saved.'),'Use a school-reviewed YouTube link, or leave empty to remove it.');});
 if($('#add-instructor'))$('#add-instructor').onclick=()=>formModal('Assign instructor access','<label>Existing account email<input name="email" type="email" required></label><label>Specialty<input name="specialty" maxlength="100" required></label>','Assign instructor',f=>perform('add_instructor',Object.fromEntries(f),'Instructor access assigned.'),'Use the email of an existing school account. This approves instructor access and cannot reassign an administrator or active learner.');
 if($('#add-vehicle'))$('#add-vehicle').onclick=()=>formModal('Add training vehicle','<label>Vehicle name<input name="name" maxlength="100" required></label><label>Registration<input name="reg" minlength="3" maxlength="30" required></label><label>Transmission<select name="transmission"><option>Manual</option><option>Automatic</option></select></label>','Add vehicle',f=>perform('add_vehicle',Object.fromEntries(f),'Vehicle added.'));
}
async function start() {
 if(!configured()||!signedIn()){auth('login',getCallbackError());return;}
 if(recovery){auth('password');return;}
 $('#app').innerHTML='<main class="empty" role="status">Loading your DriveX workspace…</main>';
 try{await reload();}catch(error){unavailable(error);}
}
start();
registerPwa();
