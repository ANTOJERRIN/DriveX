export function createNeonApi({fetcher=(...args)=>fetch(...args), location=globalThis.location, history=globalThis.history}={}) {
 let signed=false, resetToken='', callbackError='';
 async function request(path, data) {
  const response=await fetcher(path,{method:data===undefined?'GET':'POST',credentials:'same-origin',
   headers:data===undefined?{}:{'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});
  const result=await response.json().catch(()=>null);
  if(!response.ok){
   if(response.status===401)signed=false;
   throw Object.assign(Error(result?.message||'DriveX service is unavailable.'),{status:response.status,code:result?.code});
  }
  return result;
 }
 const auth=(name,data)=>request('/api/auth/'+name,data);
 const restoreSession=async()=>{signed=!!(await auth('get-session'))?.signedIn;return signed;};
 return {
  configured:()=>true,signedIn:()=>signed,restoreSession,
  login:async(email,password)=>{await auth('sign-in/email',{email,password});if(!await restoreSession())throw Error('Confirm your email and sign in again.');},
  signup:async(name,email,password)=>{await auth('sign-up/email',{name,email,password});return restoreSession();},
  logout:async()=>{await auth('sign-out',{});signed=false;},
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
  invokeFunction:async()=>{throw Error('Online checkout is not available on this deployment. Contact the school to pay.');},
 };
}
