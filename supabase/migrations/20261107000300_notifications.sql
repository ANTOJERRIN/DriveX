begin;
create table drivex_private.notification_jobs (
 id uuid primary key default gen_random_uuid(),
 event text not null check(event in ('booking_confirmed','booking_cancelled','refund_recorded','lesson_reminder')),
 recipient_id uuid not null references drivex_private.profiles(id),
 booking_id uuid references drivex_private.bookings(id),
 payment_id uuid references drivex_private.payments(id),
 lesson_starts_at timestamptz,
 dedupe_key text not null unique,
 status text not null default 'pending' check(status in ('pending','processing','sent','dead','cancelled')),
 attempts integer not null default 0 check(attempts between 0 and 5),
 next_attempt_at timestamptz not null default now(),
 lease_until timestamptz,claim_token uuid,
 delivery jsonb,provider_id text,last_error text,
 created_at timestamptz not null default now(),sent_at timestamptz,
 check((event='refund_recorded' and payment_id is not null) or (event<>'refund_recorded' and booking_id is not null))
);
create index notification_jobs_due on drivex_private.notification_jobs(status,next_attempt_at);
create index notification_jobs_booking on drivex_private.notification_jobs(booking_id);
alter table drivex_private.notification_jobs enable row level security;
revoke all on drivex_private.notification_jobs from public,anon,authenticated;

create function drivex_private.enqueue_booking_notice(p_booking uuid,p_event text,p_due timestamptz) returns void
language plpgsql set search_path='' as $$
declare b drivex_private.bookings; recipient uuid;
begin
 select * into strict b from drivex_private.bookings where id=p_booking;
 foreach recipient in array array[b.student_id,b.instructor_id] loop
  insert into drivex_private.notification_jobs(event,recipient_id,booking_id,lesson_starts_at,dedupe_key,next_attempt_at)
  values(p_event,recipient,b.id,b.starts_at,p_event||':'||b.id||':'||extract(epoch from b.starts_at)::text||':'||recipient,p_due)
  on conflict(dedupe_key) do nothing;
 end loop;
end; $$;
revoke all on function drivex_private.enqueue_booking_notice(uuid,text,timestamptz) from public,anon,authenticated;

create function drivex_private.booking_notifications() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and (new.starts_at is distinct from old.starts_at or new.status='completed') then
  update drivex_private.notification_jobs set status='cancelled',claim_token=null,lease_until=null,delivery=null
  where booking_id=new.id and event in ('booking_confirmed','lesson_reminder') and status in ('pending','processing');
 end if;
 if new.status='confirmed' and (tg_op='INSERT' or old.status is distinct from 'confirmed' or old.starts_at is distinct from new.starts_at) then
  perform drivex_private.enqueue_booking_notice(new.id,'booking_confirmed',now());
  if new.starts_at>now()+interval '24 hours' then perform drivex_private.enqueue_booking_notice(new.id,'lesson_reminder',new.starts_at-interval '24 hours'); end if;
 end if;
 if new.status in ('cancelled','cancellation_requested') and (tg_op='INSERT' or old.status not in ('cancelled','cancellation_requested')) then
  update drivex_private.notification_jobs set status='cancelled',claim_token=null,lease_until=null,delivery=null
  where booking_id=new.id and event in ('booking_confirmed','lesson_reminder') and status in ('pending','processing');
  perform drivex_private.enqueue_booking_notice(new.id,'booking_cancelled',now());
 end if;
 return new;
end; $$;
create trigger drivex_booking_notifications after insert or update of status,starts_at on drivex_private.bookings
for each row execute function drivex_private.booking_notifications();
revoke all on function drivex_private.booking_notifications() from public,anon,authenticated;

create function drivex_private.refund_notifications() returns trigger
language plpgsql security definer set search_path='' as $$
declare recipient uuid;
begin
 if new.status='refunded' and (tg_op='INSERT' or old.status is distinct from 'refunded') then
  if new.enrollment_id is not null then select learner_id into recipient from drivex_private.enrollments where id=new.enrollment_id;
  else select student_id into recipient from drivex_private.bookings where id=new.booking_id;
  end if;
  insert into drivex_private.notification_jobs(event,recipient_id,payment_id,dedupe_key)
  values('refund_recorded',recipient,new.id,'refund_recorded:'||new.id||':'||recipient) on conflict(dedupe_key) do nothing;
 end if;
 return new;
end; $$;
create trigger drivex_refund_notifications after insert or update of status on drivex_private.payments
for each row execute function drivex_private.refund_notifications();
revoke all on function drivex_private.refund_notifications() from public,anon,authenticated;

create function drivex_private.enqueue_lesson_reminders() returns integer
language plpgsql set search_path='' as $$
declare b drivex_private.bookings; count_before integer;
begin
 select count(*) into count_before from drivex_private.notification_jobs where event='lesson_reminder';
 -- Catch up established bookings after scheduler downtime without duplicating immediate confirmations.
 for b in select * from drivex_private.bookings where status='confirmed' and starts_at>now()+interval '1 hour'
  and starts_at<=now()+interval '24 hours' and created_at<=now()-interval '1 hour' loop
  perform drivex_private.enqueue_booking_notice(b.id,'lesson_reminder',now());
 end loop;
 return (select count(*) from drivex_private.notification_jobs where event='lesson_reminder')-count_before;
end; $$;
revoke all on function drivex_private.enqueue_lesson_reminders() from public,anon,authenticated;

create function drivex_private.notification_delivery(p_job uuid) returns jsonb
language plpgsql set search_path='' as $$
declare q drivex_private.notification_jobs; b drivex_private.bookings; p drivex_private.payments; recipient_name text; recipient_email text;
begin
 select * into strict q from drivex_private.notification_jobs where id=p_job;
 select pr.name,au.email into recipient_name,recipient_email from drivex_private.profiles pr join auth.users au on au.id=pr.id
 where pr.id=q.recipient_id and au.email_confirmed_at is not null;
 if recipient_email is null then return null; end if;
 if q.event='refund_recorded' then
  select * into p from drivex_private.payments where id=q.payment_id and status='refunded';
  if not found then return null; end if;
  return jsonb_build_object('to',recipient_email,'name',recipient_name,'event',q.event,'amount_inr',p.amount_paise/100);
 end if;
 select * into b from drivex_private.bookings where id=q.booking_id;
 if b.id is null or b.starts_at is distinct from q.lesson_starts_at then return null; end if;
 if q.event in ('booking_confirmed','lesson_reminder') and (b.status<>'confirmed' or b.starts_at<=now()) then return null; end if;
 if q.event='booking_cancelled' and b.status not in ('cancelled','cancellation_requested') then return null; end if;
 return jsonb_build_object('to',recipient_email,'name',recipient_name,'event',q.event,
  'cancellation_pending',b.status='cancellation_requested',
  'date',to_char(b.starts_at at time zone 'Asia/Kolkata','DD Mon YYYY'),'time',to_char(b.starts_at at time zone 'Asia/Kolkata','HH24:MI'),
  'instructor_name',(select name from drivex_private.profiles where id=b.instructor_id),
  'vehicle_name',(select name from drivex_private.vehicles where id=b.vehicle_id));
end; $$;
revoke all on function drivex_private.notification_delivery(uuid) from public,anon,authenticated;

create function public.drivex_notification_jobs(action text,payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q drivex_private.notification_jobs; items jsonb:='[]'; content jsonb; token uuid; permanent boolean; code text;
begin
 if action='claim' then
  perform drivex_private.enqueue_lesson_reminders();
  update drivex_private.notification_jobs set status='dead',last_error='attempt_limit',claim_token=null,lease_until=null
   where status='processing' and lease_until<=now() and attempts>=5;
  for q in select * from drivex_private.notification_jobs where attempts<5 and next_attempt_at<=now()
    and (status='pending' or (status='processing' and lease_until<=now())) order by next_attempt_at,id limit 10 for update skip locked loop
   content:=drivex_private.notification_delivery(q.id);
   if content is null then
    update drivex_private.notification_jobs set status='cancelled',last_error='stale_or_unavailable_recipient',claim_token=null,lease_until=null,delivery=null where id=q.id;
    continue;
   end if;
   if q.delivery is not null and q.delivery->>'to' is distinct from content->>'to' then
    update drivex_private.notification_jobs set status='dead',last_error='recipient_changed',claim_token=null,lease_until=null where id=q.id;
    continue;
   end if;
   content:=coalesce(q.delivery,content);token:=gen_random_uuid();
   update drivex_private.notification_jobs set status='processing',attempts=attempts+1,claim_token=token,lease_until=now()+interval '5 minutes',delivery=content where id=q.id;
   items:=items||jsonb_build_array(jsonb_build_object('id',q.id,'claim_token',token,'delivery',content));
  end loop;
  return items;
 elsif action='finish' then
  select * into q from drivex_private.notification_jobs where id=(payload->>'id')::uuid for update;
  if not found or q.status<>'processing' or q.claim_token is distinct from (payload->>'claim_token')::uuid then return jsonb_build_object('status','stale'); end if;
  if jsonb_typeof(payload->'success') is distinct from 'boolean' then raise exception 'A result is required.'; end if;
  if (payload->>'success')::boolean then
   if coalesce(length(payload->>'provider_id'),0) not between 1 and 200 then raise exception 'Provider receipt required.'; end if;
   update drivex_private.notification_jobs set status='sent',sent_at=now(),provider_id=payload->>'provider_id',claim_token=null,lease_until=null,delivery=null,last_error=null where id=q.id;
   return jsonb_build_object('status','sent');
  end if;
  code:=case when payload->>'error' in ('provider_failure','provider_throttled','invalid_recipient','network_error') then payload->>'error' else 'provider_failure' end;
  permanent:=coalesce((payload->>'permanent')::boolean,false);
  update drivex_private.notification_jobs set status=case when permanent or attempts>=5 then 'dead' else 'pending' end,
    next_attempt_at=now()+make_interval(secs=>least(3600,60*power(2,attempts-1))::int),last_error=code,claim_token=null,lease_until=null where id=q.id;
  return jsonb_build_object('status',case when permanent or q.attempts>=5 then 'dead' else 'pending' end);
 end if;
 raise exception 'Unknown notification worker action.';
end; $$;
revoke all on function public.drivex_notification_jobs(text,jsonb) from public,anon,authenticated;
grant execute on function public.drivex_notification_jobs(text,jsonb) to service_role;

create function drivex_private.notification_scheduler_state() returns jsonb language plpgsql set search_path='' as $$
declare installed boolean:=false; configured boolean:=false;
begin
 if to_regclass('cron.job') is not null then execute 'select exists(select 1 from cron.job where jobname=$1)' into installed using 'drivex-notifications'; end if;
 if to_regclass('vault.decrypted_secrets') is not null then
  execute $sql$select exists(select 1 from vault.decrypted_secrets where name='drivex_notification_url'
    and decrypted_secret ~ '^https://[a-z0-9-]+\.supabase\.co/functions/v1/notification-worker$')
    and exists(select 1 from vault.decrypted_secrets where name='drivex_notification_token' and length(decrypted_secret)>=32)$sql$ into configured;
 end if;
 return jsonb_build_object('installed',installed,'worker_configured',configured);
end; $$;
revoke all on function drivex_private.notification_scheduler_state() from public,anon,authenticated;

alter function drivex_private.dispatch(text,jsonb) rename to dispatch_with_availability;
revoke all on function drivex_private.dispatch_with_availability(text,jsonb) from public,anon,authenticated;
create function drivex_private.dispatch(action text,payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare profile jsonb; target uuid;
begin
 if action not in ('notification_status','retry_notification') then return drivex_private.dispatch_with_availability(action,payload); end if;
 profile:=drivex_private.dispatch_with_availability('me','{}');
 if profile->'me'->>'role' is distinct from 'admin' then raise exception 'Admin access required.' using errcode='42501'; end if;
 if action='retry_notification' then
  update drivex_private.notification_jobs set status='pending',attempts=0,next_attempt_at=now(),claim_token=null,lease_until=null,last_error=null
  where id=(payload->>'id')::uuid and status='dead' and last_error is distinct from 'recipient_changed' returning id into target;
  if not found then raise exception 'Only failed notifications with an unchanged recipient can be retried.'; end if;
  return jsonb_build_object('id',target,'status','pending');
 end if;
 return jsonb_build_object('counts',(select jsonb_build_object('pending',count(*) filter(where status='pending'),
  'due',count(*) filter(where status='pending' and next_attempt_at<=now()),'sent',count(*) filter(where status='sent'),
  'failed',count(*) filter(where status='dead'),'processing',count(*) filter(where status='processing')) from drivex_private.notification_jobs),
  'scheduler',drivex_private.notification_scheduler_state(),'jobs',(select coalesce(jsonb_agg(to_jsonb(recent) order by recent.created_at desc),'[]'::jsonb) from
   (select id,event,status,attempts,next_attempt_at,created_at,last_error from drivex_private.notification_jobs order by created_at desc limit 30) recent));
end; $$;
revoke all on function drivex_private.dispatch(text,jsonb) from public,anon,authenticated;
grant execute on function drivex_private.dispatch(text,jsonb) to authenticated;
create or replace function public.drivex(action text,payload jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select drivex_private.dispatch(action,payload); $$;
notify pgrst,'reload schema';
commit;
