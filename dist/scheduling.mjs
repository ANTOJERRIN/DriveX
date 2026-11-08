import {esc,intro,empty,stat,badge,today,date} from './presentation.mjs';
export const weekdays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
export function parseWorkingHours(form) {
 const hours=[];
 for(let weekday=0;weekday<7;weekday++){
  const text=String(form.get('day_'+weekday)||'').trim();
  if(!text)continue;
  const windows=text.split(',').map(x=>x.trim());
  if(windows.length>4)throw Error('Use at most four time windows per day.');
  for(const window of windows){
   const match=window.match(/^((?:[01][0-9]|2[0-3]):(?:00|30))\s*-\s*((?:[01][0-9]|2[0-3]):(?:00|30)|24:00)$/);
   if(!match)throw Error('Use time windows like 08:00-12:00, 14:00-18:00.');
   hours.push({weekday,start:match[1],end:match[2]});
  }
 }
 return hours;
}
export function availabilityView({state,hours,selectedInstructor,unavailable=false}) {
 const admin=state.me.role==='admin';
 const picker=admin?`<label>Instructor<select id="hours-instructor">${state.instructors.map(i=>`<option value="${esc(i.id)}" ${i.id===selectedInstructor?'selected':''}>${esc(i.name)}</option>`).join('')}</select></label>`:'';
 if(unavailable)return intro('Teaching availability','The saved teaching schedule could not be loaded.')+empty('Schedule unavailable','Refresh before editing your teaching hours.')+'<button class="secondary" id="refresh">Retry schedule</button>';
 if(!hours)return intro('Teaching availability','Set weekly hours and dates away from teaching.')+picker+empty('No instructor schedule to edit','Add an instructor first.');
 return `${intro('Teaching availability','All times are in India Standard Time. Existing lessons must be resolved before removing their hours.')}<section class="panel panel-pad">${picker}
  <h2>Weekly hours</h2><p class="sub" id="hours-help">Use 08:00-12:00, 14:00-18:00. Leave a day blank for a day off. Lessons are one hour; each window starts on the hour or half-hour.</p>
  <form id="hours-form" class="hours-grid section-gap">${weekdays.map((name,weekday)=>`<label>${name}<input name="day_${weekday}" aria-describedby="hours-help" maxlength="200" value="${esc(hours.hours.filter(h=>h.weekday===weekday).map(h=>h.start+'-'+h.end).join(', '))}" placeholder="Day off"></label>`).join('')}
  <p class="error" role="alert" id="hours-error"></p><button class="primary">Save weekly hours</button></form></section>
  <section class="panel panel-pad section-gap"><h2>Blocked dates</h2><form id="block-date-form" class="form-row section-gap"><label>Date<input type="date" name="date" min="${today()}" required></label><label>Private note (optional)<input name="reason" maxlength="200"></label><button class="secondary">Block date</button></form>
  <p class="error" role="alert" id="blocked-error"></p>${hours.blocked_dates.map(d=>`<div class="syllabus-item"><div><b>${date(d.date)}</b><p>${esc(d.reason)}</p></div><button class="secondary" data-unblock="${esc(d.date)}">Unblock date</button></div>`).join('')||empty('No blocked dates')}</section>`;
}
const eventNames={booking_confirmed:'Lesson booked',booking_cancelled:'Lesson cancelled',lesson_reminder:'Lesson reminder',refund_recorded:'Refund record'};
const errorNames={network_error:'Email service unavailable',provider_throttled:'Email provider is busy',invalid_recipient:'Address or email rejected',provider_failure:'Email provider rejected the request',attempt_limit:'Retry limit reached',recipient_changed:'Recipient address changed'};
export function notificationsView(data) {
 if(!data)return intro('School emails','Lesson updates and reminder delivery.')+empty('Email status unavailable')+'<button class="secondary" id="refresh">Retry email status</button>';
 const ready=data.scheduler.installed&&data.scheduler.worker_configured,c=data.counts;
 return `${intro('School emails','Lesson updates, cancellation notices, refund records and reminders.')}<div class="stats">${stat('Queued',c.pending)}${stat('Ready to send',c.due)}${stat('Accepted by provider',c.sent)}${stat('Needs attention',c.failed)}</div>
  <p class="hint">${ready?'The delivery schedule is configured. Provider acceptance does not prove inbox delivery.':'Email delivery needs server setup before these notices can be sent.'}</p>
  <section class="panel section-gap">${data.jobs.length?`<div class="table-wrap"><table><thead><tr><th>Notice</th><th>Status</th><th>Attempts</th><th>Next attempt · IST</th><th>Action</th></tr></thead><tbody>${data.jobs.map(j=>`<tr><td>${esc(eventNames[j.event]||j.event)}</td><td>${badge(j.status)}<p>${esc(errorNames[j.last_error]||'')}</p></td><td>${j.attempts}/5</td><td>${esc(new Date(j.next_attempt_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}))}</td><td>${j.status==='dead'&&j.last_error!=='recipient_changed'?`<button class="secondary" data-retry-notice="${esc(j.id)}">Retry delivery</button>`:''}</td></tr>`).join('')}</tbody></table></div>`:empty('No notices queued yet','New bookings and refunds create notices automatically.')}</section><button class="secondary section-gap" id="refresh">Refresh email status</button>`;
}
