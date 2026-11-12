import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import pg from 'pg';
import {dispatch} from './gateway.mjs';
import {readNeonConfig} from './config.mjs';

const {site,auth,databaseUrl}=readNeonConfig();
const pool=new pg.Pool({connectionString:databaseUrl,max:5});
const root=resolve('dist');
const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const routes={'sign-up/email':'POST','sign-in/email':'POST','sign-out':'POST','get-session':'GET','request-password-reset':'POST','reset-password':'POST'};
const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
async function body(req){
 const chunks=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>16384)throw Object.assign(Error('Request too large.'),{status:413});chunks.push(chunk);}
 try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw Object.assign(Error('Invalid JSON.'),{status:400});}
}
const upstream=(req,path,method,data)=>fetch(auth.href.replace(/\/$/,'')+'/'+path,{
 method,headers:{Origin:site.origin,'Content-Type':'application/json',...(req.headers.cookie?{Cookie:req.headers.cookie}:{})},
 redirect:'error',signal:AbortSignal.timeout(10000),...(data===undefined?{}:{body:JSON.stringify(data)})
});
function cookies(res,r){
 const list=r.headers.getSetCookie().map(c=>c.replace(/;\s*(?:Domain|Path)=[^;]*/gi,'')+'; Path=/');
 if(list.length)res.setHeader('Set-Cookie',list);
}

createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; frame-src https://www.youtube-nocookie.com https://www.youtube.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
 try {
  const path=new URL(req.url,site).pathname;
  if(req.method==='POST'&&(req.headers.origin!==site.origin||!req.headers['content-type']?.startsWith('application/json')))return json(res,403,{message:'Request origin or content type rejected.'});
  if(path==='/healthz'&&req.method==='GET'){
   const {rows:[row]}=await pool.query("select to_regprocedure('public.drivex(text,jsonb)') is not null as ready");
   return json(res,row.ready?200:503,{ready:row.ready});
  }
  if(path.startsWith('/api/auth/')){
   const route=path.slice(10);
   if(!Object.hasOwn(routes,route)||routes[route]!==req.method)return json(res,404,{message:'Unknown auth operation.'});
   let input;
   if(req.method==='POST'){
    const data=await body(req);
    const pick=(...keys)=>Object.fromEntries(keys.filter(k=>typeof data?.[k]==='string').map(k=>[k,data[k]]));
    input=route==='sign-up/email'?{...pick('email','password','name'),callbackURL:site.origin+'/'}:
     route==='sign-in/email'?pick('email','password'):
     route==='request-password-reset'?{...pick('email'),redirectTo:site.origin+'/'}:
     route==='reset-password'?pick('newPassword','token'):{};
   }
   const r=await upstream(req,route,req.method,input);
   cookies(res,r);
   const result=await r.json().catch(()=>null);
   return json(res,r.status,r.ok?(route==='get-session'?{signedIn:!!result?.session&&result?.user?.emailVerified===true}:{}):
    {message:r.status>=500?'Sign-in service is unavailable.':result?.message||'Authentication request failed.'});
  }
  if(path==='/api/drivex'&&req.method==='POST'){
   const data=await body(req);
   if(typeof data?.action!=='string'||!data.payload||typeof data.payload!=='object'||Array.isArray(data.payload))return json(res,400,{message:'Invalid DriveX request.'});
   const authResponse=await upstream(req,'get-session','GET');
   if(!authResponse.ok&&authResponse.status!==401)return json(res,503,{message:'Sign-in service is unavailable.'});
   cookies(res,authResponse);
   const session=await authResponse.json().catch(()=>null);
   return json(res,200,await dispatch(pool,session?.session?session.user:null,data.action,data.payload));
  }
  if(req.method!=='GET'||path.startsWith('/api/'))return json(res,404,{message:'Not found.'});
  if(path==='/config.mjs'){
   res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});return res.end("export const config = { provider: 'neon' };");
  }
  const file=resolve(root,'.'+decodeURIComponent(path==='/'?'/index.html':path));
  if(!file.startsWith(root+sep)||!types[extname(file)])return json(res,404,{message:'Not found.'});
  const content=await readFile(file).catch(()=>null);
  if(!content)return json(res,404,{message:'Not found.'});
  res.writeHead(200,{'Content-Type':types[extname(file)],'Cache-Control':'no-cache'});res.end(content);
 }catch(error){
  const domain=['P0001','42501','23P01','23505','23514','22P02'].includes(error.code);
  json(res,error.status||(error.code==='42501'?403:domain?400:503),{message:domain?(error.code==='P0001'?error.message:'This operation is not permitted or conflicts with existing data.'):error.status?error.message:'DriveX service is unavailable.',code:error.code==='42501'?'42501':undefined});
 }
}).listen(Number(process.env.PORT||3000),'0.0.0.0');
