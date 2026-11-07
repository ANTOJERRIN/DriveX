-- Forward-only repair of the plan product. Never reapplies or edits 0001..0004.
begin;

alter table drivex_private.payments add column if not exists review_required boolean not null default false;
-- 0004 let browsers activate payments. Keep the ledger, but require actual receipt review.
update drivex_private.payments set review_required = true where provider = 'direct'
 or (status='paid' and provider_payment_id is null and provider_order_id='order_'||enrollment_id::text);
-- 0004 auto-approved every instructor. Require a fresh administrator decision.
update drivex_private.profiles set approval_status = 'pending' where role = 'instructor';
-- Preserve these records for review; do not advertise invented fleet as real inventory.
update drivex_private.vehicles set active = false
where (reg, name) in (('KA01DX1001','Hyundai i20'),('KA01DX1002','Maruti Swift'),('KA01DX1003','Tata Altroz'));

create unique index if not exists payments_provider_order_unique on drivex_private.payments(provider_order_id) where provider_order_id is not null;
create unique index if not exists payments_provider_payment_unique on drivex_private.payments(provider_payment_id) where provider_payment_id is not null;
create unique index if not exists payments_enrollment_unique on drivex_private.payments(enrollment_id) where enrollment_id is not null;
create index if not exists bookings_enrollment_status on drivex_private.bookings(enrollment_id, status);

create or replace function drivex_private.create_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into drivex_private.profiles(id,name,phone,role,approval_status,specialty)
  values(new.id, left(coalesce(nullif(trim(new.raw_user_meta_data->>'name'),''),split_part(new.email,'@',1),'User'),100),
    left(coalesce(new.raw_user_meta_data->>'phone',''),30),
    case when new.raw_user_meta_data->>'role' = 'instructor' then 'instructor' else 'student' end,
    case when new.raw_user_meta_data->>'role' = 'instructor' then 'pending' else 'approved' end,
    left(coalesce(nullif(trim(new.raw_user_meta_data->>'specialty'),''),'Driving instructor'),100))
  on conflict(id) do nothing;
  return new;
end; $$;
-- New name so no applied trigger or historical data has to be removed.
create trigger drivex_product_profile after insert on auth.users for each row execute function drivex_private.create_profile();
revoke all on function drivex_private.create_profile() from public,anon,authenticated;

create or replace function drivex_private.lessons_for(p_learner uuid) returns jsonb
language sql stable set search_path = '' as $$
select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'title',c.title,'youtube_url',c.youtube_url,
 'sort_order',c.sort_order,'completed',p.completed_at is not null,'completed_at',p.completed_at) order by c.kind desc,c.sort_order),'[]'::jsonb)
from drivex_private.course_lessons c left join drivex_private.lesson_progress p on p.lesson_id=c.id and p.learner_id=p_learner;
$$;
revoke all on function drivex_private.lessons_for(uuid) from public,anon,authenticated;

-- Only Edge Functions may bind provider orders. A browser can never supply its own paid/order state.
create or replace function public.register_payment_order(p_enrollment_id uuid,p_order_id text,p_amount_paise int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e drivex_private.enrollments; p drivex_private.payments;
begin
 select * into strict e from drivex_private.enrollments where id=p_enrollment_id for update;
 select * into strict p from drivex_private.payments where enrollment_id=e.id for update;
 if e.status <> 'pending_payment' or p.status not in ('created','failed') then raise exception 'Enrollment is already paid or closed.'; end if;
 if p_order_id is null or p_order_id !~ '^order_[A-Za-z0-9]+$' then raise exception 'Invalid provider order.'; end if;
 if p_amount_paise is distinct from p.amount_paise then raise exception 'Invalid amount.'; end if;
 -- Concurrent requests reuse the first stored order; never expose an unbound order to checkout.
 if p.provider_order_id is null or p.provider_order_id = 'order_' || e.id::text then
   update drivex_private.payments set provider_order_id=p_order_id,provider='razorpay',gateway='razorpay' where id=p.id;
   p.provider_order_id := p_order_id;
 end if;
 return jsonb_build_object('order_id',p.provider_order_id,'amount',p.amount_paise,'currency','INR');
end; $$;
revoke all on function public.register_payment_order(uuid,text,int) from public,anon,authenticated;
grant execute on function public.register_payment_order(uuid,text,int) to service_role;

create or replace function public.process_payment_event(p_order_id text,p_payment_id text,p_amount_paise int,p_currency text,p_event_id text,p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e drivex_private.enrollments; p drivex_private.payments; previous jsonb;
begin
 if nullif(trim(p_event_id),'') is null or nullif(trim(p_payment_id),'') is null or p_status is null or p_status not in ('paid','failed') then raise exception 'Invalid payment event.'; end if;
 -- Lock enrollment before payment everywhere, including manual receipts and refunds.
 select en.* into e from drivex_private.enrollments en join drivex_private.payments py on py.enrollment_id=en.id
 where py.provider_order_id=p_order_id for update of en;
 if not found then raise exception 'Enrollment order not found.'; end if;
 select * into strict p from drivex_private.payments where enrollment_id=e.id for update;
 if p_currency is distinct from 'INR' or p_amount_paise is distinct from p.amount_paise then raise exception 'Invalid amount or currency.'; end if;
 select payload into previous from drivex_private.webhook_events where event_id=p_event_id;
 if found then
   if previous->>'order_id' is distinct from p_order_id or previous->>'payment_id' is distinct from p_payment_id or previous->>'status' is distinct from p_status then raise exception 'Event ID already used for another payment.'; end if;
   return jsonb_build_object('status','success','idempotent',true);
 end if;
 if p.status in ('paid','refunded','refund_pending') then
   if p_status='paid' and p.provider_payment_id is distinct from p_payment_id then raise exception 'A different payment already settled this enrollment.'; end if;
 else
   if e.status <> 'pending_payment' then raise exception 'Enrollment is closed.'; end if;
   if p_status='paid' then
     update drivex_private.payments set status='paid',provider_payment_id=p_payment_id,paid_at=now(),review_required=false where id=p.id;
     update drivex_private.enrollments set status='active',activated_at=now() where id=e.id;
   else
     update drivex_private.payments set status='failed' where id=p.id;
   end if;
 end if;
 insert into drivex_private.webhook_events(event_id,payload) values(p_event_id,jsonb_build_object('order_id',p_order_id,'payment_id',p_payment_id,'status',p_status));
 return jsonb_build_object('status','success','enrollment_id',e.id,'idempotent',p.status in ('paid','refunded','refund_pending'));
end; $$;
revoke all on function public.process_payment_event(text,text,int,text,text,text) from public,anon,authenticated;
grant execute on function public.process_payment_event(text,text,int,text,text,text) to service_role;

create or replace function public.confirm_payment_server(p_provider_order_id text,p_provider_payment_id text,p_amount_paise int,p_event_id text)
returns jsonb language sql security invoker set search_path = '' as $$
 select public.process_payment_event(p_provider_order_id,p_provider_payment_id,p_amount_paise,'INR',p_event_id,'paid');
$$;
revoke all on function public.confirm_payment_server(text,text,int,text) from public,anon,authenticated;
grant execute on function public.confirm_payment_server(text,text,int,text) to service_role;

create or replace function drivex_private.dispatch(action text,payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 u uuid := auth.uid(); me drivex_private.profiles; e drivex_private.enrollments; p drivex_private.payments;
 b drivex_private.bookings; plan drivex_private.plans; result jsonb; target uuid; inst uuid; car uuid;
 start_time timestamptz; ref text; reserved int; requested_date date;
begin
 if u is null then raise exception 'Please sign in.' using errcode='42501'; end if;
 -- Backfill pre-trigger accounts once; metadata can never update a protected role.
 insert into drivex_private.profiles(id,name,phone,role,approval_status)
 select id,left(coalesce(nullif(trim(raw_user_meta_data->>'name'),''),split_part(email,'@',1),'User'),100),left(coalesce(raw_user_meta_data->>'phone',''),30),
 case when raw_user_meta_data->>'role'='instructor' then 'instructor' else 'student' end,
 case when raw_user_meta_data->>'role'='instructor' then 'pending' else 'approved' end
 from auth.users where id=u on conflict(id) do nothing;
 select * into strict me from drivex_private.profiles where id=u;
 if action in ('set_my_role','pay_enrollment','confirm_payment','confirm_online_payment') then
   raise exception 'Roles and payment status can only be changed by the server.' using errcode='42501';
 end if;
 if me.role='instructor' and me.approval_status <> 'approved' then
   if action in ('me','snapshot') then return jsonb_build_object('me',to_jsonb(me)); end if;
   raise exception 'Instructor approval required.' using errcode='42501';
 end if;
 if action in ('snapshot','me','instructor_schedule') then
   if action='instructor_schedule' and me.role <> 'instructor' then raise exception 'Instructor access required.' using errcode='42501'; end if;
   update drivex_private.bookings set status='expired' where status='pending' and expires_at<=now();
   select jsonb_build_object(
    'me',to_jsonb(me),
    'plans',(select coalesce(jsonb_agg(to_jsonb(x) order by x.price_inr),'[]'::jsonb) from drivex_private.plans x where x.active),
    'active_enrollment',(select jsonb_build_object('id',en.id,'plan_id',en.plan_id,'plan_name',pl.name,'instructor_id',en.instructor_id,'instructor_name',ip.name,
      'credits_total',en.credits_total,'credits_used',en.credits_used,'credits_remaining',en.credits_total-en.credits_used,
      'credits_reserved',(select count(*) from drivex_private.bookings x where x.enrollment_id=en.id and x.status in ('confirmed','cancellation_requested')),
      'status',en.status,'review_required',py.review_required)
      from drivex_private.enrollments en join drivex_private.plans pl on pl.id=en.plan_id join drivex_private.profiles ip on ip.id=en.instructor_id
      join drivex_private.payments py on py.enrollment_id=en.id where en.learner_id=u and en.status='active' order by en.created_at desc limit 1),
    'instructors',(select coalesce(jsonb_agg(jsonb_build_object('id',ip.id,'name',ip.name,'specialty',ip.specialty,'approval_status',ip.approval_status,
      'phone',case when me.role='admin' or ip.id=u then ip.phone else '' end) order by ip.name),'[]'::jsonb)
      from drivex_private.profiles ip where ip.role='instructor' and (ip.approval_status='approved' or me.role='admin')),
    'vehicles',(select coalesce(jsonb_agg(to_jsonb(v) order by v.name),'[]'::jsonb) from drivex_private.vehicles v where v.active or me.role='admin'),
    'bookings',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'student_id',x.student_id,'student',sp.name,
      'student_phone',case when me.role in ('admin','instructor') then sp.phone else '' end,'instructor',x.instructor_id,'instructor_name',ip.name,
      'vehicle',x.vehicle_id,'vehicle_name',v.name,'enrollment_id',x.enrollment_id,'date',to_char(x.starts_at at time zone 'Asia/Kolkata','YYYY-MM-DD'),
      'time',to_char(x.starts_at at time zone 'Asia/Kolkata','HH24:MI'),'starts_at',x.starts_at,'ends_at',x.ends_at,'status',x.status,'score',x.score,'notes',x.notes)
      order by x.starts_at desc),'[]'::jsonb) from drivex_private.bookings x join drivex_private.profiles sp on sp.id=x.student_id
      join drivex_private.profiles ip on ip.id=x.instructor_id join drivex_private.vehicles v on v.id=x.vehicle_id
      where me.role='admin' or (me.role='student' and x.student_id=u) or (me.role='instructor' and x.instructor_id=u and x.status in ('confirmed','completed')))
   ) into result;
   if action='instructor_schedule' then return result->'bookings'; end if;
   return result;
 elsif action='plans_list' then
   return (select coalesce(jsonb_agg(to_jsonb(x) order by x.price_inr),'[]'::jsonb) from drivex_private.plans x where active);
 elsif action='instructors_list' then
   return (drivex_private.dispatch('snapshot','{}'::jsonb))->'instructors';
 elsif action='enroll' then
   if me.role <> 'student' then raise exception 'Only learners can enroll in plans.' using errcode='42501'; end if;
   perform 1 from drivex_private.profiles where id=u for update;
   select * into e from drivex_private.enrollments where learner_id=u and status in ('active','pending_payment') order by created_at desc limit 1;
   if found then
     if e.status='active' then raise exception 'Finish your active plan before buying another.'; end if;
     if e.plan_id is distinct from payload->>'plan_id' or e.instructor_id is distinct from (payload->>'instructor_id')::uuid then raise exception 'Resume payment for your pending plan first.'; end if;
   else
     select * into plan from drivex_private.plans where id=payload->>'plan_id' and active;
     if not found then raise exception 'Plan not found.'; end if;
     inst := (payload->>'instructor_id')::uuid;
     perform 1 from drivex_private.profiles where id=inst and role='instructor' and approval_status='approved' for share;
     if not found then raise exception 'Instructor not available: approval required.'; end if;
     insert into drivex_private.enrollments(learner_id,plan_id,instructor_id,credits_total) values(u,plan.id,inst,plan.lesson_credits) returning * into e;
     insert into drivex_private.payments(enrollment_id,amount_paise,status,reference,recorded_by,provider)
     values(e.id,plan.price_inr*100,'created','enrollment_'||e.id,u,'razorpay');
   end if;
   select * into strict p from drivex_private.payments where enrollment_id=e.id;
   return jsonb_build_object('enrollment_id',e.id,'price_inr',p.amount_paise/100,'amount_paise',p.amount_paise,'status',e.status);
 elsif action='get_checkout' then
   if me.role <> 'student' then raise exception 'Learner access required.' using errcode='42501'; end if;
   select * into e from drivex_private.enrollments where id=(payload->>'enrollment_id')::uuid and learner_id=u;
   if not found then raise exception 'Enrollment not found.' using errcode='42501'; end if;
   if e.status <> 'pending_payment' then raise exception 'Enrollment is already paid or closed.'; end if;
   select * into strict p from drivex_private.payments where enrollment_id=e.id;
   return jsonb_build_object('enrollment_id',e.id,'amount_paise',p.amount_paise,'order_id',case when p.provider_order_id='order_'||e.id::text then null else p.provider_order_id end);
 elsif action in ('my_payments','instructor_earnings') then
   if action='instructor_earnings' and me.role <> 'instructor' then raise exception 'Instructor access required.' using errcode='42501'; end if;
   if action='my_payments' and me.role not in ('student','admin') then raise exception 'Learner or admin access required.' using errcode='42501'; end if;
   select coalesce(jsonb_agg(jsonb_build_object('id',py.id,'enrollment_id',en.id,'plan_name',pl.name,'learner_name',case when me.role='instructor' then split_part(sp.name,' ',1) else sp.name end,
    'instructor_name',ip.name,'instructor_id',ip.id,'amount_inr',py.amount_paise/100,'status',py.status,'paid_at',py.paid_at,'created_at',py.created_at,
    'reference',py.reference,'provider',py.provider,'review_required',py.review_required,'refund_reference',py.refund_reference) order by py.created_at desc),'[]'::jsonb)
    from drivex_private.payments py join drivex_private.enrollments en on en.id=py.enrollment_id join drivex_private.plans pl on pl.id=en.plan_id
    join drivex_private.profiles sp on sp.id=en.learner_id join drivex_private.profiles ip on ip.id=en.instructor_id
    where (action='my_payments' and (me.role='admin' or en.learner_id=u)) or (action='instructor_earnings' and en.instructor_id=u and py.status='paid' and not py.review_required)
   into result;
   if action='my_payments' then
     result := result || (select coalesce(jsonb_agg(jsonb_build_object('id',py.id,'enrollment_id',null,'booking_id',x.id,'legacy',true,
       'plan_name','Legacy lesson receipt','learner_name',sp.name,'instructor_name',ip.name,'amount_inr',py.amount_paise/100,
       'status',py.status,'paid_at',py.paid_at,'created_at',py.created_at,'reference',py.reference,'review_required',py.review_required,
       'provider',py.provider,'refund_reference',py.refund_reference) order by py.created_at desc),'[]'::jsonb)
       from drivex_private.payments py join drivex_private.bookings x on x.id=py.booking_id
       join drivex_private.profiles sp on sp.id=x.student_id join drivex_private.profiles ip on ip.id=x.instructor_id
       where py.enrollment_id is null and (me.role='admin' or x.student_id=u));
   end if;
   return result;
 elsif action in ('availability','reserve') then
   if me.role <> 'student' then raise exception 'Only learners can book lessons.' using errcode='42501'; end if;
   select * into e from drivex_private.enrollments where learner_id=u and status='active' order by created_at desc limit 1 for update;
   if not found then raise exception 'Buy a plan to book: active plan required.'; end if;
   perform 1 from drivex_private.payments where enrollment_id=e.id and status='paid' and not review_required;
   if not found then raise exception 'Plan payment needs administrator review.'; end if;
   select count(*) into reserved from drivex_private.bookings where enrollment_id=e.id and status in ('confirmed','cancellation_requested');
   if e.credits_total-e.credits_used-reserved <= 0 then raise exception 'All remaining credits are reserved. Complete or cancel a lesson first.'; end if;
   inst := e.instructor_id;
   perform 1 from drivex_private.profiles where id=inst and role='instructor' and approval_status='approved' for share;
   if not found then raise exception 'Your instructor is awaiting approval. Contact the school.'; end if;
   car := (payload->>'vehicle')::uuid;
   perform 1 from drivex_private.vehicles where id=car and active for share;
   if not found then raise exception 'Choose an active training vehicle. Contact the school if the fleet is empty.'; end if;
   requested_date := (payload->>'date')::date;
   if requested_date is null or requested_date < (now() at time zone 'Asia/Kolkata')::date or requested_date > (now() at time zone 'Asia/Kolkata')::date+90 then raise exception 'Choose a future lesson within 90 days.'; end if;
   update drivex_private.bookings set status='expired' where status='pending' and expires_at<=now();
   if action='availability' then
     return (select jsonb_agg(jsonb_build_object('time',t,'available',ts>now() and ts<=now()+interval '90 days' and not exists(
       select 1 from drivex_private.bookings x where x.status in ('pending','confirmed','completed','cancellation_requested')
       and tstzrange(x.starts_at,x.ends_at,'[)') && tstzrange(ts,ts+interval '1 hour','[)') and (x.student_id=u or x.instructor_id=inst or x.vehicle_id=car))) order by t)
       from (select t, (requested_date::text||'T'||t||':00+05:30')::timestamptz ts from unnest(array['08:00','09:00','10:00','11:00','14:00','15:00','16:00','17:00']) t) slots);
   end if;
   if payload->>'time' is null or payload->>'time' <> all(array['08:00','09:00','10:00','11:00','14:00','15:00','16:00','17:00']) then raise exception 'Choose a valid lesson time.'; end if;
   start_time := (requested_date::text||'T'||(payload->>'time')||':00+05:30')::timestamptz;
   if start_time<=now() or start_time>now()+interval '90 days' then raise exception 'Choose a future lesson within 90 days.'; end if;
   insert into drivex_private.bookings(student_id,instructor_id,vehicle_id,enrollment_id,starts_at,ends_at,status,amount_paise)
   values(u,inst,car,e.id,start_time,start_time+interval '1 hour','confirmed',0) returning * into b;
   return jsonb_build_object('id',b.id,'status',b.status,'starts_at',b.starts_at);
 elsif action in ('cancel','cancel_booking','assess','complete_booking') then
   -- Same lock order as reserve: enrollment, then booking.
   select enrollment_id into target from drivex_private.bookings where id=(payload->>'booking')::uuid;
   select * into e from drivex_private.enrollments where id=target for update;
   select * into b from drivex_private.bookings where id=(payload->>'booking')::uuid for update;
   if not found then raise exception 'Lesson not found.'; end if;
   if action in ('cancel','cancel_booking') then
     if me.role <> 'admin' and (me.role <> 'student' or b.student_id<>u) then raise exception 'Cannot cancel this lesson.' using errcode='42501'; end if;
     if b.status not in ('pending','confirmed') or b.starts_at<=now() then raise exception 'Only future reserved lessons can be cancelled.'; end if;
     select * into p from drivex_private.payments where booking_id=b.id and enrollment_id is null for update;
     if e.id is null and p.status='paid' then
       update drivex_private.bookings set status='cancellation_requested' where id=b.id;
       update drivex_private.payments set status='refund_pending' where id=p.id;
       return jsonb_build_object('id',b.id,'status','cancellation_requested');
     end if;
     update drivex_private.bookings set status='cancelled' where id=b.id;
     return jsonb_build_object('id',b.id,'status','cancelled');
   end if;
   if me.role<>'instructor' or b.instructor_id<>u then raise exception 'Only assigned instructor can assess.' using errcode='42501'; end if;
   if b.status='completed' then return jsonb_build_object('id',b.id,'status','completed','idempotent',true); end if;
   if b.status<>'confirmed' or b.ends_at>now() then raise exception 'Feedback available after lesson ends.'; end if;
   if (payload->>'score') is null or (payload->>'score')::int not between 1 and 10 or coalesce(length(trim(payload->>'notes')),0) not between 1 and 1500 then raise exception 'Enter a score from 1 to 10 and notes from 1 to 1500 characters.'; end if;
   if e.id is not null then
     perform 1 from drivex_private.payments where enrollment_id=e.id and status='paid' and not review_required;
     if not found then raise exception 'Plan payment needs administrator review.'; end if;
     if e.status<>'active' or e.credits_used>=e.credits_total then raise exception 'No lesson credits remain.'; end if;
     update drivex_private.enrollments set credits_used=credits_used+1,status=case when credits_used+1=credits_total then 'finished' else 'active' end where id=e.id;
   else
     perform 1 from drivex_private.payments where booking_id=b.id and status='paid' and not review_required;
     if not found then raise exception 'Legacy lesson receipt needs administrator review.'; end if;
   end if;
   update drivex_private.bookings set status='completed',score=(payload->>'score')::int,notes=trim(payload->>'notes') where id=b.id;
   return jsonb_build_object('id',b.id,'status','completed');
 elsif action in ('my_lessons','mark_theory_done') then
   if me.role<>'student' then raise exception 'Learner access required.' using errcode='42501'; end if;
   if action='my_lessons' then return drivex_private.lessons_for(u); end if;
   target := (payload->>'lesson_id')::uuid;
   perform 1 from drivex_private.course_lessons where id=target and kind='theory';
   if not found then raise exception 'Theory lesson not found.'; end if;
   insert into drivex_private.lesson_progress(learner_id,lesson_id,marked_by) values(u,target,u) on conflict do nothing;
   return jsonb_build_object('status','success');
 elsif action in ('learner_lessons','mark_practical_done') then
   if me.role<>'instructor' then raise exception 'Only instructor can mark practical lessons.' using errcode='42501'; end if;
   target := (payload->>'learner_id')::uuid;
   select en.* into e from drivex_private.enrollments en join drivex_private.payments py on py.enrollment_id=en.id
   where en.learner_id=target and en.status in ('active','finished') and py.status='paid' and not py.review_required
   order by en.activated_at desc nulls last,en.created_at desc limit 1;
   if e.id is null or e.instructor_id<>u then raise exception 'This learner is not assigned to you.' using errcode='42501'; end if;
   if action='learner_lessons' then return drivex_private.lessons_for(target); end if;
   perform 1 from drivex_private.course_lessons where id=(payload->>'lesson_id')::uuid and kind='practical';
   if not found then raise exception 'Practical lesson not found.'; end if;
   insert into drivex_private.lesson_progress(learner_id,lesson_id,marked_by) values(target,(payload->>'lesson_id')::uuid,u) on conflict do nothing;
   return jsonb_build_object('status','success');
 elsif action='dashboard' then
   if me.role<>'student' then raise exception 'Learner access required.' using errcode='42501'; end if;
   return jsonb_build_object('credits_remaining',coalesce((select credits_total-credits_used from drivex_private.enrollments where learner_id=u and status='active' order by created_at desc limit 1),0),
     'confirmed_count',(select count(*) from drivex_private.bookings where student_id=u and status='confirmed'),
     'completed_count',(select count(*) from drivex_private.bookings where student_id=u and status='completed'),
     'next_confirmed_lesson',(select jsonb_build_object('id',x.id,'date',to_char(x.starts_at at time zone 'Asia/Kolkata','YYYY-MM-DD'),
       'time',to_char(x.starts_at at time zone 'Asia/Kolkata','HH24:MI'),'instructor_name',ip.name)
       from drivex_private.bookings x join drivex_private.profiles ip on ip.id=x.instructor_id where x.student_id=u and x.status='confirmed' and x.starts_at>now() order by x.starts_at limit 1),
     'recent_lessons',coalesce((select jsonb_agg(to_jsonb(recent) order by recent.starts_at desc) from
       (select x.id,x.starts_at,x.ends_at,x.status,x.score,x.notes,ip.name as instructor_name from drivex_private.bookings x
        join drivex_private.profiles ip on ip.id=x.instructor_id where x.student_id=u order by x.starts_at desc limit 5) recent),'[]'::jsonb),
     'progress_percent',coalesce((select round(count(lp.lesson_id)*100.0/nullif(count(c.id),0)) from drivex_private.course_lessons c left join drivex_private.lesson_progress lp on lp.lesson_id=c.id and lp.learner_id=u),0));
 elsif action='instructor_learners' then
   if me.role<>'instructor' then raise exception 'Instructor access required.' using errcode='42501'; end if;
   return (select coalesce(jsonb_agg(jsonb_build_object('learner_id',sp.id,'learner_name',sp.name,'phone',sp.phone,'plan_name',pl.name,
    'credits_total',en.credits_total,'credits_remaining',en.credits_total-en.credits_used,'status',en.status,
    'lessons',drivex_private.lessons_for(sp.id)) order by sp.name),'[]'::jsonb)
    from drivex_private.enrollments en join drivex_private.profiles sp on sp.id=en.learner_id join drivex_private.plans pl on pl.id=en.plan_id
    where en.instructor_id=u and en.id=(select latest.id from drivex_private.enrollments latest
      join drivex_private.payments py on py.enrollment_id=latest.id where latest.learner_id=en.learner_id
      and latest.status in ('active','finished') and py.status='paid' and not py.review_required
      order by latest.activated_at desc nulls last,latest.created_at desc limit 1));
 elsif action='instructor_overview' then
   if me.role<>'instructor' then raise exception 'Instructor access required.' using errcode='42501'; end if;
   return jsonb_build_object('learners_count',(select count(distinct learner_id) from drivex_private.enrollments where instructor_id=u and status='active'),
    'today_lessons',(select count(*) from drivex_private.bookings where instructor_id=u and status='confirmed' and (starts_at at time zone 'Asia/Kolkata')::date=(now() at time zone 'Asia/Kolkata')::date),
    'upcoming_lessons',(select count(*) from drivex_private.bookings where instructor_id=u and status='confirmed' and starts_at>now()),
    'completed_lessons',(select count(*) from drivex_private.bookings where instructor_id=u and status='completed'),
    'total_earnings',(select coalesce(sum(py.amount_paise)/100,0) from drivex_private.payments py join drivex_private.enrollments en on en.id=py.enrollment_id where en.instructor_id=u and py.status='paid' and not py.review_required));
 elsif action like 'admin_%' or action in ('add_vehicle','add_instructor','record_refund') then
   if me.role<>'admin' then raise exception 'Admin access required.' using errcode='42501'; end if;
   if action='admin_overview' then
     return jsonb_build_object('total_learners',(select count(*) from drivex_private.profiles where role='student'),
      'total_instructors',(select count(*) from drivex_private.profiles where role='instructor'),
      'pending_instructors',(select count(*) from drivex_private.profiles where role='instructor' and approval_status='pending'),
      'active_enrollments',(select count(*) from drivex_private.enrollments where status='active'),
      'review_payments',(select count(*) from drivex_private.payments where review_required));
   elsif action='admin_instructors_pending' then
     return (select coalesce(jsonb_agg(to_jsonb(ip)),'[]'::jsonb) from drivex_private.profiles ip where role='instructor' and approval_status='pending');
   elsif action='admin_set_instructor_status' then
     if payload->>'status' is null or payload->>'status' not in ('approved','rejected') then raise exception 'Choose approved or rejected.'; end if;
     update drivex_private.profiles set approval_status=payload->>'status' where id=(payload->>'instructor_id')::uuid and role='instructor' returning id into target;
     if not found then raise exception 'Instructor not found.'; end if;
   elsif action in ('admin_mark_paid','admin_record_refund') then
     ref := trim(payload->>'reference');
     if coalesce(length(ref),0) not between 3 and 120 then raise exception 'Enter the actual receipt reference (3 to 120 characters).'; end if;
     select * into e from drivex_private.enrollments where id=(payload->>'enrollment_id')::uuid for update;
     if not found then raise exception 'Enrollment not found.'; end if;
     select * into strict p from drivex_private.payments where enrollment_id=e.id for update;
     target := e.id;
     if action='admin_mark_paid' then
       if p.status='paid' and not p.review_required and p.reference=ref then return jsonb_build_object('id',e.id,'status',e.status,'idempotent',true); end if;
       if p.status not in ('created','failed') and not p.review_required then raise exception 'Payment is already settled.'; end if;
       if p.provider_order_id is not null and p.provider_order_id <> 'order_'||e.id::text and not p.review_required then raise exception 'Online order exists. Wait for payment reconciliation.'; end if;
       update drivex_private.payments set status='paid',reference=ref,provider='manual',gateway='manual',recorded_by=u,paid_at=now(),review_required=false where id=p.id;
       update drivex_private.enrollments set status=case when credits_used=credits_total then 'finished' else 'active' end,activated_at=coalesce(activated_at,now()) where id=e.id;
     else
       if p.status='refunded' and p.refund_reference=ref then return jsonb_build_object('id',e.id,'status','refunded','idempotent',true); end if;
       if p.status<>'paid' or e.credits_used<>0 or exists(select 1 from drivex_private.bookings where enrollment_id=e.id and status in ('confirmed','cancellation_requested')) then raise exception 'Only an unused paid plan with no reserved lessons can have a full refund recorded.'; end if;
       update drivex_private.payments set status='refunded',refund_reference=ref,refunded_by=u,refunded_at=now() where id=p.id;
       update drivex_private.enrollments set status='finished' where id=e.id;
     end if;
   elsif action='record_refund' then
     ref := trim(payload->>'reference');
     if coalesce(length(ref),0) not between 3 and 120 then raise exception 'Enter the actual refund receipt reference.'; end if;
     select * into b from drivex_private.bookings where id=(payload->>'booking')::uuid and enrollment_id is null for update;
     if not found then raise exception 'Legacy lesson not found.'; end if;
     select * into p from drivex_private.payments where booking_id=b.id and enrollment_id is null for update;
     if p.status='refunded' and p.refund_reference=ref then return jsonb_build_object('id',b.id,'status','refunded','idempotent',true); end if;
     if b.status<>'cancellation_requested' or p.status is distinct from 'refund_pending' then raise exception 'No pending legacy refund found.'; end if;
     update drivex_private.payments set status='refunded',refund_reference=ref,refunded_by=u,refunded_at=now() where id=p.id;
     update drivex_private.bookings set status='cancelled' where id=b.id;
     target := b.id;
   elsif action='add_vehicle' then
     if coalesce(length(trim(payload->>'name')),0) not between 1 and 100 or coalesce(length(trim(payload->>'reg')),0) not between 3 and 30 then raise exception 'Enter vehicle name and registration.'; end if;
     insert into drivex_private.vehicles(name,reg,transmission) values(trim(payload->>'name'),upper(regexp_replace(payload->>'reg','\s','','g')),payload->>'transmission') returning id into target;
   elsif action='admin_set_vehicle_active' then
     update drivex_private.vehicles set active=(payload->>'active')::boolean where id=(payload->>'vehicle_id')::uuid returning id into target;
     if not found then raise exception 'Vehicle not found.'; end if;
   elsif action='add_instructor' then
     select id into target from auth.users where lower(email)=lower(trim(payload->>'email'));
     if target is null then raise exception 'This person must create a DriveX account first.'; end if;
     insert into drivex_private.profiles(id,name,phone) select id,left(coalesce(nullif(trim(raw_user_meta_data->>'name'),''),split_part(email,'@',1),'User'),100),
       left(coalesce(raw_user_meta_data->>'phone',''),30) from auth.users where id=target on conflict(id) do nothing;
     perform 1 from drivex_private.profiles where id=target for update;
     if exists(select 1 from drivex_private.profiles where id=target and role='admin') then raise exception 'Cannot change an administrator role.'; end if;
     if exists(select 1 from drivex_private.enrollments where learner_id=target and status in ('pending_payment','active')) then raise exception 'Finish learner enrollment before becoming an instructor.'; end if;
     update drivex_private.profiles set role='instructor',approval_status='approved',specialty=left(coalesce(nullif(trim(payload->>'specialty'),''),'Driving instructor'),100) where id=target;
   elsif action='admin_update_lesson' then
     ref := nullif(trim(payload->>'youtube_url'),'');
     if ref is not null and ref !~ '^https://(www\.)?(youtube\.com/watch\?v=[A-Za-z0-9_-]+|youtu\.be/[A-Za-z0-9_-]+)(&.*)?$' then raise exception 'Use a YouTube watch or youtu.be HTTPS link.'; end if;
     update drivex_private.course_lessons set youtube_url=ref where id=(payload->>'lesson_id')::uuid and kind='theory' returning id into target;
     if not found then raise exception 'Theory lesson not found.'; end if;
   elsif action='admin_lessons' then
     return drivex_private.lessons_for(null);
   else raise exception 'Unknown action: %',action;
   end if;
   return jsonb_build_object('id',target,'status','success');
 else raise exception 'Unknown action: %',action;
 end if;
exception when exclusion_violation then
 raise exception 'This slot was just reserved. Choose another time.' using errcode='23P01';
end; $$;
revoke all on function drivex_private.dispatch(text,jsonb) from public,anon,authenticated;
grant execute on function drivex_private.dispatch(text,jsonb) to authenticated;
revoke all on all tables in schema drivex_private from public,anon,authenticated;
revoke all on all sequences in schema drivex_private from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
