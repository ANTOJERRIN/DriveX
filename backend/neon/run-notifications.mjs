// Invoke from a private scheduler. Credentials are sent in a header, never a URL.
const origin=new URL(process.env.APP_ORIGIN);
const token=process.env.NOTIFICATION_WORKER_TOKEN||'';
if(origin.protocol!=='https:'||origin.href!==origin.origin+'/'||token.length<32)throw Error('Configure HTTPS APP_ORIGIN and NOTIFICATION_WORKER_TOKEN.');
try{
 const response=await fetch(new URL('/api/notification-worker',origin),{method:'POST',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(120000)});
 if(!response.ok)throw Error('Worker request rejected.');
 const result=await response.json();
 console.log(JSON.stringify(Object.fromEntries(['processed','sent','retried','failed'].map(key=>[key,result[key]]))));
}catch{
 console.error('Notification run did not complete. Check private service logs; queue leases recover automatically.');
 process.exitCode=1;
}
