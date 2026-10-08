-- DriveX v3: Plans, Enrollments, Course Lessons, and Server Payment Confirmation
begin;

-- 1. Plans table
create table if not exists drivex_private.plans (
  id text primary key,
  name text not null,
  price_inr integer not null check (price_inr > 0),
  lesson_credits integer not null check (lesson_credits > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into drivex_private.plans (id, name, price_inr, lesson_credits)
values
  ('plan_10_day', '10-Day Plan', 1500, 10),
  ('plan_monthly', 'Monthly Plan', 4000, 30)
on conflict (id) do update set
  name = excluded.name,
  price_inr = excluded.price_inr,
  lesson_credits = excluded.lesson_credits;

-- 2. Instructor approval status on profiles
alter table drivex_private.profiles
  add column if not exists approval_status text not null default 'approved'
  check (approval_status in ('pending', 'approved', 'rejected'));

update drivex_private.profiles set approval_status = 'approved' where role in ('admin', 'student') and approval_status is null;

-- 3. Enrollments table
create table if not exists drivex_private.enrollments (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references drivex_private.profiles(id),
  plan_id text not null references drivex_private.plans(id),
  instructor_id uuid not null references drivex_private.profiles(id),
  credits_total integer not null check (credits_total > 0),
  credits_used integer not null default 0 check (credits_used >= 0 and credits_used <= credits_total),
  status text not null default 'pending_payment' check (status in ('pending_payment', 'active', 'finished')),
  created_at timestamptz not null default now(),
  activated_at timestamptz
);

create index if not exists idx_enrollments_learner on drivex_private.enrollments(learner_id);
create index if not exists idx_enrollments_instructor on drivex_private.enrollments(instructor_id);

-- 4. Course lessons and theory/practical syllabus
create table if not exists drivex_private.course_lessons (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('theory', 'practical')),
  title text not null check (length(trim(title)) between 2 and 200),
  youtube_url text,
  sort_order integer not null default 0
);

insert into drivex_private.course_lessons (kind, title, sort_order)
values
  ('theory', 'Traffic signs & Road markings', 1),
  ('theory', 'Right of way & Junction rules', 2),
  ('theory', 'Speed limits & Safe stopping distances', 3),
  ('theory', 'Parking maneuvers (Parallel, Perpendicular & Angular)', 4),
  ('theory', 'Night driving & Low visibility hazards', 5),
  ('theory', 'Highway & Expressways driving etiquette', 6),
  ('theory', 'Emergency vehicle handling & Breakdown protocols', 7),
  ('theory', 'Vehicle maintenance, tire care & dashboard symbols', 8),
  ('practical', 'Cockpit drill & basic vehicle controls', 1),
  ('practical', 'Starting, stopping & clutch/brake balance', 2),
  ('practical', 'Steering control, turning & roundabouts', 3),
  ('practical', 'Reversing, 3-point turns & incline hill start', 4),
  ('practical', 'City traffic navigation & test preparation', 5)
on conflict do nothing;

-- 5. Student progress
create table if not exists drivex_private.lesson_progress (
  learner_id uuid not null references drivex_private.profiles(id),
  lesson_id uuid not null references drivex_private.course_lessons(id),
  completed_at timestamptz not null default now(),
  marked_by uuid not null references drivex_private.profiles(id),
  primary key (learner_id, lesson_id)
);

-- 6. Webhook events (for idempotency)
create table if not exists drivex_private.webhook_events (
  event_id text primary key,
  provider text not null default 'razorpay',
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz not null default now()
);

-- 7. Payments enhancements for enrollments
alter table drivex_private.payments alter column booking_id drop not null;
alter table drivex_private.payments add column if not exists enrollment_id uuid references drivex_private.enrollments(id);
alter table drivex_private.payments add column if not exists provider text not null default 'manual';
alter table drivex_private.payments add column if not exists provider_order_id text;
alter table drivex_private.payments add column if not exists provider_payment_id text;
alter table drivex_private.payments add column if not exists paid_at timestamptz;

alter table drivex_private.payments drop constraint if exists payments_status_check;
alter table drivex_private.payments add constraint payments_status_check check (status in ('created', 'paid', 'failed', 'refund_pending', 'refunded'));

alter table drivex_private.payments drop constraint if exists payments_amount_paise_check;
alter table drivex_private.payments add constraint payments_amount_paise_check check (amount_paise > 0);

alter table drivex_private.bookings add column if not exists enrollment_id uuid references drivex_private.enrollments(id);
alter table drivex_private.bookings drop constraint if exists bookings_amount_paise_check;
alter table drivex_private.bookings alter column amount_paise set default 0;

-- 8. Row Level Security on all new tables
alter table drivex_private.plans enable row level security;
alter table drivex_private.enrollments enable row level security;
alter table drivex_private.course_lessons enable row level security;
alter table drivex_private.lesson_progress enable row level security;
alter table drivex_private.webhook_events enable row level security;

revoke all on drivex_private.plans from public, anon, authenticated;
revoke all on drivex_private.enrollments from public, anon, authenticated;
revoke all on drivex_private.course_lessons from public, anon, authenticated;
revoke all on drivex_private.lesson_progress from public, anon, authenticated;
revoke all on drivex_private.webhook_events from public, anon, authenticated;

-- 9. Server payment confirmation function
create or replace function public.confirm_payment_server(
  p_provider_order_id text,
  p_provider_payment_id text,
  p_amount_paise int,
  p_event_id text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_en drivex_private.enrollments;
  v_pl drivex_private.plans;
  v_expected_paise int;
begin
  if p_event_id is not null and exists (select 1 from drivex_private.webhook_events we where we.event_id = p_event_id) then
    return jsonb_build_object('status', 'success', 'idempotent', true);
  end if;

  select en.* into v_en
  from drivex_private.enrollments en
  join drivex_private.payments py on py.enrollment_id = en.id
  where py.provider_order_id = p_provider_order_id
  limit 1;

  if not found then
    select en.* into v_en
    from drivex_private.enrollments en
    where en.id::text = (
      select payload->>'enrollment_id'
      from drivex_private.webhook_events we
      where we.event_id = p_event_id
    ) limit 1;
  end if;

  if v_en.id is null then
    raise exception 'Enrollment order not found for order %', p_provider_order_id;
  end if;

  select * into v_pl from drivex_private.plans pl where pl.id = v_en.plan_id;
  v_expected_paise := v_pl.price_inr * 100;

  if p_amount_paise <> v_expected_paise then
    raise exception 'Invalid amount: received % paise, expected % paise', p_amount_paise, v_expected_paise;
  end if;

  if p_event_id is not null then
    insert into drivex_private.webhook_events(event_id, provider, payload)
    values (p_event_id, 'razorpay', jsonb_build_object('order_id', p_provider_order_id, 'payment_id', p_provider_payment_id, 'amount', p_amount_paise))
    on conflict (event_id) do nothing;
  end if;

  update drivex_private.enrollments
  set status = 'active', activated_at = now()
  where drivex_private.enrollments.id = v_en.id;

  update drivex_private.payments
  set status = 'paid', provider_payment_id = p_provider_payment_id, paid_at = now()
  where drivex_private.payments.enrollment_id = v_en.id and (drivex_private.payments.provider_order_id = p_provider_order_id or drivex_private.payments.status = 'created');

  return jsonb_build_object('status', 'success', 'enrollment_id', v_en.id);
end;$$;

revoke all on function public.confirm_payment_server(text, text, int, text) from public, anon, authenticated;
grant execute on function public.confirm_payment_server(text, text, int, text) to service_role;

-- 10. Update main dispatch function for all Plan-based actions
create or replace function drivex_private.dispatch(action text, payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_uid uuid := auth.uid();
  v_me drivex_private.profiles;
  v_result jsonb;
  v_target_id uuid;
  v_b drivex_private.bookings;
  v_en drivex_private.enrollments;
  v_pl drivex_private.plans;
  v_instructor_uuid uuid;
  v_car_uuid uuid;
  v_start_time timestamptz;
  v_ref_text text;
begin
  if v_uid is null then
    raise exception 'Please sign in.' using errcode = '42501';
  end if;

  insert into drivex_private.profiles(id, name, phone, role, approval_status)
  select
    id,
    left(coalesce(nullif(trim(raw_user_meta_data->>'name'), ''), split_part(email, '@', 1), 'Student'), 100),
    left(coalesce(raw_user_meta_data->>'phone', ''), 30),
    case when raw_user_meta_data->>'role' in ('instructor') then 'instructor' else 'student' end,
    case when raw_user_meta_data->>'role' = 'instructor' then 'pending' else 'approved' end
  from auth.users where id = v_uid
  on conflict (id) do nothing;

  select * into strict v_me from drivex_private.profiles where id = v_uid;

  if action in ('me', 'snapshot') then
    select jsonb_build_object(
      'me', to_jsonb(v_me),
      'plans', (select coalesce(jsonb_agg(to_jsonb(p) order by p.price_inr), '[]'::jsonb) from drivex_private.plans p where p.active),
      'active_enrollment', (
        select jsonb_build_object(
          'id', e.id,
          'plan_id', e.plan_id,
          'plan_name', plan_row.name,
          'instructor_id', e.instructor_id,
          'instructor_name', inst.name,
          'credits_total', e.credits_total,
          'credits_used', e.credits_used,
          'credits_remaining', (e.credits_total - e.credits_used),
          'status', e.status
        )
        from drivex_private.enrollments e
        join drivex_private.plans plan_row on plan_row.id = e.plan_id
        join drivex_private.profiles inst on inst.id = e.instructor_id
        where e.learner_id = v_uid and e.status = 'active'
        order by e.created_at desc limit 1
      ),
      'instructors', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'specialty', p.specialty,
          'phone', case when v_me.role = 'admin' or p.id = v_uid then p.phone else '' end,
          'approval_status', p.approval_status
        )), '[]'::jsonb)
        from drivex_private.profiles p
        where p.role = 'instructor' and (p.approval_status = 'approved' or v_me.role = 'admin')
      ),
      'vehicles', (select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) from drivex_private.vehicles v where v.active),
      'bookings', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', x.id,
          'student_id', x.student_id,
          'student', s.name,
          'student_phone', case when v_me.role = 'admin' or (v_me.role = 'instructor' and x.status in ('confirmed', 'completed')) then s.phone else '' end,
          'instructor', x.instructor_id,
          'vehicle', x.vehicle_id,
          'date', to_char(x.starts_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD'),
          'time', to_char(x.starts_at at time zone 'Asia/Kolkata', 'HH24:MI'),
          'ends_at', x.ends_at,
          'status', x.status,
          'score', x.score,
          'notes', x.notes
        ) order by x.starts_at desc), '[]'::jsonb)
        from drivex_private.bookings x
        join drivex_private.profiles s on s.id = x.student_id
        where v_me.role = 'admin' or x.student_id = v_uid or (x.instructor_id = v_uid and x.status in ('confirmed', 'completed'))
      )
    ) into v_result;
    return v_result;

  elsif action = 'plans_list' then
    select coalesce(jsonb_agg(to_jsonb(p) order by p.price_inr asc), '[]'::jsonb) into v_result
    from drivex_private.plans p where p.active;
    return v_result;

  elsif action = 'instructors_list' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'specialty', p.specialty
    )), '[]'::jsonb) into v_result
    from drivex_private.profiles p
    where p.role = 'instructor' and p.approval_status = 'approved';
    return v_result;

  elsif action = 'enroll' then
    if v_me.role <> 'student' then raise exception 'Only learners can enroll in plans.' using errcode = '42501'; end if;
    select * into v_pl from drivex_private.plans where drivex_private.plans.id = (payload->>'plan_id') and active;
    if not found then raise exception 'Plan not found.'; end if;
    v_instructor_uuid := (payload->>'instructor_id')::uuid;
    perform 1 from drivex_private.profiles where id = v_instructor_uuid and role = 'instructor' and approval_status = 'approved';
    if not found then raise exception 'Instructor not available.'; end if;

    insert into drivex_private.enrollments (learner_id, plan_id, instructor_id, credits_total, status)
    values (v_uid, v_pl.id, v_instructor_uuid, v_pl.lesson_credits, 'pending_payment')
    returning * into v_en;

    insert into drivex_private.payments (enrollment_id, amount_paise, status, reference, recorded_by, provider, provider_order_id)
    values (v_en.id, v_pl.price_inr * 100, 'created', 'order_' || v_en.id::text, v_uid, 'razorpay', 'order_' || v_en.id::text);

    return jsonb_build_object(
      'enrollment_id', v_en.id,
      'plan_name', v_pl.name,
      'price_inr', v_pl.price_inr,
      'amount_paise', v_pl.price_inr * 100,
      'status', v_en.status
    );

  elsif action = 'my_payments' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', py.id,
      'enrollment_id', py.enrollment_id,
      'plan_name', plan_tbl.name,
      'amount_inr', py.amount_paise / 100,
      'status', py.status,
      'paid_at', py.paid_at,
      'provider', py.provider
    ) order by py.created_at desc), '[]'::jsonb) into v_result
    from drivex_private.payments py
    left join drivex_private.enrollments en_tbl on en_tbl.id = py.enrollment_id
    left join drivex_private.plans plan_tbl on plan_tbl.id = en_tbl.plan_id
    where en_tbl.learner_id = v_uid or v_me.role = 'admin';
    return v_result;

  elsif action = 'dashboard' then
    select jsonb_build_object(
      'credits_remaining', coalesce((select (credits_total - credits_used) from drivex_private.enrollments where learner_id = v_uid and status = 'active' order by created_at desc limit 1), 0),
      'confirmed_count', (select count(*) from drivex_private.bookings where student_id = v_uid and status = 'confirmed'),
      'completed_count', (select count(*) from drivex_private.bookings where student_id = v_uid and status = 'completed'),
      'next_confirmed_lesson', (
        select jsonb_build_object(
          'id', b_row.id,
          'date', to_char(b_row.starts_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD'),
          'time', to_char(b_row.starts_at at time zone 'Asia/Kolkata', 'HH24:MI'),
          'instructor_name', ip.name
        )
        from drivex_private.bookings b_row
        join drivex_private.profiles ip on ip.id = b_row.instructor_id
        where b_row.student_id = v_uid and b_row.status = 'confirmed' and b_row.starts_at > now()
        order by b_row.starts_at asc limit 1
      ),
      'progress_percent', coalesce((
        select round(count(lp.lesson_id)::numeric / nullif(count(cl.id), 0) * 100)
        from drivex_private.course_lessons cl
        left join drivex_private.lesson_progress lp on lp.lesson_id = cl.id and lp.learner_id = v_uid
      ), 0)
    ) into v_result;
    return v_result;

  elsif action = 'availability' then
    v_instructor_uuid := (payload->>'instructor')::uuid;
    v_car_uuid := (payload->>'vehicle')::uuid;
    select jsonb_agg(jsonb_build_object(
      'time', t,
      'available', ts > now() and not exists (
        select 1 from drivex_private.bookings x
        where x.status in ('pending', 'confirmed', 'completed')
        and (x.status <> 'pending' or x.expires_at > now())
        and tstzrange(x.starts_at, x.ends_at, '[)') && tstzrange(ts, ts + interval '1 hour', '[)')
        and (x.student_id = v_uid or x.instructor_id = v_instructor_uuid or x.vehicle_id = v_car_uuid)
      )
    )) into v_result
    from (
      select t, ((payload->>'date') || 'T' || t || ':00+05:30')::timestamptz ts
      from unnest(array['08:00', '09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00']) t
    ) slots;
    return v_result;

  elsif action = 'reserve' then
    if v_me.role <> 'student' then raise exception 'Only students can book lessons.' using errcode = '42501'; end if;
    
    select * into v_en from drivex_private.enrollments
    where learner_id = v_uid and status = 'active' and (credits_total - credits_used) > 0
    order by created_at desc limit 1;
    if not found then raise exception 'Active plan with available lesson credits required to book.'; end if;

    if (payload->>'time') is null or (payload->>'time') <> all(array['08:00','09:00','10:00','11:00','14:00','15:00','16:00','17:00']) then
      raise exception 'Choose a valid lesson time.';
    end if;

    v_start_time := ((payload->>'date') || 'T' || (payload->>'time') || ':00+05:30')::timestamptz;
    if v_start_time is null or v_start_time <= now() or v_start_time > now() + interval '90 days' then
      raise exception 'Choose a future lesson within 90 days.';
    end if;

    v_instructor_uuid := v_en.instructor_id;
    v_car_uuid := (payload->>'vehicle')::uuid;

    perform 1 from drivex_private.vehicles where id = v_car_uuid and active for share;
    if not found then raise exception 'Vehicle is unavailable.'; end if;

    insert into drivex_private.bookings(student_id, instructor_id, vehicle_id, enrollment_id, starts_at, ends_at, status)
    values (v_uid, v_instructor_uuid, v_car_uuid, v_en.id, v_start_time, v_start_time + interval '1 hour', 'confirmed')
    returning * into v_b;

    return jsonb_build_object('id', v_b.id, 'status', v_b.status, 'starts_at', v_b.starts_at);

  elsif action in ('cancel_booking', 'cancel') then
    select * into v_b from drivex_private.bookings where id = (payload->>'booking')::uuid for update;
    if not found then raise exception 'Lesson not found.'; end if;
    if v_b.student_id <> v_uid and v_me.role <> 'admin' then raise exception 'Cannot cancel this lesson.' using errcode = '42501'; end if;
    if v_b.status <> 'confirmed' or v_b.starts_at <= now() then raise exception 'Only future confirmed lessons can be cancelled.'; end if;

    update drivex_private.bookings set status = 'cancelled' where id = v_b.id;
    return jsonb_build_object('id', v_b.id, 'status', 'cancelled');

  elsif action in ('complete_booking', 'assess') then
    select * into v_b from drivex_private.bookings where id = (payload->>'booking')::uuid for update;
    if not found then raise exception 'Lesson not found.'; end if;
    if v_me.role <> 'instructor' or v_b.instructor_id <> v_uid then raise exception 'Only assigned instructor can assess.' using errcode = '42501'; end if;
    if v_b.status <> 'confirmed' or v_b.ends_at > now() then raise exception 'Feedback available after lesson ends.'; end if;

    update drivex_private.bookings
    set status = 'completed', score = (payload->>'score')::int, notes = trim(payload->>'notes')
    where id = v_b.id;

    if v_b.enrollment_id is not null then
      update drivex_private.enrollments
      set credits_used = credits_used + 1,
          status = case when credits_used + 1 >= credits_total then 'finished' else 'active' end
      where id = v_b.enrollment_id;
    end if;

    return jsonb_build_object('id', v_b.id, 'status', 'completed');

  elsif action = 'my_lessons' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', cl.id,
      'kind', cl.kind,
      'title', cl.title,
      'youtube_url', cl.youtube_url,
      'completed', (lp.completed_at is not null),
      'completed_at', lp.completed_at
    ) order by cl.kind desc, cl.sort_order asc), '[]'::jsonb) into v_result
    from drivex_private.course_lessons cl
    left join drivex_private.lesson_progress lp on lp.lesson_id = cl.id and lp.learner_id = v_uid;
    return v_result;

  elsif action = 'mark_theory_done' then
    v_target_id := (payload->>'lesson_id')::uuid;
    perform 1 from drivex_private.course_lessons where id = v_target_id and kind = 'theory';
    if not found then raise exception 'Theory lesson not found.'; end if;

    insert into drivex_private.lesson_progress (learner_id, lesson_id, marked_by)
    values (v_uid, v_target_id, v_uid)
    on conflict do nothing;

    return jsonb_build_object('status', 'success');

  elsif action = 'mark_practical_done' then
    if v_me.role <> 'instructor' then raise exception 'Only instructor can mark practical lessons.' using errcode = '42501'; end if;
    v_target_id := (payload->>'lesson_id')::uuid;
    perform 1 from drivex_private.course_lessons where id = v_target_id and kind = 'practical';
    if not found then raise exception 'Practical lesson not found.'; end if;

    insert into drivex_private.lesson_progress (learner_id, lesson_id, marked_by)
    values ((payload->>'learner_id')::uuid, v_target_id, v_uid)
    on conflict do nothing;

    return jsonb_build_object('status', 'success');

  elsif action = 'instructor_overview' then
    if v_me.role <> 'instructor' then raise exception 'Instructor access required.' using errcode = '42501'; end if;
    select jsonb_build_object(
      'learners_count', (select count(distinct learner_id) from drivex_private.enrollments where instructor_id = v_uid and status = 'active'),
      'upcoming_lessons', (select count(*) from drivex_private.bookings where instructor_id = v_uid and status = 'confirmed' and starts_at > now()),
      'completed_lessons', (select count(*) from drivex_private.bookings where instructor_id = v_uid and status = 'completed')
    ) into v_result;
    return v_result;

  elsif action = 'instructor_learners' then
    if v_me.role <> 'instructor' then raise exception 'Instructor access required.' using errcode = '42501'; end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'learner_id', lp.id,
      'learner_name', lp.name,
      'phone', lp.phone,
      'plan_name', plan_tbl.name,
      'credits_used', en_row.credits_used,
      'credits_total', en_row.credits_total
    )), '[]'::jsonb) into v_result
    from drivex_private.enrollments en_row
    join drivex_private.profiles lp on lp.id = en_row.learner_id
    join drivex_private.plans plan_tbl on plan_tbl.id = en_row.plan_id
    where en_row.instructor_id = v_uid and en_row.status = 'active';
    return v_result;

  elsif action = 'admin_overview' then
    if v_me.role <> 'admin' then raise exception 'Admin access required.' using errcode = '42501'; end if;
    select jsonb_build_object(
      'total_learners', (select count(*) from drivex_private.profiles where role = 'student'),
      'total_instructors', (select count(*) from drivex_private.profiles where role = 'instructor'),
      'pending_instructors', (select count(*) from drivex_private.profiles where role = 'instructor' and approval_status = 'pending'),
      'active_enrollments', (select count(*) from drivex_private.enrollments where status = 'active')
    ) into v_result;
    return v_result;

  elsif action = 'admin_set_instructor_status' then
    if v_me.role <> 'admin' then raise exception 'Admin access required.' using errcode = '42501'; end if;
    v_target_id := (payload->>'instructor_id')::uuid;
    v_ref_text := trim(payload->>'status');
    if v_ref_text not in ('approved', 'rejected') then raise exception 'Invalid status'; end if;
    update drivex_private.profiles set approval_status = v_ref_text where id = v_target_id and role = 'instructor';
    return jsonb_build_object('id', v_target_id, 'status', v_ref_text);

  elsif action = 'admin_mark_paid' then
    if v_me.role <> 'admin' then raise exception 'Admin access required.' using errcode = '42501'; end if;
    v_target_id := (payload->>'enrollment_id')::uuid;
    update drivex_private.enrollments set status = 'active', activated_at = now() where id = v_target_id;
    update drivex_private.payments set status = 'paid', paid_at = now() where enrollment_id = v_target_id;
    return jsonb_build_object('id', v_target_id, 'status', 'active');

  elsif action = 'add_vehicle' then
    if v_me.role <> 'admin' then raise exception 'Admin access required.' using errcode = '42501'; end if;
    if coalesce(length(trim(payload->>'reg')), 0) not between 3 and 30 then raise exception 'Enter a registration number.'; end if;
    insert into drivex_private.vehicles(name, reg, transmission) values(trim(payload->>'name'), upper(regexp_replace(payload->>'reg', '\s', '', 'g')), payload->>'transmission') returning id into v_target_id;
    return jsonb_build_object('id', v_target_id);

  elsif action = 'add_instructor' then
    if v_me.role <> 'admin' then raise exception 'Admin access required.' using errcode = '42501'; end if;
    select id into v_target_id from auth.users where lower(email) = lower(trim(payload->>'email'));
    if v_target_id is null then raise exception 'This person must create a DriveX account first.'; end if;
    if v_target_id = v_uid then raise exception 'You cannot change your own admin role here.'; end if;
    insert into drivex_private.profiles(id, name, phone) select id, left(coalesce(nullif(raw_user_meta_data->>'name', ''), split_part(email, '@', 1)), 100), left(coalesce(raw_user_meta_data->>'phone', ''), 30) from auth.users where id = v_target_id on conflict(id) do nothing;
    update drivex_private.profiles set role = 'instructor', specialty = left(coalesce(nullif(trim(payload->>'specialty'), ''), 'Driving instructor'), 100), approval_status = 'approved' where id = v_target_id;
    return jsonb_build_object('id', v_target_id);

  else
    raise exception 'Unknown action: %', action;
  end if;
exception when exclusion_violation then
  raise exception 'This slot was just reserved. Choose another time.' using errcode = '23P01';
end;$$;

grant execute on function drivex_private.dispatch(text, jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
