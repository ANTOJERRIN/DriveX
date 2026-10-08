-- DriveX v2: Razorpay online checkout integration
begin;

alter table drivex_private.payments alter column recorded_by drop not null;
alter table drivex_private.payments add column if not exists gateway text not null default 'manual' check(gateway in ('manual','razorpay'));
alter table drivex_private.payments add column if not exists order_id text;

-- Replace/update the dispatch function to support online payments
create or replace function drivex_private.dispatch(action text,payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); me drivex_private.profiles; b drivex_private.bookings; result jsonb;
 start_time timestamptz; finish timestamptz; target uuid; instructor uuid; car uuid; ref text;
 p_order text; p_gateway text;
begin
 if uid is null and action not in ('confirm_online_payment') then
  raise exception 'Please sign in.' using errcode='42501';
 end if;

 if uid is not null then
  insert into drivex_private.profiles(id,name,phone)
  select id,left(coalesce(nullif(trim(raw_user_meta_data->>'name'),''),split_part(email,'@',1),'Student'),100),left(coalesce(raw_user_meta_data->>'phone',''),30)
  from auth.users where id=uid on conflict(id) do nothing;
  select * into strict me from drivex_private.profiles where id=uid;
 end if;

 if action='snapshot' then
  update drivex_private.bookings set status='expired' where status='pending' and expires_at<=now();
  select jsonb_build_object(
   'me',to_jsonb(me),
   'instructors',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'specialty',p.specialty,'phone',case when me.role='admin' or p.id=uid then p.phone else '' end)) from drivex_private.profiles p where p.role='instructor'),'[]'::jsonb),
   'vehicles',coalesce((select jsonb_agg(to_jsonb(v)) from drivex_private.vehicles v where v.active),'[]'::jsonb),
   'bookings',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'student_id',x.student_id,'student',s.name,'student_phone',case when me.role='admin' or (me.role='instructor' and x.status in ('confirmed','completed')) then s.phone else '' end,'instructor',x.instructor_id,'vehicle',x.vehicle_id,'date',to_char(x.starts_at at time zone 'Asia/Kolkata','YYYY-MM-DD'),'time',to_char(x.starts_at at time zone 'Asia/Kolkata','HH24:MI'),'ends_at',x.ends_at,'status',x.status,'amount',x.amount_paise/100,'expires_at',x.expires_at,'score',x.score,'notes',x.notes) order by x.starts_at desc) from drivex_private.bookings x join drivex_private.profiles s on s.id=x.student_id where me.role='admin' or x.student_id=uid or (x.instructor_id=uid and x.status in ('confirmed','completed'))),'[]'::jsonb),
   'payments',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'booking',p.booking_id,'amount',p.amount_paise/100,'status',p.status,'reference',p.reference,'gateway',p.gateway,'order_id',p.order_id,'refund_reference',p.refund_reference,'created_at',p.created_at) order by p.created_at desc) from drivex_private.payments p join drivex_private.bookings x on x.id=p.booking_id where me.role='admin' or x.student_id=uid),'[]'::jsonb)
  ) into result;return result;

 elsif action='availability' then
  if me.role<>'student' then raise exception 'Student access required.' using errcode='42501';end if;
  instructor:=(payload->>'instructor')::uuid;car:=(payload->>'vehicle')::uuid;
  select jsonb_agg(jsonb_build_object('time',t,'available',ts>now() and not exists(select 1 from drivex_private.bookings x where x.status in ('pending','confirmed','completed','cancellation_requested') and (x.status<>'pending' or x.expires_at>now()) and tstzrange(x.starts_at,x.ends_at,'[)')&&tstzrange(ts,ts+interval '1 hour','[)') and (x.student_id=uid or x.instructor_id=instructor or x.vehicle_id=car)))) into result
  from (select t,((payload->>'date')||'T'||t||':00+05:30')::timestamptz ts from unnest(array['08:00','09:00','10:00','11:00','14:00','15:00','16:00','17:00']) t) slots;
  return result;

 elsif action='reserve' then
  if me.role<>'student' then raise exception 'Only students can book lessons.' using errcode='42501';end if;
  if (payload->>'time') is null or (payload->>'time')<>all(array['08:00','09:00','10:00','11:00','14:00','15:00','16:00','17:00']) then raise exception 'Choose a valid lesson time.';end if;
  start_time:=((payload->>'date')||'T'||(payload->>'time')||':00+05:30')::timestamptz;
  if start_time is null or start_time<=now() or start_time>now()+interval '90 days' then raise exception 'Choose a future lesson within 90 days.';end if;
  instructor:=(payload->>'instructor')::uuid;car:=(payload->>'vehicle')::uuid;
  perform 1 from drivex_private.profiles where id=instructor and role='instructor' for share;
  if not found then raise exception 'Instructor is unavailable.';end if;
  perform 1 from drivex_private.vehicles where id=car and active for share;
  if not found then raise exception 'Vehicle is unavailable.';end if;
  update drivex_private.bookings set status='expired' where status='pending' and expires_at<=now();
  insert into drivex_private.bookings(student_id,instructor_id,vehicle_id,starts_at,ends_at) values(uid,instructor,car,start_time,start_time+interval '1 hour') returning * into b;
  return jsonb_build_object('id',b.id,'status',b.status,'expires_at',b.expires_at,'amount_paise',b.amount_paise);

 elsif action='get_order_details' then
  if me.role<>'student' then raise exception 'Student access required.' using errcode='42501';end if;
  select * into b from drivex_private.bookings where id=(payload->>'booking')::uuid and student_id=uid;
  if not found then raise exception 'Booking not found.';end if;
  if b.status<>'pending' or b.expires_at<=now() or b.starts_at<=now() then
   raise exception 'Reservation is expired or invalid.';
  end if;
  return jsonb_build_object(
   'booking_id',b.id,
   'amount_paise',b.amount_paise,
   'student_name',me.name,
   'student_phone',me.phone,
   'student_email',(select email from auth.users where id=uid)
  );

 elsif action='confirm_online_payment' then
  -- Invoked by webhook or service function
  select * into b from drivex_private.bookings where id=(payload->>'booking')::uuid for update;
  if not found then raise exception 'Lesson not found.';end if;
  ref:=trim(payload->>'payment_id');
  p_order:=trim(payload->>'order_id');
  if ref is null or length(ref)<3 then raise exception 'Invalid payment reference.';end if;

  -- Idempotency check: if already confirmed with this payment reference
  if b.status='confirmed' and exists(select 1 from drivex_private.payments where booking_id=b.id and reference=ref) then
   return jsonb_build_object('id',b.id,'status','confirmed','idempotent',true);
  end if;

  -- Expired hold check: if payment received after hold expired, flag for refund
  if b.status<>'pending' or b.expires_at<=now() or b.starts_at<=now() then
   insert into drivex_private.payments(booking_id,amount_paise,status,reference,gateway,order_id,recorded_by)
   values(b.id,b.amount_paise,'refund_pending',ref,'razorpay',p_order,null)
   on conflict(booking_id) do update set status='refund_pending',reference=ref,order_id=p_order;
   update drivex_private.bookings set status='cancellation_requested' where id=b.id;
   return jsonb_build_object('id',b.id,'status','refund_pending','reason','expired_hold');
  end if;

  -- Normal valid online payment
  insert into drivex_private.payments(booking_id,amount_paise,status,reference,gateway,order_id,recorded_by)
  values(b.id,b.amount_paise,'paid',ref,'razorpay',p_order,null);
  update drivex_private.bookings set status='confirmed' where id=b.id;
  return jsonb_build_object('id',b.id,'status','confirmed');

 elsif action in ('record_payment','cancel','record_refund','assess') then
  select * into b from drivex_private.bookings where id=(payload->>'booking')::uuid for update;
  if not found then raise exception 'Lesson not found.';end if;
  if action='record_payment' then
   if me.role<>'admin' then raise exception 'Admin access required.' using errcode='42501';end if;
   ref:=trim(payload->>'reference');
   if ref is null or length(ref) not between 3 and 120 then raise exception 'Enter the receipt or bank transaction reference.';end if;
   if b.status='confirmed' and exists(select 1 from drivex_private.payments where booking_id=b.id and reference=ref and status='paid') then return jsonb_build_object('id',b.id,'status','confirmed');end if;
   if b.status<>'pending' or b.expires_at<=now() or b.starts_at<=now() then raise exception 'Reservation expired or unavailable. Do not record a payment; arrange a new booking or return the funds.';end if;
   insert into drivex_private.payments(booking_id,amount_paise,status,reference,recorded_by,gateway) values(b.id,b.amount_paise,'paid',ref,uid,'manual');
   update drivex_private.bookings set status='confirmed' where id=b.id;
  elsif action='cancel' then
   if b.student_id<>uid and me.role<>'admin' then raise exception 'You cannot cancel this lesson.' using errcode='42501';end if;
   if b.status not in ('pending','confirmed') or b.starts_at<=now() then raise exception 'This lesson cannot be cancelled online. Contact the school.';end if;
   if b.status='pending' then update drivex_private.bookings set status='cancelled' where id=b.id;
   else update drivex_private.bookings set status='cancellation_requested' where id=b.id;update drivex_private.payments set status='refund_pending' where booking_id=b.id;end if;
  elsif action='record_refund' then
   if me.role<>'admin' then raise exception 'Admin access required.' using errcode='42501';end if;
   ref:=trim(payload->>'reference');
   if b.status<>'cancellation_requested' or ref is null or length(ref) not between 3 and 120 then raise exception 'Select a cancellation request and enter the actual refund receipt reference.';end if;
   update drivex_private.payments set status='refunded',refund_reference=ref,refunded_by=uid,refunded_at=now() where booking_id=b.id and status='refund_pending';
   if not found then raise exception 'No pending refund found.';end if;
   update drivex_private.bookings set status='cancelled' where id=b.id;
  else
   if me.role<>'instructor' or b.instructor_id<>uid then raise exception 'Only the assigned instructor can assess this lesson.' using errcode='42501';end if;
   if b.status<>'confirmed' or b.ends_at>now() then raise exception 'Feedback is available after a confirmed lesson ends.';end if;
   if (payload->>'score') is null or (payload->>'score')::integer not between 1 and 10 or coalesce(length(trim(payload->>'notes')),0) not between 1 and 1500 then raise exception 'Enter a score from 1 to 10 and lesson notes.';end if;
   update drivex_private.bookings set status='completed',score=(payload->>'score')::integer,notes=trim(payload->>'notes') where id=b.id;
  end if;
  return jsonb_build_object('id',b.id);
 elsif action='add_vehicle' then
  if me.role<>'admin' then raise exception 'Admin access required.' using errcode='42501';end if;
  if coalesce(length(trim(payload->>'reg')),0) not between 3 and 30 then raise exception 'Enter a registration number.';end if;
  insert into drivex_private.vehicles(name,reg,transmission) values(trim(payload->>'name'),upper(regexp_replace(payload->>'reg','\s','','g')),payload->>'transmission') returning id into target;
  return jsonb_build_object('id',target);
 elsif action='add_instructor' then
  if me.role<>'admin' then raise exception 'Admin access required.' using errcode='42501';end if;
  select id into target from auth.users where lower(email)=lower(trim(payload->>'email'));
  if target is null then raise exception 'This person must create a DriveX account first.';end if;
  if target=uid then raise exception 'You cannot change your own admin role here.';end if;
  insert into drivex_private.profiles(id,name,phone) select id,left(coalesce(nullif(raw_user_meta_data->>'name',''),split_part(email,'@',1)),100),left(coalesce(raw_user_meta_data->>'phone',''),30) from auth.users where id=target on conflict(id) do nothing;
  if exists(select 1 from drivex_private.profiles where id=target and role='admin') then raise exception 'Another administrator cannot be reassigned here.';end if;
  if exists(select 1 from drivex_private.bookings where student_id=target and status in ('pending','confirmed','cancellation_requested')) then raise exception 'Resolve this student’s active bookings before assigning an instructor role.';end if;
  update drivex_private.profiles set role='instructor',specialty=left(coalesce(nullif(trim(payload->>'specialty'),''),'Driving instructor'),100) where id=target;
  return jsonb_build_object('id',target);
 else raise exception 'Unknown action.';
 end if;
exception when exclusion_violation then raise exception 'This slot was just reserved. Choose another time.' using errcode='23P01';
end;$$;

-- Grant execution to authenticated users and service_role (for webhook)
grant execute on function drivex_private.dispatch(text,jsonb) to authenticated;
commit;
