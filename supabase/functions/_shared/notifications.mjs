async function equalToken(received,expected) {
 if(typeof received!=='string'||!expected)return false;
 const encoder=new TextEncoder();
 const [a,b]=await Promise.all([crypto.subtle.digest('SHA-256',encoder.encode(received)),crypto.subtle.digest('SHA-256',encoder.encode(expected))]);
 let difference=0;const left=new Uint8Array(a),right=new Uint8Array(b);
 for(let i=0;i<left.length;i++)difference|=left[i]^right[i];
 return difference===0;
}
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const clean=value=>String(value||'').replace(/[\r\n\x00]/g,' ');
export function notificationMessage(delivery,appUrl='') {
 const subjects={booking_confirmed:'Your DriveX lesson is booked',booking_cancelled:'Your DriveX lesson cancellation',lesson_reminder:'Your upcoming DriveX lesson',refund_recorded:'Your DriveX refund record'};
 if(!subjects[delivery.event])throw Error('Unsupported notification event.');
 let text=`Hi ${clean(delivery.name)},\n\n`;
 if(delivery.event==='refund_recorded')text+=`The school recorded a completed refund of INR ${Number(delivery.amount_inr).toLocaleString('en-IN')}. Contact the school if you have a question about the returned payment.`;
 else {
  text+=`${delivery.event==='booking_cancelled'?(delivery.cancellation_pending?'Your lesson cancellation was requested. Contact the school about the refund.':'Your lesson was cancelled. Any applicable refund is handled by the school.'):delivery.event==='lesson_reminder'?'A reminder about your upcoming lesson.':'Your lesson has been booked.'}\n\n`;
  text+=`Date: ${clean(delivery.date)}\nTime: ${clean(delivery.time)} IST\nInstructor: ${clean(delivery.instructor_name)}\nVehicle: ${clean(delivery.vehicle_name)}`;
 }
 if(appUrl)text+=`\n\nOpen DriveX for the latest status: ${appUrl}`;
 return {subject:subjects[delivery.event],text:text+'\n\nDriveX Driving Academy'};
}
export function notificationWorker({env,fetcher=fetch,queueRpc}) {
 return async req=>{
  if(req.method!=='POST')return json({error:'Method not allowed.'},405);
  const token=env('NOTIFICATION_WORKER_TOKEN')||'';
  if(token.length<32)return json({error:'Notification worker is not configured.'},503);
  if(!(await equalToken(req.headers.get('Authorization'),`Bearer ${token}`)))return json({error:'Unauthorized.'},401);
  const base=env('SUPABASE_URL'),service=env('SUPABASE_SERVICE_ROLE_KEY'),mailKey=env('RESEND_API_KEY'),from=env('RESEND_FROM');
  const appUrl=env('DRIVEX_APP_URL')||'';
  if((!queueRpc&&(!base||!service))||!mailKey||!from||/[\r\n]/.test(from)||!from.includes('@')|| (appUrl&&!/^https:\/\/[^\s]+$/.test(appUrl)))return json({error:'Notification delivery is not configured.'},503);
  const rpc=queueRpc|| (async(action,payload={})=>{
   const response=await fetcher(base+'/rest/v1/rpc/drivex_notification_jobs',{method:'POST',headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},body:JSON.stringify({action,payload}),signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw Error('Notification queue unavailable.');
   return response.json();
  });
  try {
   const jobs=await rpc('claim');
   if(!Array.isArray(jobs)||jobs.length>10)throw Error('Invalid queue response.');
   const counts={processed:0,sent:0,retried:0,failed:0};
   for(const job of jobs) {
    let outcome;
    try {
     const message=notificationMessage(job.delivery,appUrl);
     const response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+mailKey,'Content-Type':'application/json','Idempotency-Key':'drivex-'+job.id},
      body:JSON.stringify({from,to:[job.delivery.to],...message}),signal:AbortSignal.timeout(10000)});
     const receipt=await response.json().catch(()=>null);
     if(response.ok&&typeof receipt?.id==='string'&&receipt.id.length>0&&receipt.id.length<=200)outcome={success:true,provider_id:receipt.id};
     else outcome={success:false,error:response.status===429?'provider_throttled':response.status===400?'invalid_recipient':'provider_failure',permanent:response.status>=400&&response.status<500&&response.status!==429};
    }catch{outcome={success:false,error:'network_error',permanent:false};}
    const result=await rpc('finish',{id:job.id,claim_token:job.claim_token,...outcome});
    counts.processed++;
    if(result.status==='sent')counts.sent++;else if(result.status==='pending')counts.retried++;else if(result.status==='dead')counts.failed++;
   }
   return json(counts);
  }catch{return json({error:'Notification service unavailable. Jobs will recover after their lease expires.'},503);}
 };
}
