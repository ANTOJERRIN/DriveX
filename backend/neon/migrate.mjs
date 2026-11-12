import { readdir, readFile } from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import pg from 'pg';

export async function migrationFiles() {
 const dir=new URL('../../supabase/migrations/',import.meta.url);
 const names=(await readdir(dir)).filter(n=>n.endsWith('.sql')&&!n.endsWith('_notification_scheduler.sql')).sort();
 return [['neon_bootstrap',new URL('./bootstrap.sql',import.meta.url)],...names.map(n=>[n,new URL(n,dir)])];
}
export async function pendingMigrations(db) {
 const files=await migrationFiles();
 const exists=(await db.query("select to_regclass('public.drivex_neon_migrations') as ledger")).rows[0].ledger;
 if(!exists){
  const state=(await db.query("select to_regnamespace('auth') as auth_schema,to_regnamespace('drivex_private') as app_schema")).rows[0];
  if(state.auth_schema||state.app_schema)throw Error('Existing schemas without a DriveX Neon migration ledger. Review/import migration history before continuing.');
  return files;
 }
 const applied=new Set((await db.query('select name from public.drivex_neon_migrations')).rows.map(r=>r.name));
 const known=new Set(files.map(([name])=>name));
 for(const name of applied)if(!known.has(name))throw Error('Unknown applied migration: '+name+'. Review history before continuing.');
 return files.filter(([name])=>!applied.has(name));
}
export async function migrate(db) {
 await db.exec('begin');
 try {
  await db.exec('select pg_advisory_xact_lock(764753212)');
  const pending=await pendingMigrations(db);
  await db.exec('create table if not exists public.drivex_neon_migrations(name text primary key); revoke all on public.drivex_neon_migrations from public');
  for(const [name,url] of pending){
   const sql=(await readFile(url,'utf8')).replace(/^(?:--[^\n]*\n|\s)*begin;\s*/i,'').replace(/\bcommit;\s*$/i,'');
   await db.exec(sql);
   await db.query('insert into public.drivex_neon_migrations(name) values($1)',[name]);
  }
  await db.exec('commit');
 } catch(error){await db.exec('rollback');throw error;}
}
export async function runMigrationCommand({args=process.argv.slice(2),env=process.env,connect,log=console.log}={}){
 if(args.length!==1||!['--dry-run','--apply'].includes(args[0]))throw Error('Use --dry-run to inspect or --apply to execute the reviewed migration plan.');
 if(!env.MIGRATION_DATABASE_URL)throw Error('Set MIGRATION_DATABASE_URL privately for the dedicated Neon database.');
 const db=await connect(env.MIGRATION_DATABASE_URL);
 try{
  // A read-only transaction prevents the inspection command from creating schema objects.
  await db.exec('begin read only');
  let pending;
  try{pending=await pendingMigrations(db);await db.exec('commit');}catch(error){await db.exec('rollback');throw error;}
  log('Pending Neon migrations: '+pending.length);
  for(const [name] of pending)log(name);
  if(args[0]==='--apply'){await migrate(db);log('DriveX Neon migrations applied.');}
  else log('Dry run only; no database changes applied.');
 }finally{await db.end();}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 try{
  await runMigrationCommand({connect:async connectionString=>{
   const client=new pg.Client({connectionString,connectionTimeoutMillis:10000});
   await client.connect();
   return {query:client.query.bind(client),exec:client.query.bind(client),end:client.end.bind(client)};
  }});
 }catch(error){
  // Database driver errors can contain host/user information. Print only our validation errors.
  const safe=/^(Use --|Set MIGRATION_|Existing schemas|Unknown applied migration)/.test(error.message);
  console.error(safe?error.message:'Neon migration failed. Check private connection settings and database access.');
  process.exitCode=1;
 }
}
