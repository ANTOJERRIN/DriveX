export function createNeonApi({fetcher=(...args)=>fetch(...args), location=globalThis.location, history=globalThis.history}={}) {
 let signed=false, resetToken='', callbackError='',epoch=0;
 async function request(path, data,requestEpoch=epoch) {
  const response=await fetcher(path,{method:data===undefined?'GET':'POST',credentials:'same-origin',
   headers:data===undefined?{}:{'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});
  const result=await response.json().catch(()=>null);
  if(requestEpoch!==epoch)throw Error('Your session changed. Please sign in again.');
  if(!response.ok){
   if(response.status===401)signed=false;
   throw Object.assign(Error(result?.message||result?.error||'DriveX service is unavailable.'),{status:response.status,code:result?.code});
  }
  return result;
 }
 const auth=(name,data,requestEpoch=epoch)=>request('/api/auth/'+name,data,requestEpoch);
 const restoreSession=async(requestEpoch=epoch)=>{signed=!!(await auth('get-session',undefined,requestEpoch))?.signedIn;return signed;};
 return {
  configured:()=>true,signedIn:()=>signed,restoreSession,
  login:async(email,password)=>{const current=++epoch;signed=false;await auth('sign-in/email',{email,password},current);if(!await restoreSession(current))throw Error('Confirm your email and sign in again.');},
  signup:async(name,email,password)=>{const current=++epoch;signed=false;await auth('sign-up/email',{name,email,password},current);return restoreSession(current);},
  logout:async()=>{epoch++;signed=false;await auth('sign-out',{});},
  recover:email=>auth('request-password-reset',{email}),
  changePassword:async password=>{await auth('reset-password',{newPassword:password,token:resetToken});resetToken='';},
  handleCallback:()=>{
   const url=new URL(location.href);
   resetToken=url.searchParams.get('token')||'';
   callbackError=url.searchParams.has('error')?'This email link is invalid or expired. Request a new link.':'';
   if(resetToken||callbackError)history.replaceState(null,'',url.pathname);
   return !!resetToken&&!callbackError;
  },
  getCallbackError:()=>callbackError,
  rpc:(action,payload={})=>request('/api/drivex',{action,payload}),
  invokeFunction:(name,payload={})=>{
   if(name!=='create-order')throw Error('Unknown school operation.');
   return request('/api/create-order',payload);
  },
 };
}
