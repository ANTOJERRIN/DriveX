import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { readFile } from 'node:fs/promises';
import { migrate } from '../backend/neon/migrate.mjs';
import { dispatch } from '../backend/neon/gateway.mjs';
import { createNeonApi } from '../dist/neon-api.mjs';

test('Neon bootstrap replays plan rules and binds each request to a verified identity',async()=>{
 const db=new PGlite({extensions:{btree_gist}});
 try{
  await migrate(db);await migrate(db);
  const checks=(await db.query(await readFile(new URL('../supabase/verify.sql',import.meta.url),'utf8'))).rows;
  assert.ok(checks.every(check=>check.ok),JSON.stringify(checks.filter(check=>!check.ok)));
  await db.exec('create role drivex_app login');
  await db.exec(await readFile(new URL('../backend/neon/runtime-grants.sql',import.meta.url),'utf8'));
  await db.exec('set role drivex_app');
  const pool={connect:async()=>({query:db.query.bind(db),release(){}})};
  const user={id:'neon-user-1',email:'learner@example.test',emailVerified:true,name:'Learner',role:'admin'};
  await assert.rejects(dispatch(pool,{...user,emailVerified:false},'snapshot',{}),/verified email/);
  const a=await dispatch(pool,user,'snapshot',{role:'admin'});
  const b=await dispatch(pool,{...user,id:'neon-user-2',email:'other@example.test'},'snapshot',{});
  assert.equal(a.me.role,'student');assert.notEqual(a.me.id,b.me.id);
  assert.equal((await dispatch(pool,user,'snapshot',{})).me.id,a.me.id);
  assert.equal((await db.query('select auth.uid() as uid')).rows[0].uid,null);
  await assert.rejects(db.query('select * from drivex_private.bookings'),/permission denied/);
  await assert.rejects(dispatch(pool,user,'add_vehicle',{name:'Car',reg:'TEST123',transmission:'Manual'}),/Admin access required/i);
 }finally{await db.close();}
});

test('Neon browser RPC sends no trusted user identity and clears expired sessions',async()=>{
 const calls=[];
 const api=createNeonApi({fetcher:async(path,options)=>{
  calls.push([path,options]);
  return path.endsWith('get-session')?Response.json({signedIn:true}):Response.json({message:'Sign in first.'},{status:401});
 }});
 assert.equal(await api.restoreSession(),true);
 await assert.rejects(api.rpc('snapshot'),/Sign in first/);
 assert.deepEqual(JSON.parse(calls[1][1].body),{action:'snapshot',payload:{}});
 assert.equal(calls[1][1].credentials,'same-origin');
 assert.equal(api.signedIn(),false);
});
