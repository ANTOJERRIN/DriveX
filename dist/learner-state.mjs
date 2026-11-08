import {esc,money} from './presentation.mjs';

export function nextLearnerAction(state) {
 const active=state.active_enrollment;
 if(state.pending_enrollment)return {page:'payments',label:'Continue payment',description:'Your plan purchase is pending. Check Payments before starting another purchase.'};
 if(active?.review_required)return {page:'payments',label:'Review payment status',description:'Contact the school to review your existing receipt before booking.'};
 if(active&&Number(active.credits_remaining)<=Number(active.credits_reserved))return {page:'lessons',label:'View my lessons',description:'Your remaining credits are already reserved. Complete or cancel a lesson before booking another.'};
 if(active)return {page:'book',label:'Book a lesson',description:'Choose a date and vehicle for your next lesson.'};
 return {page:'plans',label:'Choose a plan',description:'Choose a plan, then reserve a lesson with your instructor.'};
}

export function pendingPlanView(state) {
 const plan=state.pending_enrollment;
 if(!plan)return '';
 return `<section class="panel panel-pad section-gap" aria-label="Pending plan purchase"><h2>Finish your plan purchase</h2><p>${esc(plan.plan_name)} · ${money(plan.amount_inr)} · ${esc(plan.instructor_name)}</p><p class="sub">${plan.payment_status==='failed'?'A payment attempt was marked failed. Check the latest status before retrying.':'Your plan is awaiting server payment confirmation. Check the latest status before paying again.'}</p><button class="secondary section-gap" data-nav="payments">Open Payments</button></section>`;
}
