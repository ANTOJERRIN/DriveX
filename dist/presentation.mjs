export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const money = value => '₹' + Number(value || 0).toLocaleString('en-IN');
export const today = () => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const date = value => value ? new Date(value.length === 10 ? value+'T12:00:00+05:30' : value).toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',year:'numeric'}) : '—';
export const badge = status => `<span class="tag ${esc(status)}">${esc(({created:'Pending',paid:'Paid',failed:'Failed'})[status] || String(status || '').replaceAll('_',' '))}</span>`;
export const intro = (title,sub) => `<header class="intro"><div><div class="eyebrow">DRIVEX ACADEMY</div><h1 tabindex="-1" id="page-title">${esc(title)}</h1><p class="sub">${esc(sub)}</p></div></header>`;
export const empty = (title,sub='') => `<div class="empty"><b>${esc(title)}</b><p>${esc(sub)}</p></div>`;
export const stat = (label,value) => `<div class="stat"><small>${esc(label)}</small><div class="number">${esc(value)}</div></div>`;
export function progress(lessons = []) {
  const percent = list => list.length ? Math.round(list.filter(x=>x.completed).length*100/list.length) : 0;
  return { theory:percent(lessons.filter(x=>x.kind==='theory')), practical:percent(lessons.filter(x=>x.kind==='practical')), total:percent(lessons) };
}
export const progressBar = (label,value) => `<label class="progress-label">${esc(label)} <b>${value}%</b><progress max="100" value="${value}">${value}%</progress></label>`;
export function youtube(url) {
  try { const u=new URL(url); return u.protocol==='https:' && ['www.youtube.com','youtube.com','youtu.be'].includes(u.hostname) ? esc(u.href) : ''; } catch { return ''; }
}
export const navigation = {
 student:[['overview','Overview'],['plans','Plans & pricing'],['book','Book a lesson'],['lessons','My lessons'],['syllabus','Learning & progress'],['payments','Payments']],
 instructor:[['overview','Overview'],['learners','My learners'],['lessons','My schedule'],['availability','Teaching hours'],['earnings','Plan collections']],
 admin:[['overview','Overview'],['instructors','Instructor approvals'],['availability','Teaching hours'],['lessons','All bookings'],['fleet','Training fleet'],['payments','Payments & receipts'],['notifications','School emails'],['syllabus','Theory resources']],
};

export function bookingsView(bookings,role,filter='all') {
 const rows=bookings.filter(b=>filter==='all'||b.status===filter).sort((a,b)=>a.starts_at.localeCompare(b.starts_at));
 return `<div class="filters" aria-label="Filter lessons">${['all','confirmed','completed','cancelled'].map(f=>`<button data-filter="${f}" class="${filter===f?'active':''}" aria-pressed="${filter===f}">${esc(f)}</button>`).join('')}</div><section class="panel">${rows.length?`<div class="table-wrap"><table><thead><tr><th>Lesson · IST</th><th>${role==='student'?'Instructor':'Learner'}</th><th>Vehicle</th><th>Status & feedback</th><th>Actions</th></tr></thead><tbody>${rows.map(b=>`<tr><td>${date(b.date)}<br>${esc(b.time)}</td><td>${esc(role==='student'?b.instructor_name:b.student)}${role!=='student'?`<br><small>${esc(b.student_phone)}</small>`:''}</td><td>${esc(b.vehicle_name)}</td><td>${badge(b.status)}${b.score?`<p>${b.score}/10 · ${esc(b.notes)}</p>`:''}</td><td>${b.status==='confirmed'&&new Date(b.starts_at)>new Date()&&role!=='instructor'?`<button class="danger" data-cancel="${esc(b.id)}">Cancel lesson</button>`:''}${b.status==='confirmed'&&new Date(b.ends_at)<=new Date()&&role==='instructor'?`<button class="primary" data-assess="${esc(b.id)}">Complete & assess</button>`:''}</td></tr>`).join('')}</tbody></table></div>`:empty('No lessons in this view','Your lessons will appear here when booked.')}</section>`;
}

export function paymentsView(payments,role) {
 const actions=p=>{
  const controls=[];
  if(p.enrollment_id) {
   if(role==='student'&&['created','failed'].includes(p.status))controls.push(`<button class="primary" data-pay="${esc(p.enrollment_id)}">Continue payment</button>`);
   if(role==='admin'&&(['created','failed'].includes(p.status)||p.review_required))controls.push(`<button class="secondary" data-receipt="${esc(p.enrollment_id)}">Record actual receipt</button>`);
   if(role==='admin'&&p.status==='paid')controls.push(`<button class="link" data-refund="${esc(p.enrollment_id)}">Record full refund</button>`);
  } else if(role==='admin'&&p.legacy&&p.status==='refund_pending')controls.push(`<button class="secondary" data-legacy-refund="${esc(p.booking_id)}">Record returned refund</button>`);
  if(p.status==='paid')controls.push(`<small>${esc(p.reference)}</small>`);
  return controls.join('');
 };
 const rows=payments.map(p=>`<tr><td>${esc(p.plan_name)}<br><small>${esc(p.instructor_name)}</small></td>${role!=='student'?`<td>${esc(p.learner_name)}</td>`:''}<td>${money(p.amount_inr)}</td><td>${badge(p.status)}${p.review_required?'<p class="error">Receipt review needed</p>':''}</td><td>${date(p.paid_at||p.created_at)}</td><td>${actions(p)}</td></tr>`).join('');
 const note=role==='student'?'For refunds or payment questions, contact the school. Plan activation follows server payment confirmation.':role==='instructor'?'Plan collections are school receipts attributed to your learners. These are not instructor salary or bank payouts.':'';
 return `<section class="panel">${rows?`<div class="table-wrap"><table><thead><tr><th>Plan & instructor</th>${role!=='student'?'<th>Learner</th>':''}<th>Amount</th><th>Status</th><th>Date</th><th>${role==='admin'?'Receipts':'Next step'}</th></tr></thead><tbody>${rows}</tbody></table></div>`:empty('No payment records yet')}</section>${note?`<p class="hint">${esc(note)}</p>`:''}`;
}

export function syllabusView(lessons,admin=false) {
 const p=progress(lessons);
 return `${!admin?`<section class="panel panel-pad">${progressBar('Overall learning',p.total)}${progressBar('Theory',p.theory)}${progressBar('Practical',p.practical)}</section>`:''}${['theory','practical'].filter(k=>!admin||k==='theory').map(kind=>`<section class="panel panel-pad section-gap"><h2>${kind==='theory'?'Theory resources':'Practical milestones'}</h2>${lessons.filter(x=>x.kind===kind).map(l=>`<div class="syllabus-item"><div><b>${esc(l.title)}</b>${!admin?badge(l.completed?'completed':'pending'):''}</div><div>${youtube(l.youtube_url)?`<a class="button-link" href="${youtube(l.youtube_url)}" target="_blank" rel="noopener noreferrer">Watch lesson ↗</a>`:kind==='theory'?'<span class="muted">Video not yet added by the school</span>':''}${admin?`<button class="secondary" data-resource="${esc(l.id)}">Edit video link</button>`:kind==='theory'&&!l.completed?`<button class="secondary" data-theory="${esc(l.id)}">Mark as watched</button>`:''}</div></div>`).join('')||empty('No course lessons yet')}</section>`).join('')}`;
}
