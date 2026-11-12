import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {migrate,runMigrationCommand} from '../backend/neon/migrate.mjs';
import {createNeonServer} from '../backend/neon/http.mjs';
import {createNeonApi} from '../dist/neon-api.mjs';

test('Neon migration inspection is read-only, applies once and rejects unmanaged schemas',async t=>{
 const db=new PGlite({extensions:{btree_gist}});t.after(()=>db.close());
 const output=[];
 const command=args=>runMigrationCommand({args,env:{MIGRATION_DATABASE_URL:'fixture-private'},connect:async()=>({query:db.query.bind(db),exec:db.exec.bind(db),end:async()=>{}}),log:line=>output.push(line)});
 await command(['--dry-run']);
 assert.equal((await db.query("select to_regclass('public.drivex_neon_migrations') as ledger")).rows[0].ledger,null);
 assert.ok(output.includes('neon_bootstrap'));
 assert.ok(!output.some(line=>line.endsWith('_notification_scheduler.sql')));
 await command(['--apply']);
 output.length=0;await command(['--dry-run']);
 assert.deepEqual(output,['Pending Neon migrations: 0','Dry run only; no database changes applied.']);
 await command(['--apply']);
 await assert.rejects(command([]),/Use --dry-run/);
 const other=new PGlite();t.after(()=>other.close());await other.exec('create schema auth');
 await assert.rejects(migrate(other),/Existing schemas/);
 assert.equal((await other.query("select to_regclass('public.drivex_neon_migrations') as ledger")).rows[0].ledger,null);
});

test('Neon HTTP runtime: verified cookie → restricted dispatcher → signed payment → booking → email',async t=>{
 const db=new PGlite({extensions:{btree_gist}});t.after(()=>db.close());await migrate(db);
 await db.exec('create role drivex_app login; create role drivex_worker login;');
 for(const file of ['runtime-grants.sql','service-grants.sql'])await db.exec(await readFile(new URL('../backend/neon/'+file,import.meta.url),'utf8'));
 // One PGlite connection simulates the two restricted login pools serially.
 let tail=Promise.resolve();
 async function lease(role){
  let release;const previous=tail;tail=new Promise(resolve=>{release=resolve;});await previous;
  await db.exec('reset role;set role '+role);
  return {query:db.query.bind(db),release};
 }
 const pool={connect:()=>lease('drivex_app'),query:async(sql,args)=>{const client=await lease('drivex_app');try{return await client.query(sql,args);}finally{client.release();}}};
 const servicePool={query:async(sql,args)=>{const client=await lease('drivex_worker');try{return await client.query(sql,args);}finally{client.release();}}};
 const owner=async callback=>{const client=await lease('drivex_app');try{await db.exec('reset role');return await callback(db);}finally{client.release();}};
 const origin='https://school.example.test';
 const settings={RAZORPAY_KEY_ID:'rzp_test_fixture',RAZORPAY_KEY_SECRET:'fixture-private',RAZORPAY_WEBHOOK_SECRET:'fixture-webhook',NOTIFICATION_WORKER_TOKEN:'fixture-private'.repeat(4),RESEND_API_KEY:'fixture-mail-key',RESEND_FROM:'school@example.test',DRIVEX_APP_URL:origin};
 let emailCount=0,orderCount=0,lastSignup;
 const upstream=async(url,options)=>{
  if(url.startsWith('https://auth.example.neon.tech/')){
   if(url.endsWith('/get-session')){
    const id=options.headers.Cookie;
    return Response.json(id?{session:{id:'test-session'},user:{id,email:id+'@example.test',emailVerified:id!=='unverified',name:id}}:null);
   }
   lastSignup=JSON.parse(options.body);
   return new Response('{}',{headers:{'Set-Cookie':'session=fixture; Domain=auth.example.neon.tech; Path=/old; HttpOnly; Secure; SameSite=None'}});
  }
  if(url==='https://api.razorpay.com/v1/orders'){orderCount++;return Response.json({id:'order_neon',amount:150000,currency:'INR'});}
  if(url==='https://api.resend.com/emails'){emailCount++;return Response.json({id:'mail-'+emailCount});}
  throw Error('Unexpected external request.');
 };
 const server=createNeonServer({pool,servicePool,siteOrigin:origin,authUrl:'https://auth.example.neon.tech',env:key=>settings[key],fetcher:upstream});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const base='http://127.0.0.1:'+server.address().port;
 const client=id=>createNeonApi({fetcher:(path,options)=>fetch(base+path,{...options,headers:{...options.headers,Origin:origin,...(id?{Cookie:id}:{})}})});
 const student=client('student'),instructor=client('instructor'),admin=client('admin'),other=client('other');
 const identities={};
 for(const [id,api]of Object.entries({student,instructor,admin,other}))identities[id]=(await api.rpc('snapshot')).me.id;
 await owner(db=>db.query("update drivex_private.profiles set role='admin' where id=$1",[identities.admin]));
 await admin.rpc('add_instructor',{email:'instructor@example.test',specialty:'Manual'});
 const vehicle=(await admin.rpc('add_vehicle',{name:'School car',reg:'NEON123',transmission:'Manual'})).id;
 await assert.rejects(client('').rpc('snapshot'),/verified email/);
 await assert.rejects(client('unverified').rpc('snapshot'),/verified email/);
 await assert.rejects(student.rpc('add_vehicle',{name:'Spoofed',reg:'BAD123',transmission:'Manual'}),/not permitted/);
 const enrollment=await student.rpc('enroll',{plan_id:'plan_10_day',instructor_id:identities.instructor,amount_paise:1});
 await assert.rejects(other.invokeFunction('create-order',{enrollment_id:enrollment.enrollment_id}),/Enrollment not found/);
 assert.equal(orderCount,0);
 const order=await student.invokeFunction('create-order',{enrollment_id:enrollment.enrollment_id});
 assert.equal(order.amount,150000);assert.equal(orderCount,1);
 assert.equal((await student.invokeFunction('create-order',{enrollment_id:enrollment.enrollment_id})).order_id,order.order_id);
 assert.equal(orderCount,1);
 const raw=JSON.stringify({event:'payment.captured',payload:{payment:{entity:{id:'pay_neon',order_id:order.order_id,amount:150000,currency:'INR',status:'captured'}}}});
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(settings.RAZORPAY_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(raw))).toString('hex');
 assert.equal((await fetch(base+'/api/razorpay-webhook',{method:'POST',body:raw})).status,400);
 for(let i=0;i<2;i++)assert.equal((await fetch(base+'/api/razorpay-webhook',{method:'POST',body:raw,headers:{'x-razorpay-signature':signature,'x-razorpay-event-id':'event_neon'}})).status,200);
 assert.equal((await student.rpc('snapshot')).active_enrollment.credits_remaining,10);
 const date=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
 const lesson=await student.rpc('reserve',{date,time:'10:00',vehicle});
 assert.equal((await other.rpc('snapshot')).bookings.length,0);
 const otherEnrollment=await other.rpc('enroll',{plan_id:'plan_10_day',instructor_id:identities.instructor});
 await admin.rpc('admin_mark_paid',{enrollment_id:otherEnrollment.enrollment_id,reference:'receipt_neon_fixture'});
 assert.equal((await other.rpc('snapshot')).active_enrollment.credits_remaining,10);
 await assert.rejects(other.rpc('reserve',{date,time:'10:00',vehicle}),/no longer available|conflicts|already booked|unavailable/i);
 assert.equal((await fetch(base+'/api/notification-worker',{method:'POST'})).status,401);
 const notices=await fetch(base+'/api/notification-worker',{method:'POST',headers:{Authorization:'Bearer '+settings.NOTIFICATION_WORKER_TOKEN}});
 assert.equal(notices.status,200);assert.equal((await notices.json()).sent,2);assert.equal(emailCount,2);
 await owner(db=>db.query("update drivex_private.bookings set starts_at=now()-interval '3 hours',ends_at=now()-interval '2 hours' where id=$1",[lesson.id]));
 for(let i=0;i<2;i++)await instructor.rpc('complete_booking',{booking:lesson.id,score:8,notes:'Good steering.'});
 assert.equal((await student.rpc('snapshot')).active_enrollment.credits_remaining,9);
 const next=await student.rpc('reserve',{date,time:'11:00',vehicle});
 assert.equal((await student.rpc('snapshot')).active_enrollment.credits_reserved,1);
 await student.rpc('cancel_booking',{booking:next.id});
 const cancelled=await student.rpc('snapshot');
 assert.equal(cancelled.active_enrollment.credits_reserved,0);
 assert.equal(cancelled.active_enrollment.credits_remaining,9);
 await owner(async db=>{
  await db.exec('set role drivex_app');
  await assert.rejects(db.query("select public.process_payment_event('x','y',1,'INR','z','paid')"),/permission denied/);
  await db.exec('reset role;set role drivex_worker');
  await assert.rejects(db.query('select * from drivex_private.bookings'),/permission denied/);
 });
 const rejected=await fetch(base+'/api/drivex',{method:'POST',headers:{Origin:'https://other.example.test','Content-Type':'application/json'},body:'{}'});
 assert.equal(rejected.status,403);
 const signup=await fetch(base+'/api/auth/sign-up/email',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'new@example.test',name:'New',password:'fixture-password',role:'admin',callbackURL:'https://evil.test'})});
 assert.equal(signup.status,200);assert.equal(lastSignup.role,undefined);assert.equal(lastSignup.callbackURL,origin+'/');
 assert.ok(!signup.headers.get('set-cookie').includes('Domain='));assert.ok(signup.headers.get('set-cookie').includes('Path=/'));
 const postAuth=(route,input)=>fetch(base+'/api/auth/'+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(input)});
 assert.equal((await postAuth('request-password-reset',{email:'student@example.test',redirectTo:'https://evil.test'})).status,200);
 assert.deepEqual(lastSignup,{email:'student@example.test',redirectTo:origin+'/'});
 assert.equal((await postAuth('reset-password',{newPassword:'fixture-password',token:'fixture-reset',userId:'admin'})).status,200);
 assert.deepEqual(lastSignup,{newPassword:'fixture-password',token:'fixture-reset'});
 assert.equal((await postAuth('sign-out',{userId:'admin'})).status,200);
 assert.deepEqual(lastSignup,{});
 const session=await fetch(base+'/api/auth/get-session',{headers:{Cookie:'student'}});
 assert.deepEqual(await session.json(),{signedIn:true});
 const config=await fetch(base+'/config.mjs');assert.match(await config.text(),/provider: 'neon'/);
 const home=await fetch(base+'/');assert.match(home.headers.get('content-security-policy'),/checkout.razorpay.com/);
 assert.equal((await fetch(base+'/healthz')).status,200);
});

test('Neon sign-out clears local state immediately and suppresses stale restoration',async()=>{
 let release;
 const api=createNeonApi({fetcher:async(path)=>{
  if(path.endsWith('/sign-out'))throw Error('Connection unavailable');
  return new Promise(resolve=>{release=resolve;});
 }});
 const pending=api.restoreSession();
 const stale=assert.rejects(pending,/session changed/);
 await assert.rejects(api.logout(),/Connection unavailable/);
 assert.equal(api.signedIn(),false);
 release(Response.json({signedIn:true}));await stale;
 assert.equal(api.signedIn(),false);
});
