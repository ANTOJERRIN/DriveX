// Isolated local UI/API fixture. It never contacts Supabase or Razorpay and never ships in dist/.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve,extname,relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { database,ids } from './helpers/database.mjs';
import { createOrderHandler,webhookHandler } from '../supabase/functions/_shared/payments.mjs';

export async function createFixtureServer({port=0,seedPaid=false,paymentsEnabled=true}={}) {
 const h=await database();
 if(seedPaid) {
  await h.paid();
  const date=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
  await h.as('student','reserve',{date,time:'10:00',vehicle:h.vehicle});
  const past=await h.as('student','reserve',{date,time:'11:00',vehicle:h.vehicle});
  await h.db.exec('reset role');
  await h.db.query("update drivex_private.bookings set starts_at=now()-interval '3 hours',ends_at=now()-interval '2 hours' where id=$1",[past.id]);
 }
 const root=resolve('dist');let chain=Promise.resolve(),base='',orderCount=0;
 const serial=task=>{const next=chain.then(task);chain=next.catch(()=>{});return next;};
 const settings={SUPABASE_ANON_KEY:'sb_publishable_fixture',SUPABASE_SERVICE_ROLE_KEY:'test-service',RAZORPAY_KEY_ID:'rzp_test_fixture',RAZORPAY_KEY_SECRET:'fixture-private',RAZORPAY_WEBHOOK_SECRET:'fixture-webhook'};
 const env=name=>name==='SUPABASE_URL'?base:settings[name];
 const fetcher=async(url,options)=>{
  if(url==='https://api.razorpay.com/v1/orders'){
   const order=JSON.parse(options.body);
   return new Response(JSON.stringify({id:'order_fixture'+(++orderCount),amount:order.amount,currency:order.currency}));
  }
  if(url.startsWith(base+'/'))return fetch(url,options);
  throw Error('External access is disabled in this isolated fixture.');
 };
 const orderHandler=createOrderHandler({env,fetcher}),paymentHandler=webhookHandler({env,fetcher});
 const mime={'.html':'text/html','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'};
 const server=createServer(async(req,res)=>{
  const send=(status,body,type='application/json')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'});res.end(type==='application/json'?JSON.stringify(body):body);};
  try {
   const url=new URL(req.url,base);
   if(url.pathname==='/config.mjs')return send(200,`export const config=${JSON.stringify({supabaseUrl:base,publishableKey:settings.SUPABASE_ANON_KEY})};`,'text/javascript');
   if(req.method==='POST'){
    let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>262144)throw Error('Request is too large.');}
    if(url.pathname.startsWith('/functions/v1/')){
     if(!paymentsEnabled)return send(503,{error:'Payments are disabled in the isolated UI fixture.'});
     const input=new Request(url,{method:'POST',headers:req.headers,body:raw});
     const result=await (url.pathname.endsWith('/create-order')?orderHandler(input):paymentHandler(input));
     res.writeHead(result.status,Object.fromEntries(result.headers));return res.end(Buffer.from(await result.arrayBuffer()));
    }
    const body=JSON.parse(raw||'{}');
    if(url.pathname==='/auth/v1/token'){
     const user=body.email?.split('@')[0];
     if(!ids[user]||body.password!=='fixture-password')return send(401,{message:'Use a local test account and fixture-password.'});
     return send(200,{access_token:'fixture_'+user,refresh_token:'fixture_refresh_'+user,expires_in:3600});
    }
    if(url.pathname==='/auth/v1/logout')return send(200,{});
    if(url.pathname==='/rest/v1/rpc/drivex'){
     const user=(req.headers.authorization||'').replace('Bearer fixture_','');
     if(!ids[user])return send(401,{message:'Please sign in.'});
     return send(200,await serial(()=>h.as(user,body.action,body.payload)));
    }
    if(url.pathname==='/rest/v1/rpc/drivex_notification_jobs'){
     if(req.headers.authorization!=='Bearer '+settings.SUPABASE_SERVICE_ROLE_KEY)return send(403,{message:'Service access required.'});
     return send(200,await serial(()=>h.server('drivex_notification_jobs',[body.action,JSON.stringify(body.payload||{})])));
    }
    if(url.pathname==='/rest/v1/rpc/register_payment_order'||url.pathname==='/rest/v1/rpc/process_payment_event'){
     if(req.headers.authorization!=='Bearer '+settings.SUPABASE_SERVICE_ROLE_KEY)return send(403,{message:'Service access required.'});
     const registration=url.pathname.endsWith('/register_payment_order');
     const args=registration?[body.p_enrollment_id,body.p_order_id,body.p_amount_paise]:[body.p_order_id,body.p_payment_id,body.p_amount_paise,body.p_currency,body.p_event_id,body.p_status];
     return send(200,await serial(()=>h.server(registration?'register_payment_order':'process_payment_event',args)));
    }
    return send(404,{message:'Fixture endpoint not supported.'});
   }
   const file=resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
   if(relative(root,file).startsWith('..')||file===root)return send(403,{});
   return send(200,await readFile(file),mime[extname(file)]||'text/plain');
  } catch(error) {if(!res.writableEnded)send(error.code==='42501'?403:400,{message:error.message,code:error.code});}
 });
 await new Promise((accept,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',accept);});
 base='http://127.0.0.1:'+server.address().port;
 return {url:base,vehicle:h.vehicle,withDatabase:callback=>serial(()=>callback(h.db)),
  close:async()=>{await new Promise(accept=>server.close(accept));await h.db.close();}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const fixture=await createFixtureServer({port:3100,seedPaid:true,paymentsEnabled:false});
 console.log('Isolated UI fixture: '+fixture.url+' · accounts student/instructor/admin/pending@example.test · password fixture-password');
 process.on('SIGINT',async()=>{await fixture.close();process.exit(0);});
}
