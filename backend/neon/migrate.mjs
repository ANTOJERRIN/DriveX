import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';

export async function migrate(db) {
 const dir=new URL('../../supabase/migrations/',import.meta.url);
 await db.exec('begin');
 try {
  await db.exec("select pg_advisory_xact_lock(764753212)");
  await db.exec('create table if not exists public.drivex_neon_migrations(name text primary key); revoke all on public.drivex_neon_migrations from public');
  const names=(await readdir(dir)).filter(n=>n.endsWith('.sql')&&!n.endsWith('_notification_scheduler.sql')).sort();
  for(const [name,url] of [['neon_bootstrap',new URL('./bootstrap.sql',import.meta.url)],...names.map(n=>[n,new URL(n,dir)])]){
   if((await db.query('select name from public.drivex_neon_migrations where name=$1',[name])).rows.length)continue;
   const sql=(await readFile(url,'utf8')).replace(/^(?:--[^\n]*\n|\s)*begin;\s*/i,'').replace(/\bcommit;\s*$/i,'');
   await db.exec(sql);
   await db.query('insert into public.drivex_neon_migrations(name) values($1)',[name]);
  }
  await db.exec('commit');
 } catch(error){await db.exec('rollback');throw error;}
}

if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
 if(!process.env.MIGRATION_DATABASE_URL) throw Error('Set MIGRATION_DATABASE_URL for the dedicated Neon database.');
 const db=new pg.Client({connectionString:process.env.MIGRATION_DATABASE_URL});
 await db.connect();
 try{await migrate({query:db.query.bind(db),exec:db.query.bind(db)});console.log('DriveX Neon migrations applied.');}
 finally{await db.end();}
}
