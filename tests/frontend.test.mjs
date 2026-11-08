import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validatePublicConfig } from '../dist/public-config.mjs';
import { esc,progress,youtube,navigation,paymentsView,syllabusView,bookingsView } from '../dist/presentation.mjs';
import { waitForPayment,loadCheckout } from '../dist/checkout.mjs';
import { createApi } from '../dist/api.mjs';
import { scanText } from '../scripts/audit-secrets.mjs';

test('public configuration accepts only public keys and explicit development hosts',()=>{
 assert.equal(validatePublicConfig('https://test.supabase.co/','sb_publishable_fixture').supabaseUrl,'https://test.supabase.co');
 assert.equal(validatePublicConfig('http://127.0.0.1:54321','sb_publishable_fixture').supabaseUrl,'http://127.0.0.1:54321');
 const jwt=role=>['header',Buffer.from(JSON.stringify({role})).toString('base64url'),'signature'].join('.');
 assert.equal(validatePublicConfig('https://test.supabase.co',jwt('anon')).publishableKey,jwt('anon'));
 for(const key of ['sb_secret_fixture','anything',jwt('service_role'),jwt('authenticated'),'ey.bad.value'])assert.throws(()=>validatePublicConfig('https://test.supabase.co',key),/publishable key/);
 for(const url of ['http://test.supabase.co','https://evil.test','https://test.supabase.co/extra','https://user:password@test.supabase.co','https://test.supabase.co?key=secret'])assert.throws(()=>validatePublicConfig(url,'sb_publishable_fixture'));
});
test('credential scanner distinguishes public config and fixtures from server credentials',()=>{
 const jwt=['eyJheader',Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url'),'signature'].join('.');
 assert.deepEqual(scanText(jwt),['service-role JWT']);
 assert.deepEqual(scanText('sb_publishable_fixture sb_secret_fixture rzp_live_fixture'),[]);
 assert.deepEqual(scanText('sb_'+'secret_'+'unusableAuditExample'),['Supabase secret key']);
 assert.deepEqual(scanText('RAZORPAY_'+'KEY_SECRET = "'+'unusableAuditExample'+'"'),['literal server credential']);
});
test('build rejects secrets without writing output and accepts valid public config',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'drivex-build-'));try{
  await mkdir(join(dir,'dist'));
  const script=new URL('../scripts/generate-config.mjs',import.meta.url);
  let result=spawnSync(process.execPath,[script.pathname.replace(/^\/([A-Za-z]:)/,'$1')],{cwd:dir,encoding:'utf8',env:{...process.env,SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_secret_never_expose'}});
  assert.equal(result.status,1);assert.ok(!result.stderr.includes('sb_secret_never_expose'));
  result=spawnSync(process.execPath,[script.pathname.replace(/^\/([A-Za-z]:)/,'$1')],{cwd:dir,encoding:'utf8',env:{...process.env,SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture'}});
  assert.equal(result.status,0,result.stderr);assert.match(await readFile(join(dir,'dist/config.mjs'),'utf8'),/sb_publishable_fixture/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('rendered learner screens escape user content and never offer receipt or role controls',()=>{
 const dangerous='<img src=x onerror=alert(1)>',id='fixture';
 assert.ok(!esc(dangerous).includes('<img'));
 const html=paymentsView([{enrollment_id:id,plan_name:dangerous,instructor_name:dangerous,status:'created',amount_inr:1500}],'student');
 assert.match(html,/Continue payment/);assert.ok(!html.includes('<img'));assert.ok(!html.includes('data-receipt'));assert.ok(!html.includes('data-refund'));
 assert.ok(!navigation.student.some(([p])=>p==='instructors'||p==='fleet'));
 const lessonHtml=syllabusView([{id,kind:'theory',title:dangerous,youtube_url:'javascript:alert(1)',completed:false}]);
 assert.ok(!lessonHtml.includes('href="javascript:'));assert.match(lessonHtml,/Video not yet added/);
 assert.equal(youtube('https://youtube.com.evil.test/watch?v=x'),'');assert.equal(youtube('https://youtu.be/safe'),'https://youtu.be/safe');
 const legacy={id:'legacy',booking_id:'booking',enrollment_id:null,legacy:true,status:'refund_pending',amount_inr:800};
 assert.match(paymentsView([legacy],'admin'),/data-legacy-refund/);assert.ok(!paymentsView([legacy],'student').includes('data-pay'));
});
test('progress is based on curriculum completion and assessment controls require lesson end',()=>{
 assert.deepEqual(progress([{kind:'theory',completed:true},{kind:'theory',completed:false},{kind:'practical',completed:true}]),{theory:50,practical:100,total:67});
 const lesson={id:'test',starts_at:new Date(Date.now()+100000).toISOString(),ends_at:new Date(Date.now()+3700000).toISOString(),date:'2026-11-09',time:'10:00',status:'confirmed',student:'Learner'};
 assert.ok(!bookingsView([lesson],'instructor').includes('data-assess'));
 lesson.ends_at=new Date(Date.now()-1000).toISOString();assert.ok(bookingsView([lesson],'instructor').includes('data-assess'));
});
test('checkout polls database status and never treats pending or failed events as paid',async()=>{
 let calls=0;
 const result=await waitForPayment('enrollment',{rpc:async()=>[{enrollment_id:'enrollment',status:++calls===3?'paid':'created'}],delay:async()=>{},attempts:4});
 assert.equal(result.status,'paid');assert.equal(calls,3);
 await assert.rejects(waitForPayment('enrollment',{rpc:async()=>[{enrollment_id:'enrollment',status:'created'}],delay:async()=>{},attempts:2}),/confirmation is pending/);
 await assert.rejects(waitForPayment('enrollment',{rpc:async()=>[{enrollment_id:'enrollment',status:'failed'}],delay:async()=>{},attempts:2}),/marked failed/);
 let retryReads=0;
 assert.equal((await waitForPayment('enrollment',{rpc:async()=>[{enrollment_id:'enrollment',status:++retryReads===3?'paid':'failed'}],delay:async()=>{},attempts:4})).status,'paid');
 await assert.rejects(waitForPayment('enrollment',{rpc:async()=>[{enrollment_id:'enrollment',status:'paid',review_required:true}],delay:async()=>{},attempts:1}),/confirmation is pending/);
});
test('blocked session storage does not stop login, and checkout SDK errors can be retried',async t=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage'),originalWindow=globalThis.window,originalDocument=globalThis.document;
 t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'sessionStorage',descriptor);else delete globalThis.sessionStorage;globalThis.window=originalWindow;globalThis.document=originalDocument;});
 Object.defineProperty(globalThis,'sessionStorage',{configurable:true,get(){throw Error('storage unavailable');}});
 const client=createApi({config:{supabaseUrl:'https://fixture.supabase.co',publishableKey:'sb_publishable_fixture'},fetcher:async()=>new Response(JSON.stringify({access_token:'fixture',refresh_token:'fixture-refresh',expires_in:3600}))});
 await client.login('fixture@example.test','fixture-password');assert.equal(client.signedIn(),true);
 globalThis.window={};let mode='error',appends=0;
 globalThis.document={createElement:()=>({remove(){}}),head:{append(script){appends++;queueMicrotask(()=>{if(mode==='error')script.onerror();else if(mode==='missing')script.onload();else{window.Razorpay=function FixtureCheckout(){};script.onload();}});}}};
 await assert.rejects(loadCheckout(),/Unable to load checkout/);mode='missing';
 await assert.rejects(loadCheckout(),/Checkout did not load/);mode='success';
 assert.equal(typeof await loadCheckout(),'function');assert.equal(appends,3);
});
test('API preserves session refresh, recovery callback and detailed server errors',async t=>{
 const original={fetch:globalThis.fetch,sessionStorage:globalThis.sessionStorage,location:globalThis.location,history:globalThis.history};
 t.after(()=>Object.assign(globalThis,original));
 const store=new Map();globalThis.sessionStorage={getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 globalThis.location={origin:'https://fixture.test',hash:'',pathname:'/'};let replaced=false;globalThis.history={replaceState:()=>{replaced=true;}};
 const api=createApi({storage:globalThis.sessionStorage});
 let requests=[],refreshes=0;
 globalThis.fetch=async(url,options)=>{
  requests.push([url,JSON.parse(options.body||'{}'),options.headers]);
  if(url.includes('grant_type=password'))return new Response(JSON.stringify({access_token:'fixture-old',refresh_token:'fixture-refresh',expires_in:-10}));
  if(url.includes('grant_type=refresh_token')){refreshes++;return new Response(JSON.stringify({access_token:'fixture-new',refresh_token:'fixture-refresh',expires_in:3600}));}
  if(url.includes('/rpc/'))return new Response(JSON.stringify([]));
  return new Response('{}');
 };
 await api.login('fixture@example.test','fixture-password');await Promise.all([api.rpc('plans_list'),api.rpc('my_payments')]);
 assert.equal(store.size,1);assert.equal(JSON.parse(store.get('drivex-auth-v1')).access_token,'fixture-new');
 assert.equal(refreshes,1);assert.ok(requests.filter(([url])=>url.includes('/rpc/')).every(([,body,headers])=>body.payload&&headers.Authorization==='Bearer fixture-new'));
 globalThis.fetch=async()=>new Response(JSON.stringify({error:'Online payments are not configured.'}),{status:503});
 await assert.rejects(api.invokeFunction('create-order',{}),/Online payments are not configured/);
 globalThis.fetch=async()=>new Response(JSON.stringify({code:'PGRST202'}),{status:404});await assert.rejects(api.rpc('snapshot'),/database needs an update/);
 location.hash='#access_token=fixture-recovery&refresh_token=fixture-refresh&type=recovery';assert.equal(api.handleCallback(),true);assert.equal(replaced,true);
 location.hash='#error=access_denied&error_description=Link+expired';assert.equal(api.handleCallback(),false);assert.equal(api.getCallbackError(),'Link expired');
 globalThis.fetch=async()=>{throw Error('network');};await assert.rejects(api.rpc('snapshot'),/could not reach the server/);
 await api.logout().catch(()=>{});assert.equal(api.signedIn(),false);assert.equal(store.size,0);
});
