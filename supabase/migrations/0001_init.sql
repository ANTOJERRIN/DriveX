-- DriveX v1. Apply once to a dedicated Supabase project.
-- No sample records. All persistent operations are authorized in one transaction.
begin;
create extension if not exists btree_gist;
create schema drivex_private;
revoke all on schema drivex_private from public,anon,authenticated;
grant usage on schema drivex_private to authenticated;
create table drivex_private.profiles(
 id uuid primary key references auth.users(id),name text not null check(length(trim(name)) between 1 and 100),
 phone text not null default '',role text not null default 'student' check(role in ('student','instructor','admin')),
 specialty text not null default 'Driving instructor',created_at timestamptz not null default now()
);
create table drivex_private.vehicles(
 id uuid primary key default gen_random_uuid(),name text not null check(length(trim(name)) between 1 and 100),
 reg text not null unique,transmission text not null check(transmission in ('Manual','Automatic')),active boolean not null default true
);
create table drivex_private.bookings(
 id uuid primary key default gen_random_uuid(),student_id uuid not null references drivex_private.profiles(id),
 instructor_id uuid not null references drivex_private.profiles(id),vehicle_id uuid not null references drivex_private.vehicles(id),
 starts_at timestamptz not null,ends_at timestamptz not null,
 status text not null default 'pending' check(status in ('pending','confirmed','completed','cancelled','expired','cancellation_requested')),
 expires_at timestamptz not null default now()+interval '30 minutes',amount_paise integer not null default 80000 check(amount_paise=80000),
 score integer check(score between 1 and 10),notes text,created_at timestamptz not null default now(),
 check(student_id<>instructor_id),check(ends_at=starts_at+interval '1 hour'),
 check((status='completed' and score is not null and length(trim(notes)) between 1 and 1500) or (status<>'completed' and score is null and notes is null)),
 exclude using gist(instructor_id with =,tstzrange(starts_at,ends_at,'[)') with &&) where(status in ('pending','confirmed','completed','cancellation_requested')),
 exclude using gist(vehicle_id with =,tstzrange(starts_at,ends_at,'[)') with &&) where(status in ('pending','confirmed','completed','cancellation_requested')),
 exclude using gist(student_id with =,tstzrange(starts_at,ends_at,'[)') with &&) where(status in ('pending','confirmed','completed','cancellation_requested'))
);
create table drivex_private.payments(
 id uuid primary key default gen_random_uuid(),booking_id uuid not null unique references drivex_private.bookings(id),
 amount_paise integer not null check(amount_paise=80000),status text not null check(status in ('paid','refund_pending','refunded')),
 reference text not null unique check(length(trim(reference)) between 3 and 120),recorded_by uuid not null references drivex_private.profiles(id),
 refund_reference text,refunded_by uuid references drivex_private.profiles(id),created_at timestamptz not null default now(),refunded_at timestamptz
);
create index on drivex_private.bookings(student_id);
create index on drivex_private.bookings(instructor_id);
alter table drivex_private.profiles enable row level security;
alter table drivex_private.vehicles enable row level security;
alter table drivex_private.bookings enable row level security;
alter table drivex_private.payments enable row level security;
revoke all on all tables in schema drivex_private from public,anon,authenticated;
-- SECURITY DEFINER is limited to this non-exposed dispatcher. Every call checks
-- auth.uid(), resolves roles from protected rows, and validates each operation.
-- Browser roles cannot read or write tables directly, including their role.
create function drivex_private.dispatch(action text,payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); me drivex_private.profiles; b drivex_private.bookings; result jsonb;
 start_time timestamptz; finish timestamptz; target uuid; instructor uuid; car uuid; ref text;
begin
 if uid is null then raise exception 'Please sign in.' using errcode='42501'; end if;
 insert into drivex_private.profiles(id,name,phone)
 select id,left(coalesce(nullif(trim(raw_user_meta_data->>'name'),''),split_part(email,'@',1),'Student'),100),left(coalesce(raw_user_meta_data->>'phone',''),30)
 from auth.users where id=uid on conflict(id) do nothing;
 select * into strict me from drivex_private.profiles where id=uid;
 if action='snapshot' then
  update drivex_private.bookings set status='expired' where status='pending' and expires_at<=now();
  select jsonb_build_object(
   'me',to_jsonb(me),
   'instructors',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'specialty',p.specialty,'phone',case when me.role='admin' or p.id=uid then p.phone else '' end)) from drivex_private.profiles p where p.role='instructor'),'[]'::jsonb),
   'vehicles',coalesce((select jsonb_agg(to_jsonb(v)) from drivex_private.vehicles v where v.active),'[]'::jsonb),
   'bookings',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'student_id',x.student_id,'student',s.name,'student_phone',case when me.role='admin' or (me.role='instructor' and x.status in ('confirmed','completed')) then s.phone else '' end,'instructor',x.instructor_id,'vehicle',x.vehicle_id,'date',to_char(x.starts_at at time zone 'Asia/Kolkata','YYYY-MM-DD'),'time',to_char(x.starts_at at time zone 'Asia/Kolkata','HH24:MI'),'ends_at',x.ends_at,'status',x.status,'amount',x.amount_paise/100,'expires_at',x.expires_at,'score',x.score,'notes',x.notes) order by x.starts_at desc) from drivex_private.bookings x join drivex_private.profiles s on s.id=x.student_id where me.role='admin' or x.student_id=uid or (x.instructor_id=uid and x.status in ('confirmed','completed'))),'[]'::jsonb),
   'payments',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'booking',p.booking_id,'amount',p.amount_paise/100,'status',p.status,'reference',p.reference,'refund_reference',p.refund_reference,'created_at',p.created_at) order by p.created_at desc) from drivex_private.payments p join drivex_private.bookings x on x.id=p.booking_id where me.role='admin' or x.student_id=uid),'[]'::jsonb)
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
  return jsonb_build_object('id',b.id,'status',b.status,'expires_at',b.expires_at);
 elsif action in ('record_payment','cancel','record_refund','assess') then
  select * into b from drivex_private.bookings where id=(payload->>'booking')::uuid for update;
  if not found then raise exception 'Lesson not found.';end if;
  if action='record_payment' then
   if me.role<>'admin' then raise exception 'Admin access required.' using errcode='42501';end if;
   ref:=trim(payload->>'reference');
   if ref is null or length(ref) not between 3 and 120 then raise exception 'Enter the receipt or bank transaction reference.';end if;
   if b.status='confirmed' and exists(select 1 from drivex_private.payments where booking_id=b.id and reference=ref and status='paid') then return jsonb_build_object('id',b.id,'status','confirmed');end if;
   if b.status<>'pending' or b.expires_at<=now() or b.starts_at<=now() then raise exception 'Reservation expired or unavailable. Do not record a payment; arrange a new booking or return the funds.';end if;
   insert into drivex_private.payments(booking_id,amount_paise,status,reference,recorded_by) values(b.id,b.amount_paise,'paid',ref,uid);
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
revoke all on function drivex_private.dispatch(text,jsonb) from public,anon,authenticated;
grant execute on function drivex_private.dispatch(text,jsonb) to authenticated;
create function public.drivex(action text,payload jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path='' as $$select drivex_private.dispatch(action,payload);$$;
revoke all on function public.drivex(text,jsonb) from public,anon,authenticated;
grant execute on function public.drivex(text,jsonb) to authenticated;
commit;
