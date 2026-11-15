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

// A separate restricted worker login can execute only these service RPCs.
// Browser requests never select an arbitrary SQL function or supply identity.
const serviceCalls = {
 register_payment_order: ['p_enrollment_id','p_order_id','p_amount_paise'],
 process_payment_event: ['p_order_id','p_payment_id','p_amount_paise','p_currency','p_event_id','p_status'],
 drivex_notification_jobs: ['action','payload'],
};
export async function serviceRpc(pool,name,body){
 if(!pool||!Object.hasOwn(serviceCalls,name))throw Object.assign(Error('Server operation unavailable.'),{status:503});
 const keys=serviceCalls[name];
 const values=keys.map(key=>key==='payload'?JSON.stringify(body[key]||{}):body[key]);
 const {rows:[row]}=await pool.query(`select public.${name}(${keys.map((_,i)=>'$'+(i+1)).join(',')}) as result`,values);
 return row.result;
}
