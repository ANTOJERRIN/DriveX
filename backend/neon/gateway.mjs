export async function dispatch(pool,user,action,payload){
 if(!user||user.emailVerified!==true||typeof user.id!=='string'||!user.id||typeof user.email!=='string'||!user.email) {
  throw Object.assign(Error('Sign in with a verified email first.'),{status:401});
 }
 const db=await pool.connect();
 try {
  await db.query('begin');
  const {rows:[identity]}=await db.query(`insert into auth.users(provider_subject,email,raw_user_meta_data)
   values($1,lower($2),jsonb_build_object('name',$3::text))
   on conflict(provider_subject) do update set email=excluded.email returning id`,
   [user.id,user.email,String(user.name||user.email.split('@')[0]).slice(0,100)]);
  await db.query("select set_config('drivex.verified_uid',$1,true)",[identity.id]);
  await db.query('set local role authenticated');
  const {rows:[row]}=await db.query('select public.drivex($1,$2::jsonb) as result',[action,JSON.stringify(payload)]);
  await db.query('commit');
  return row.result;
 } catch(error){await db.query('rollback');throw error;}
 finally{db.release();}
}
