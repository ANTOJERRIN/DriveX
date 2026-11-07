import { readdir,readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
export const ids={admin:'00000000-0000-0000-0000-000000000001',instructor:'00000000-0000-0000-0000-000000000002',student:'00000000-0000-0000-0000-000000000003',other:'00000000-0000-0000-0000-000000000004',instructor2:'00000000-0000-0000-0000-000000000005',pending:'00000000-0000-0000-0000-000000000006'};
export async function database({beforeRepair}={}) {
 const db=new PGlite({extensions:{btree_gist}});
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
 const directory=new URL('../../supabase/migrations/',import.meta.url);
 const migrations=(await readdir(directory)).filter(x=>x.endsWith('.sql')).sort();
 for(const name of migrations) {
  if(name==='20261107000100_product_completion.sql'&&beforeRepair)await beforeRepair(db);
  await db.exec(await readFile(new URL(name,directory),'utf8'));
 }
 for(const [name,id]of Object.entries(ids))await db.query('insert into auth.users values($1,$2,$3)',[id,name+'@example.test',JSON.stringify({name,phone:'test-only',role:name.startsWith('instructor')||name==='pending'?'instructor':'student'})]);
 await db.query("update drivex_private.profiles set role='admin' where id=$1",[ids.admin]);
 await db.query("update drivex_private.profiles set approval_status='approved' where id in ($1,$2)",[ids.instructor,ids.instructor2]);
 async function as(user,action,payload={}) {
  await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[user]||user||'']);await db.exec('set role '+(user?'authenticated':'anon'));
  return (await db.query('select public.drivex($1,$2) as result',[action,JSON.stringify(payload)])).rows[0].result;
 }
 async function server(name,args) {
  await db.exec('reset role;set role service_role');
  return (await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args)).rows[0].result;
 }
 const vehicle=(await as('admin','add_vehicle',{name:'Test school car',reg:'TEST123',transmission:'Manual'})).id;
 async function enroll(user='student',instructor='instructor',plan='plan_10_day') {return (await as(user,'enroll',{plan_id:plan,instructor_id:ids[instructor]})).enrollment_id;}
 async function paid(user='student',instructor='instructor',plan='plan_10_day') {const id=await enroll(user,instructor,plan);await as('admin','admin_mark_paid',{enrollment_id:id,reference:'receipt_'+id});return id;}
 return {db,as,server,vehicle,enroll,paid,migrations};
}
