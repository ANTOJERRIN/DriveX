import {navigation} from './presentation.mjs';

export async function loadWorkspace(rpc,{selectedInstructor=''}={}) {
 const state=await rpc('snapshot');
 if(!state?.me||!navigation[state.me.role])throw Error('The school account could not be loaded. Contact support.');
 const role=state.me.role,pending=role==='instructor'&&state.me.approval_status!=='approved';
 let course=[],payments=[],learners=[],metrics={},hours=null,notices=null,recommendations=null;
 if(!pending){
  if(role==='student')[course,payments,metrics,recommendations]=await Promise.all([rpc('my_lessons'),rpc('my_payments'),rpc('dashboard'),rpc('learning_recommendations').catch(()=>null)]);
  if(role==='instructor')[learners,payments,metrics,hours]=await Promise.all([rpc('instructor_learners'),rpc('instructor_earnings'),rpc('instructor_overview'),rpc('working_hours')]);
  if(role==='admin'){
   if(!state.instructors.some(i=>i.id===selectedInstructor))selectedInstructor=state.instructors[0]?.id||'';
   [course,payments,metrics,hours,notices]=await Promise.all([rpc('admin_lessons'),rpc('my_payments'),rpc('admin_overview'),selectedInstructor?rpc('working_hours',{instructor_id:selectedInstructor}):Promise.resolve(null),rpc('notification_status')]);
  }
 }
 return {state,pending,course:course||[],payments:payments||[],learners:learners||[],metrics:metrics||{},hours,notices,selectedInstructor,recommendations};
}

// A refresh either publishes one complete workspace or leaves the previous screen intact.
export function createWorkspaceLoader({rpc,onLoad}) {
 let version=0;
 return {
  invalidate(){version++;},
  async load(options){
   const request=++version;
   try{
    const next=await loadWorkspace(rpc,options);
    if(request!==version)return false;
    onLoad(next);return true;
   }catch(error){if(request!==version)return false;throw error;}
  },
 };
}
