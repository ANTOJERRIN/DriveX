import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {dispatch,serviceRpc} from './gateway.mjs';
import {createOrderHandler,webhookHandler} from '../../supabase/functions/_shared/payments.mjs';
import {notificationWorker} from '../../supabase/functions/_shared/notifications.mjs';

const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const routes={'sign-up/email':'POST','sign-in/email':'POST','sign-out':'POST','get-session':'GET','request-password-reset':'POST','reset-password':'POST'};
const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
async function readBody(req){
 const chunks=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>65536)throw Object.assign(Error('Request too large.'),{status:413});chunks.push(chunk);}
 return Buffer.concat(chunks).toString('utf8');
}
function parse(raw){try{return JSON.parse(raw||'{}');}catch{throw Object.assign(Error('Invalid JSON.'),{status:400});}}
function cookies(res,response){
 const list=response.headers.getSetCookie().map(c=>c.replace(/;\s*(?:Domain|Path)=[^;]*/gi,'')+'; Path=/');
 if(list.length)res.setHeader('Set-Cookie',list);
}
async function sendResponse(res,response){
 // Provider handlers are same-origin here. Do not inherit their legacy CORS headers.
 res.writeHead(response.status,{'Content-Type':'application/json','Cache-Control':'no-store'});
 res.end(await response.text());
}
export function createNeonServer({pool,servicePool,siteOrigin,authUrl,env=name=>process.env[name],fetcher=fetch,allowLocalhost=false}){
 const site=new URL(siteOrigin),auth=new URL(authUrl),root=resolve('dist');
 const local=allowLocalhost&&site.protocol==='http:'&&['127.0.0.1','localhost'].includes(site.hostname);
 if((site.protocol!=='https:'&&!local)||site.href!==site.origin+'/'||site.username||site.password||
    auth.protocol!=='https:'||!auth.hostname.endsWith('.neon.tech')||auth.username||auth.password||auth.search||auth.hash)throw Error('Set HTTPS APP_ORIGIN and a Neon Auth base URL.');
 const upstream=(req,path,method,data)=>fetcher(auth.href.replace(/\/$/,'')+'/'+path,{
  method,headers:{Origin:site.origin,'Content-Type':'application/json',...(req.headers.cookie?{Cookie:req.headers.cookie}:{})},
  redirect:'error',signal:AbortSignal.timeout(10000),...(data===undefined?{}:{body:JSON.stringify(data)})
 });
 async function userFor(req,res){
  const response=await upstream(req,'get-session','GET');cookies(res,response);
  if(response.status===401)return null;
  if(!response.ok)throw Object.assign(Error('Sign-in service is unavailable.'),{status:503});
  const session=await response.json();
  return session?.session?session.user:null;
 }
 const worker=notificationWorker({env,fetcher,queueRpc:(action,payload={})=>serviceRpc(servicePool,'drivex_notification_jobs',{action,payload})});
 const webhook=webhookHandler({env,fetcher,callRpc:(name,body)=>serviceRpc(servicePool,name,body)});
 return createServer({requestTimeout:15000,headersTimeout:10000},async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://checkout.razorpay.com; connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; frame-src https://www.youtube-nocookie.com https://www.youtube.com https://api.razorpay.com https://checkout.razorpay.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  try{
   const path=new URL(req.url,site).pathname;
   if(path==='/api/razorpay-webhook'||path==='/api/notification-worker'){
    const raw=req.method==='POST'?await readBody(req):undefined;
    const input=new Request(new URL(path,site),{method:req.method,headers:req.headers,...(raw===undefined?{}:{body:raw})});
    return sendResponse(res,await (path.endsWith('razorpay-webhook')?webhook(input):worker(input)));
   }
   if(req.method==='POST'&&(req.headers.origin!==site.origin||!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||'')))return json(res,403,{message:'Request origin or content type rejected.'});
   if(path==='/healthz'&&req.method==='GET'){
    const {rows:[row]}=await pool.query("select to_regprocedure('public.drivex(text,jsonb)') is not null as ready");
    return json(res,row.ready?200:503,{ready:row.ready});
   }
   if(path.startsWith('/api/auth/')){
    const route=path.slice(10);
    if(!Object.hasOwn(routes,route)||routes[route]!==req.method)return json(res,404,{message:'Unknown auth operation.'});
    let input;
    if(req.method==='POST'){
     const data=parse(await readBody(req));
     const pick=(...keys)=>Object.fromEntries(keys.filter(k=>typeof data?.[k]==='string').map(k=>[k,data[k]]));
     input=route==='sign-up/email'?{...pick('email','password','name'),callbackURL:site.origin+'/'}:
      route==='sign-in/email'?pick('email','password'):
      route==='request-password-reset'?{...pick('email'),redirectTo:site.origin+'/'}:
      route==='reset-password'?pick('newPassword','token'):{};
    }
    const response=await upstream(req,route,req.method,input);cookies(res,response);
    const result=await response.json().catch(()=>null);
    return json(res,response.status,response.ok?(route==='get-session'?{signedIn:!!result?.session&&result?.user?.emailVerified===true}:{}):
     {message:response.status>=500?'Sign-in service is unavailable.':result?.message||'Authentication request failed.'});
   }
   if((path==='/api/drivex'||path==='/api/create-order')&&req.method==='POST'){
    const raw=await readBody(req),data=parse(raw),user=await userFor(req,res);
    if(path==='/api/create-order'){
     if(!user?.emailVerified)return json(res,401,{message:'Sign in with a verified email first.'});
     const handler=createOrderHandler({env,fetcher,callRpc:async(name,body)=>{
      if(name!=='drivex')return serviceRpc(servicePool,name,body);
      try{return await dispatch(pool,user,body.action,body.payload);}catch(error){error.status=error.status||(error.code==='42501'?403:409);throw error;}
     }});
     // Identity was checked against Neon Auth above; the browser cannot supply it.
     return sendResponse(res,await handler(new Request(new URL(path,site),{method:'POST',headers:{Authorization:'Bearer neon-session','Content-Type':'application/json'},body:raw})));
    }
    if(typeof data?.action!=='string'||!data.payload||typeof data.payload!=='object'||Array.isArray(data.payload))return json(res,400,{message:'Invalid DriveX request.'});
    return json(res,200,await dispatch(pool,user,data.action,data.payload));
   }
   if(req.method!=='GET'||path.startsWith('/api/'))return json(res,404,{message:'Not found.'});
   if(path==='/config.mjs'){
    res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});return res.end("export const config = { provider: 'neon' };\n");
   }
   const file=resolve(root,'.'+decodeURIComponent(path==='/'?'/index.html':path));
   if(!file.startsWith(root+sep)||!types[extname(file)])return json(res,404,{message:'Not found.'});
   const content=await readFile(file).catch(()=>null);if(!content)return json(res,404,{message:'Not found.'});
   res.writeHead(200,{'Content-Type':types[extname(file)],'Cache-Control':'no-cache'});res.end(content);
  }catch(error){
   const domain=['P0001','42501','23P01','23505','23514','22P02','22023'].includes(error.code);
   const limited=error.code==='P0001'&&error.message.startsWith('RATE_LIMIT_EXCEEDED');
   json(res,limited?429:error.status||(error.code==='42501'?403:domain?400:503),{message:domain?(error.code==='P0001'||error.code==='22023'?error.message:'This operation is not permitted or conflicts with existing data.'):error.status?error.message:'DriveX service is unavailable.',code:error.code==='42501'?'42501':undefined});
  }
 });
}
