import { configured,signedIn,login,signup,logout,recover,changePassword,handleCallback,getCallbackError,rpc,invokeFunction } from './api.mjs';
import { esc,money,today,date,badge,intro,empty,stat,progress,progressBar,navigation,bookingsView,paymentsView,syllabusView } from './presentation.mjs';
import { checkout } from './checkout.mjs';
const $=s=>document.querySelector(s);
let state=null, page='overview', filter='all', door='student', busy=false, course=[], payments=[], learners=[], metrics={}, times=[], slotError='', loadingSlots=false, slotRequest=0;
let draft={date:today(),time:'',vehicle:''};
const recovery=handleCallback();
const role=()=>state?.me?.role;
const brand='<div class="brand"><div class="brandmark">D</div>Drive<span>X</span></div>';
function toast(message) { const t=$('#toast');t.textContent=message;t.style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.style.display='none',7000); }
function modal(title,body) { const m=$('#modal');m.innerHTML=`<div class="modal-top"><h2 id="modal-title">${esc(title)}</h2><button class="close" aria-label="Close dialog">×</button></div>${body}`;m.querySelector('.close').onclick=()=>m.close();if(!m.open)m.showModal(); }
function errorMessage(error) { return error?.message||'Unable to complete this action. Please try again.'; }
function clearState() {state=null;course=[];payments=[];learners=[];metrics={};times=[];draft={date:today(),time:'',vehicle:''};page='overview';slotRequest++;}
async function signOut() { try {await logout();} catch {} finally {clearState();$('#modal').close();auth();} }
function unavailable(error) {
  clearState();$('#app').innerHTML=`<main class="auth-panel"><section class="panel panel-pad">${brand}${intro('Unable to load DriveX',errorMessage(error))}<button class="primary" id="retry">Try again</button> <button class="secondary" id="logout">Sign out</button></section></main>`;
  $('#retry').onclick=()=>start();$('#logout').onclick=signOut;
}
async function reload() {
  const next=await rpc('snapshot');
  if(!next?.me || !navigation[next.me.role]) throw Error('The school account could not be loaded. Contact support.');
  let nextCourse=[],nextPayments=[],nextLearners=[],nextMetrics={};
  const pending=next.me.role==='instructor'&&next.me.approval_status!=='approved';
  if(!pending) {
    if(next.me.role==='student') [nextCourse,nextPayments,nextMetrics]=await Promise.all([rpc('my_lessons'),rpc('my_payments'),rpc('dashboard')]);
    if(next.me.role==='instructor') [nextLearners,nextPayments,nextMetrics]=await Promise.all([rpc('instructor_learners'),rpc('instructor_earnings'),rpc('instructor_overview')]);
    if(next.me.role==='admin') [nextCourse,nextPayments,nextMetrics]=await Promise.all([rpc('admin_lessons'),rpc('my_payments'),rpc('admin_overview')]);
  }
  state=next;course=nextCourse||[];payments=nextPayments||[];learners=nextLearners||[];metrics=nextMetrics||{};
  if(!state.vehicles?.some(v=>v.id===draft.vehicle&&v.active)) draft.vehicle=state.vehicles?.find(v=>v.active)?.id||'';
  if(!navigation[role()].some(([p])=>p===page))page='overview';
  render();
}
function auth(mode='login',message='') {
  const ready=configured();
  $('#app').innerHTML=`<main class="auth-shell"><section class="auth-story">${brand}<div><div class="eyebrow">YOUR ROAD TO CONFIDENCE</div><h1>Learn the skills.<br>Own the road.</h1><p>Structured plans, guided practice and a clear view of your progress.</p></div><div class="plan-preview-pills"><span class="pill">10-Day · ₹1,500 · 10 credits</span><span class="pill">Monthly · ₹4,000 · 30 credits</span></div><small>DriveX Driving Academy</small></section><section class="auth-panel"><div class="auth-card">${!ready?intro('Setup required','The school needs to configure the service before you can sign in.'):`<div class="door-tabs"><button class="door-btn ${door==='student'?'active':''}" data-door="student">I'm a Learner</button><button class="door-btn ${door==='instructor'?'active':''}" data-door="instructor">I'm an Instructor</button></div>${intro(mode==='signup'?'Create your account':mode==='recover'?'Reset password':mode==='password'?'Choose a new password':'Welcome back',mode==='signup'&&door==='instructor'?'Your account will be reviewed before you can accept learners.':door==='instructor'?'Manage your learners and teaching schedule.':'Plan your lessons and see your progress.')}<form id="auth-form" class="modal-body">${mode==='signup'?`<label>Full name<input name="name" autocomplete="name" maxlength="100" required></label><label>Phone<input name="phone" type="tel" autocomplete="tel" maxlength="30" required></label><label>Account type<select name="role"><option value="student" ${door==='student'?'selected':''}>Learner</option><option value="instructor" ${door==='instructor'?'selected':''}>Instructor · approval required</option></select></label>`:''}${mode!=='password'?'<label>Email<input name="email" type="email" autocomplete="email" required></label>':''}${mode!=='recover'?`<label>Password<input name="password" type="password" minlength="8" autocomplete="${mode==='login'?'current-password':'new-password'}" required></label>`:''}<p class="error" id="auth-error" role="alert"></p><p role="status">${esc(message)}</p><button class="primary full">${mode==='signup'?'Create account':mode==='recover'?'Send reset link':mode==='password'?'Save password':'Sign in'}</button></form><div class="auth-links">${mode==='login'?'<button class="link" data-auth="signup">Create an account</button><button class="link" data-auth="recover">Forgot password?</button>':'<button class="link" data-auth="login">Back to sign in</button>'}</div>`}</div></section></main>`;
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
function learnerOverview() {
 const en=state.active_enrollment, p=progress(course),next=state.bookings.filter(b=>b.status==='confirmed'&&new Date(b.starts_at)>new Date()).sort((a,b)=>a.starts_at.localeCompare(b.starts_at))[0];
 return `${intro('Welcome, '+state.me.name,'Every lesson brings you closer to confident driving.')}<div class="stats">${stat('Lessons left',en?.credits_remaining||0)}${stat('Reserved lessons',metrics.confirmed_count||0)}${stat('Completed lessons',metrics.completed_count||0)}${stat('Learning progress',p.total+'%')}</div><div class="grid section-gap"><section class="panel panel-pad lesson-hero"><div class="eyebrow">NEXT LESSON</div>${next?`<h2>${date(next.date)} · ${esc(next.time)} IST</h2><p>${esc(next.instructor_name)} · ${esc(next.vehicle_name)}</p>`:'<h2>Your next step starts here.</h2><p>Choose a plan, then reserve a lesson with your instructor.</p>'}<button class="primary lime section-gap" data-nav="${en?'book':'plans'}">${en?'Book a lesson':'Choose a plan'} →</button></section><section class="panel panel-pad"><h2>Your learning journey</h2>${progressBar('Theory',p.theory)}${progressBar('Practical',p.practical)}<button class="link" data-nav="syllabus">Explore your syllabus →</button></section></div>${en?.review_required?'<p class="banner-alert">Your previous plan activation needs receipt review. Contact the school before booking.</p>':''}<section class="section-gap"><h2>Recent lessons</h2>${bookingsView(state.bookings.slice(0,3),'student')}</section>`;
}
function plansView() {
 const en=state.active_enrollment;
 return `${intro('A plan for your journey','One credit is used when your instructor completes a lesson.')} ${en?`<section class="plan-active-badge"><h2>${esc(en.plan_name)}</h2><p>${en.credits_remaining} lessons left · ${en.credits_reserved} reserved · ${esc(en.instructor_name)}</p></section>`:''}<div class="plan-cards-grid section-gap">${state.plans.map((p,i)=>`<section class="plan-card ${i===1?'highlight':''}"><div class="eyebrow">${p.lesson_credits} GUIDED LESSONS</div><h2>${esc(p.name)}</h2><div class="price"><b>${money(p.price_inr)}</b></div><ul class="plan-features"><li>${p.lesson_credits} practical lesson credits</li><li>One hour of guided practice per lesson</li><li>Theory resources and progress tracking</li><li>Your chosen school instructor</li></ul><button class="primary full" data-enroll="${esc(p.id)}" ${en?'disabled':''}>Choose plan</button></section>`).join('')}</div>${!state.instructors.length?'<p class="hint">No approved instructors yet. Contact the school before purchasing.</p>':''}`;
}
function bookView() {
 const en=state.active_enrollment;
 if(!en)return intro('Book a lesson','Choose a plan to begin.')+empty('Buy a plan to book','Your plan must be paid before booking.')+'<button class="primary" data-nav="plans">View plans</button>';
 const vehicles=state.vehicles.filter(v=>v.active);
 return `${intro('Book a lesson',`${en.credits_remaining} lessons left · ${en.credits_reserved} already reserved · ${en.instructor_name}`)}<div class="grid"><section class="panel panel-pad booking-form"><label>Lesson date<input id="lesson-date" type="date" min="${today()}" value="${esc(draft.date)}" required></label><label>Training vehicle<select id="vehicle">${vehicles.map(v=>`<option value="${esc(v.id)}" ${v.id===draft.vehicle?'selected':''}>${esc(v.name)} · ${esc(v.transmission)}</option>`).join('')}</select></label><h2>One-hour slots · IST</h2>${!vehicles.length?empty('No active training vehicles','Contact the school to arrange a vehicle.'):loadingSlots?'<p role="status">Loading availability…</p>':slotError?`<p class="error" role="alert">${esc(slotError)}</p><button class="secondary" id="slots-retry">Retry availability</button>`:`<div class="slots">${times.map(t=>`<button class="slot ${draft.time===t.time?'selected':''}" data-time="${esc(t.time)}" aria-pressed="${draft.time===t.time}" ${t.available?'':'disabled'}>${esc(t.time)}</button>`).join('')}</div>`}</section><section class="panel panel-pad"><h2>Your lesson</h2><p class="summary-line">${date(draft.date)} · ${esc(draft.time||'Choose a time')}</p><p class="sub">Credits are used after completion. You can cancel before the lesson starts.</p><button class="primary full section-gap" id="reserve" ${draft.time&&!loadingSlots&&!busy?'':'disabled'}>Reserve lesson</button></section></div>`;
}
function instructorOverview() { return `${intro('Welcome, '+state.me.name,'Your learners, lessons and school plan collections.')}<div class="stats">${stat('Active learners',metrics.learners_count||0)}${stat("Today's lessons",metrics.today_lessons||0)}${stat('Upcoming lessons',metrics.upcoming_lessons||0)}${stat('Plan collections',money(metrics.total_earnings))}</div><section class="section-gap"><h2>Teaching schedule</h2>${bookingsView(state.bookings,'instructor',filter)}</section>`; }
function learnersView(){return `${intro('My learners','Review progress and mark practical skills after teaching them.')}<div class="cards">${learners.map(l=>{const p=progress(l.lessons);return `<section class="panel panel-pad"><h2>${esc(l.learner_name)}</h2><p>${esc(l.phone)} · ${esc(l.plan_name)}</p><p>${l.credits_remaining}/${l.credits_total} credits left</p>${progressBar('Theory',p.theory)}${progressBar('Practical',p.practical)}${l.lessons.filter(x=>x.kind==='practical').map(x=>`<div class="syllabus-item"><span>${esc(x.title)}</span>${x.completed?badge('completed'):`<button class="secondary" data-practical="${esc(x.id)}" data-learner="${esc(l.learner_id)}">Mark done</button>`}</div>`).join('')}</section>`;}).join('')||empty('No learners yet','Paid learners assigned to you will appear here.')}</div>`;}
function instructorsView(){return `${intro('Instructor approvals','Review each instructor before they accept learners.')}<button class="primary" id="add-instructor">Assign instructor by email</button><section class="panel panel-pad">${state.instructors.map(i=>`<div class="syllabus-item"><div><b>${esc(i.name)}</b><p>${esc(i.phone)} · ${esc(i.specialty)}</p>${badge(i.approval_status)}</div><div>${i.approval_status!=='approved'?`<button class="primary" data-instructor="${esc(i.id)}" data-status="approved">Approve</button>`:''}${i.approval_status!=='rejected'?`<button class="danger" data-instructor="${esc(i.id)}" data-status="rejected">Reject</button>`:''}</div></div>`).join('')||empty('No instructor applications yet')}</section>`;}
function fleetView(){return `${intro('Training fleet','Only active vehicles are offered for booking.')}<button class="primary" id="add-vehicle">Add vehicle</button><section class="panel panel-pad section-gap">${state.vehicles.map(v=>`<div class="syllabus-item"><div><b>${esc(v.name)}</b><p>${esc(v.reg)} · ${esc(v.transmission)}</p>${badge(v.active?'active':'inactive')}</div><button class="secondary" data-vehicle="${esc(v.id)}" data-active="${!v.active}">${v.active?'Deactivate':'Activate'}</button></div>`).join('')||empty('No vehicles yet')}</section>`;}
function render() {
 if(!state)return;
 const r=role(), pending=r==='instructor'&&state.me.approval_status!=='approved';
 let body;
 if(pending)body=`${intro(state.me.approval_status==='rejected'?'Application needs attention':'Waiting for admin approval',state.me.approval_status==='rejected'?'Contact the school to discuss your application.':'Your account will be reviewed before you can accept learners.')}<button class="secondary" id="refresh">Refresh status</button>`;
 else if(page==='lessons')body=intro(r==='student'?'My lessons':r==='admin'?'All bookings':'My schedule','All lesson times are in India Standard Time.')+bookingsView(state.bookings,r,filter);
 else if(page==='payments'||page==='earnings')body=intro(r==='instructor'?'Plan collections':'Payments',r==='admin'?'Record actual school receipts and completed refunds.':'Your plan payment history.')+paymentsView(payments,r)+'<button class="secondary section-gap" id="refresh">Refresh status</button>';
 else if(page==='syllabus')body=intro(r==='admin'?'Theory resources':'Learning & progress',r==='admin'?'Add school-reviewed YouTube videos to the syllabus.':'Theory is marked by you. Practical progress is marked by your instructor.')+syllabusView(course,r==='admin');
 else if(r==='student')body=page==='plans'?plansView():page==='book'?bookView():learnerOverview();
 else if(r==='instructor')body=page==='learners'?learnersView():instructorOverview();
 else if(page==='instructors')body=instructorsView();
 else if(page==='fleet')body=fleetView();
 else body=`${intro('School overview','Manage the people and resources behind every lesson.')}<div class="stats">${stat('Learners',metrics.total_learners||0)}${stat('Pending instructors',metrics.pending_instructors||0)}${stat('Active plans',metrics.active_enrollments||0)}${stat('Receipts to review',metrics.review_payments||0)}</div><section class="panel panel-pad section-gap"><h2>School operations</h2><p class="sub">Review instructor applications, add real training vehicles, and reconcile payments before learners book.</p><div class="grid-buttons section-gap"><button class="secondary" data-nav="instructors">Review instructors</button><button class="secondary" data-nav="fleet">Manage fleet</button><button class="secondary" data-nav="payments">Review payments</button></div></section>`;
 $('#app').innerHTML=`<a class="skip-link" href="#main-content">Skip to content</a><div class="shell"><aside class="side">${brand}<small>${esc(r==='student'?'Learner':r)} portal</small>${!pending?`<nav class="nav" aria-label="Main navigation">${navigation[r].map(([p,label])=>`<button data-nav="${p}" class="${page===p?'active':''}" ${page===p?'aria-current="page"':''}>${label}</button>`).join('')}</nav>`:''}<div class="side-bottom"><p>${esc(state.me.name)}</p><button class="link" id="logout">Sign out</button></div></aside><main class="content" id="main-content">${body}<footer class="footer">DriveX · Guided learning, confident driving</footer></main></div>`;
 bind();
}
async function navigate(next) {if(!navigation[role()].some(([p])=>p===next))return;page=next;filter='all';times=[];draft.time='';render();if(page==='book')await availability();$('#page-title')?.focus();window.scrollTo(0,0);}
async function availability() {
 const request=++slotRequest,values={date:draft.date,vehicle:draft.vehicle};times=[];draft.time='';slotError='';loadingSlots=true;render();
 try {if(!values.vehicle)throw Error('No active training vehicles. Contact the school.');const rows=await rpc('availability',values);if(request===slotRequest)times=rows||[];}
 catch(error){if(request===slotRequest)slotError=errorMessage(error);}
 finally{if(request===slotRequest){loadingSlots=false;if(page==='book')render();}}
}
async function perform(action,payload,message) {
 if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);
 try {await rpc(action,payload);$('#modal').close();await reload();if(page==='book')await availability();if(message)toast(message);}
 catch(error){if($('#modal').open&&$('#modal .error'))$('#modal .error').textContent=errorMessage(error);else toast(errorMessage(error));}
 finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);if(state)render();}
}
function formModal(title,fields,submit,callback,note='') {
 modal(title,`<form id="action-form" class="modal-body"><p class="sub">${esc(note)}</p>${fields}<p class="error" role="alert"></p><button class="primary">${esc(submit)}</button></form>`);
 $('#action-form').onsubmit=event=>{event.preventDefault();if(busy)return;callback(new FormData(event.currentTarget));};
}
async function pay(id) {
 if(busy)return;busy=true;toast('Opening secure checkout…');
 try {await checkout(id,{invokeFunction,rpc,onPending:()=>toast('Payment submitted. Waiting for server confirmation…')});await reload();toast('Payment received. Your plan is active.');}
 catch(error){toast(errorMessage(error));try{await reload();}catch{}}
 finally{busy=false;}
}
function bind() {
 $('#logout').onclick=signOut;
 document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>navigate(b.dataset.nav));
 document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;render();});
 if($('#refresh'))$('#refresh').onclick=async()=>{try{await reload();}catch(error){unavailable(error);}};
 if($('#lesson-date'))$('#lesson-date').onchange=event=>{draft.date=event.target.value;availability();};
 if($('#vehicle'))$('#vehicle').onchange=event=>{draft.vehicle=event.target.value;availability();};
 if($('#slots-retry'))$('#slots-retry').onclick=availability;
 document.querySelectorAll('[data-time]').forEach(b=>b.onclick=()=>{draft.time=b.dataset.time;render();});
 if($('#reserve'))$('#reserve').onclick=()=>perform('reserve',{...draft},'Lesson reserved. Your credit is used after completion.');
 document.querySelectorAll('[data-enroll]').forEach(b=>b.onclick=()=>{
  const plan=state.plans.find(p=>p.id===b.dataset.enroll);
  formModal('Choose your instructor',`<p>${esc(plan.name)} · ${money(plan.price_inr)}</p><label>Instructor<select name="instructor_id" required><option value="">Select an approved instructor</option>${state.instructors.map(i=>`<option value="${esc(i.id)}">${esc(i.name)} · ${esc(i.specialty)}</option>`).join('')}</select></label>`,'Continue to payment',async f=>{
   if(busy)return;busy=true;$('#action-form button').disabled=true;
   try{const en=await rpc('enroll',{plan_id:plan.id,instructor_id:f.get('instructor_id')});$('#modal').close();busy=false;await pay(en.enrollment_id);}
   catch(error){$('#modal .error').textContent=errorMessage(error);busy=false;$('#action-form button').disabled=false;}
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
