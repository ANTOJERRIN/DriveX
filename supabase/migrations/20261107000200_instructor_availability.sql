begin;
create table drivex_private.instructor_hours (
 id uuid primary key default gen_random_uuid(),
 instructor_id uuid not null references drivex_private.profiles(id),
 weekday integer not null check(weekday between 0 and 6),
 start_minute integer not null check(start_minute between 0 and 1380 and start_minute%30=0),
 end_minute integer not null check(end_minute between 60 and 1440 and end_minute%30=0),
 check(end_minute-start_minute>=60),
 exclude using gist(instructor_id with =,weekday with =,int4range(start_minute,end_minute,'[)') with &&)
);
create table drivex_private.instructor_blocked_dates (
 instructor_id uuid not null references drivex_private.profiles(id),
 blocked_date date not null,
 reason text not null default '' check(length(reason)<=200),
 primary key(instructor_id,blocked_date)
);
alter table drivex_private.instructor_hours enable row level security;
alter table drivex_private.instructor_blocked_dates enable row level security;
revoke all on drivex_private.instructor_hours,drivex_private.instructor_blocked_dates from public,anon,authenticated;

-- Preserve the previous daily offering until the school edits each instructor's week.
insert into drivex_private.instructor_hours(instructor_id,weekday,start_minute,end_minute)
select p.id,d,opening,closing from drivex_private.profiles p cross join generate_series(0,6) d
cross join (values(480,720),(840,1080)) windows(opening,closing) where p.role='instructor';
create function drivex_private.seed_instructor_hours() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.role='instructor' and (tg_op='INSERT' or old.role is distinct from 'instructor') then
  insert into drivex_private.instructor_hours(instructor_id,weekday,start_minute,end_minute)
  select new.id,d,opening,closing from generate_series(0,6) d cross join (values(480,720),(840,1080)) windows(opening,closing)
  where not exists(select 1 from drivex_private.instructor_hours where instructor_id=new.id);
 end if;
 return new;
end; $$;
create trigger drivex_seed_instructor_hours after insert or update of role on drivex_private.profiles
for each row execute function drivex_private.seed_instructor_hours();
revoke all on function drivex_private.seed_instructor_hours() from public,anon,authenticated;

create function drivex_private.instructor_slots(p_instructor uuid,p_date date) returns table(starts_at timestamptz)
language sql stable set search_path='' as $$
 select (p_date::timestamp+make_interval(mins=>minute)) at time zone 'Asia/Kolkata'
 from drivex_private.instructor_hours h cross join lateral generate_series(h.start_minute,h.end_minute-60,60) minute
 where h.instructor_id=p_instructor and h.weekday=extract(dow from p_date)::int
 order by minute;
$$;
revoke all on function drivex_private.instructor_slots(uuid,date) from public,anon,authenticated;

alter function drivex_private.dispatch(text,jsonb) rename to dispatch_before_availability;
revoke all on function drivex_private.dispatch_before_availability(text,jsonb) from public,anon,authenticated;
create function drivex_private.dispatch(action text,payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 u uuid:=auth.uid(); me drivex_private.profiles; en drivex_private.enrollments; b drivex_private.bookings;
 inst uuid; car uuid; day date; start_time timestamptz; reserved int; item jsonb; opening int; closing int; response jsonb;
begin
 if action not in ('working_hours','set_working_hours','set_blocked_date','availability','reserve') then
  return drivex_private.dispatch_before_availability(action,payload);
 end if;
 response:=drivex_private.dispatch_before_availability('me','{}');
 select * into strict me from drivex_private.profiles where id=u;
 if me.role='instructor' and me.approval_status<>'approved' then raise exception 'Instructor approval required.' using errcode='42501'; end if;
 if action in ('working_hours','set_working_hours','set_blocked_date') then
  if me.role not in ('admin','instructor') then raise exception 'Instructor or admin access required.' using errcode='42501'; end if;
  inst:=case when me.role='instructor' then u else (payload->>'instructor_id')::uuid end;
  if me.role='instructor' and payload->>'instructor_id' is not null and (payload->>'instructor_id')::uuid<>u then raise exception 'Cannot edit another instructor schedule.' using errcode='42501'; end if;
  -- Reservations take a shared lock on this same profile before looking at hours.
  perform 1 from drivex_private.profiles where id=inst and role='instructor' for update;
  if not found then raise exception 'Instructor not found.'; end if;
  if action='set_working_hours' then
   if jsonb_typeof(payload->'hours') is distinct from 'array' or jsonb_array_length(payload->'hours')>28 then raise exception 'Supply up to 28 weekly time windows.'; end if;
   delete from drivex_private.instructor_hours where instructor_id=inst;
   for item in select value from jsonb_array_elements(payload->'hours') loop
    if coalesce(item->>'start','') !~ '^([01][0-9]|2[0-3]):(00|30)$' or coalesce(item->>'end','') !~ '^(([01][0-9]|2[0-3]):(00|30)|24:00)$' then raise exception 'Use half-hour boundaries, for example 08:30 to 12:30.'; end if;
    opening:=split_part(item->>'start',':',1)::int*60+split_part(item->>'start',':',2)::int;
    closing:=split_part(item->>'end',':',1)::int*60+split_part(item->>'end',':',2)::int;
    if closing-opening<60 then raise exception 'Each teaching window must last at least one hour and end after it starts.'; end if;
    insert into drivex_private.instructor_hours(instructor_id,weekday,start_minute,end_minute)
    values(inst,(item->>'weekday')::int,opening,closing);
   end loop;
   if exists(select 1 from drivex_private.bookings x where x.instructor_id=inst and x.starts_at>now()
    and (x.status in ('confirmed','cancellation_requested') or (x.status='pending' and x.expires_at>now()))
    and not exists(select 1 from drivex_private.instructor_slots(inst,(x.starts_at at time zone 'Asia/Kolkata')::date) s where s.starts_at=x.starts_at)) then
     raise exception 'These hours conflict with an existing lesson. Cancel or resolve that lesson first.';
   end if;
  elsif action='set_blocked_date' then
   day:=(payload->>'date')::date;
   if day is null or day<(now() at time zone 'Asia/Kolkata')::date or day>(now() at time zone 'Asia/Kolkata')::date+365 then raise exception 'Choose a blocked date within the next year.'; end if;
   if jsonb_typeof(payload->'blocked') is distinct from 'boolean' then raise exception 'Choose whether the date is blocked.'; end if;
   if (payload->>'blocked')::boolean then
    if exists(select 1 from drivex_private.bookings x where x.instructor_id=inst and (x.starts_at at time zone 'Asia/Kolkata')::date=day
     and (x.status in ('confirmed','cancellation_requested') or (x.status='pending' and x.expires_at>now()))) then raise exception 'This date has an existing lesson. Cancel or resolve it first.'; end if;
    insert into drivex_private.instructor_blocked_dates(instructor_id,blocked_date,reason) values(inst,day,coalesce(trim(payload->>'reason'),''))
    on conflict(instructor_id,blocked_date) do update set reason=excluded.reason;
   else delete from drivex_private.instructor_blocked_dates where instructor_id=inst and blocked_date=day;
   end if;
  end if;
  return jsonb_build_object('instructor_id',inst,'hours',(select coalesce(jsonb_agg(jsonb_build_object('weekday',h.weekday,
   'start',lpad((h.start_minute/60)::text,2,'0')||':'||lpad((h.start_minute%60)::text,2,'0'),
   'end',lpad((h.end_minute/60)::text,2,'0')||':'||lpad((h.end_minute%60)::text,2,'0')) order by h.weekday,h.start_minute),'[]'::jsonb)
   from drivex_private.instructor_hours h where h.instructor_id=inst),
   'blocked_dates',(select coalesce(jsonb_agg(jsonb_build_object('date',d.blocked_date,'reason',d.reason) order by d.blocked_date),'[]'::jsonb)
   from drivex_private.instructor_blocked_dates d where d.instructor_id=inst and d.blocked_date>=(now() at time zone 'Asia/Kolkata')::date));
 end if;
 if me.role<>'student' then raise exception 'Only learners can book lessons.' using errcode='42501'; end if;
 select * into en from drivex_private.enrollments where learner_id=u and status='active' order by created_at desc limit 1 for update;
 if not found then raise exception 'Buy a plan to book: active plan required.'; end if;
 perform 1 from drivex_private.payments where enrollment_id=en.id and status='paid' and not review_required;
 if not found then raise exception 'Plan payment needs administrator review.'; end if;
 select count(*) into reserved from drivex_private.bookings where enrollment_id=en.id and status in ('confirmed','cancellation_requested');
 if en.credits_total-en.credits_used-reserved<=0 then raise exception 'All remaining credits are reserved. Complete or cancel a lesson first.'; end if;
 inst:=en.instructor_id;
 perform 1 from drivex_private.profiles where id=inst and role='instructor' and approval_status='approved' for share;
 if not found then raise exception 'Your instructor is awaiting approval. Contact the school.'; end if;
 car:=(payload->>'vehicle')::uuid;
 perform 1 from drivex_private.vehicles where id=car and active for share;
 if not found then raise exception 'Choose an active training vehicle. Contact the school if the fleet is empty.'; end if;
 day:=(payload->>'date')::date;
 if day is null or day<(now() at time zone 'Asia/Kolkata')::date or day>(now() at time zone 'Asia/Kolkata')::date+90 then raise exception 'Choose a future lesson within 90 days.'; end if;
 if exists(select 1 from drivex_private.instructor_blocked_dates where instructor_id=inst and blocked_date=day) then raise exception 'Your instructor has blocked this date. Choose another day.'; end if;
 update drivex_private.bookings set status='expired' where status='pending' and expires_at<=now();
 if action='availability' then
  return (select coalesce(jsonb_agg(jsonb_build_object('time',to_char(s.starts_at at time zone 'Asia/Kolkata','HH24:MI'),
   'available',s.starts_at>now() and s.starts_at<=now()+interval '90 days' and not exists(select 1 from drivex_private.bookings x
   where x.status in ('pending','confirmed','completed','cancellation_requested') and tstzrange(x.starts_at,x.ends_at,'[)')&&tstzrange(s.starts_at,s.starts_at+interval '1 hour','[)')
   and (x.student_id=u or x.instructor_id=inst or x.vehicle_id=car))) order by s.starts_at),'[]'::jsonb) from drivex_private.instructor_slots(inst,day) s);
 end if;
 if coalesce(payload->>'time','') !~ '^([01][0-9]|2[0-3]):(00|30)$' then raise exception 'Choose a valid lesson time.'; end if;
 start_time:=(day::text||'T'||(payload->>'time')||':00+05:30')::timestamptz;
 if start_time<=now() or start_time>now()+interval '90 days' then raise exception 'Choose a future lesson within 90 days.'; end if;
 if not exists(select 1 from drivex_private.instructor_slots(inst,day) s where s.starts_at=start_time) then raise exception 'Choose a valid lesson time within your instructor working hours.'; end if;
 insert into drivex_private.bookings(student_id,instructor_id,vehicle_id,enrollment_id,starts_at,ends_at,status,amount_paise)
 values(u,inst,car,en.id,start_time,start_time+interval '1 hour','confirmed',0) returning * into b;
 return jsonb_build_object('id',b.id,'status',b.status,'starts_at',b.starts_at);
exception when exclusion_violation then
 if action='set_working_hours' then raise exception 'Weekly time windows cannot overlap.'; end if;
 raise exception 'This slot was just reserved. Choose another time.' using errcode='23P01';
end; $$;
revoke all on function drivex_private.dispatch(text,jsonb) from public,anon,authenticated;
grant execute on function drivex_private.dispatch(text,jsonb) to authenticated;
create or replace function public.drivex(action text,payload jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select drivex_private.dispatch(action,payload); $$;
notify pgrst,'reload schema';
commit;
