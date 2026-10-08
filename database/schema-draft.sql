-- DriveX backend DESIGN DRAFT. Not applied or integration-tested.
-- Requires Supabase Auth and Postgres btree_gist. Run only in a dedicated project.
-- All money/booking writes are deliberately server-only until transactional
-- reservation and verified payment endpoints have been implemented and tested.
begin;
create extension if not exists btree_gist;
create table public.profiles (
 id uuid primary key references auth.users(id),
 name text not null check(length(trim(name)) > 0),
 phone text,
 role text not null default 'student' check(role in ('student','instructor','admin')),
 created_at timestamptz not null default now()
);
create table public.vehicles (
 id uuid primary key default gen_random_uuid(),
 reg_number text not null unique,
 model text not null,
 transmission text not null check(transmission in ('Manual','Automatic')),
 active boolean not null default true
);
create table public.bookings (
 id uuid primary key default gen_random_uuid(),
 student_id uuid not null references public.profiles(id),
 instructor_id uuid not null references public.profiles(id),
 vehicle_id uuid not null references public.vehicles(id),
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 status text not null default 'pending' check(status in ('pending','confirmed','completed','cancelled','expired')),
 expires_at timestamptz,
 amount_paise integer not null check(amount_paise > 0),
 created_at timestamptz not null default now(),
 check(ends_at = starts_at + interval '1 hour'),
 check(student_id <> instructor_id),
 check(status <> 'pending' or expires_at is not null),
 exclude using gist(instructor_id with =, tstzrange(starts_at,ends_at,'[)') with &&) where(status in ('pending','confirmed','completed')),
 exclude using gist(vehicle_id with =, tstzrange(starts_at,ends_at,'[)') with &&) where(status in ('pending','confirmed','completed')),
 exclude using gist(student_id with =, tstzrange(starts_at,ends_at,'[)') with &&) where(status in ('pending','confirmed','completed'))
);
create table public.payments (
 id uuid primary key default gen_random_uuid(),
 booking_id uuid not null references public.bookings(id),
 provider_order_id text not null,
 provider_payment_id text unique,
 amount_paise integer not null check(amount_paise > 0),
 currency text not null default 'INR' check(currency='INR'),
 status text not null check(status in ('created','paid','failed','refund_pending','refunded')),
 created_at timestamptz not null default now()
);
create table public.lesson_assessments (
 id uuid primary key default gen_random_uuid(),
 booking_id uuid not null unique references public.bookings(id),
 score integer not null check(score between 1 and 10),
 notes text not null check(length(trim(notes)) between 1 and 1500),
 created_at timestamptz not null default now()
);
create index bookings_student_idx on public.bookings(student_id);
create index bookings_instructor_idx on public.bookings(instructor_id);
create index payments_booking_idx on public.payments(booking_id);
-- app_metadata.app_role is assigned only by trusted administration.
-- It must be kept consistent with profiles.role; token role changes need refresh.
alter table public.profiles enable row level security;
alter table public.vehicles enable row level security;
alter table public.bookings enable row level security;
alter table public.payments enable row level security;
alter table public.lesson_assessments enable row level security;
revoke all on public.profiles,public.vehicles,public.bookings,public.payments,public.lesson_assessments from anon,authenticated;
grant select on public.profiles,public.vehicles,public.bookings,public.payments,public.lesson_assessments to authenticated;
grant update(name,phone) on public.profiles to authenticated;
grant all on public.profiles,public.vehicles,public.bookings,public.payments,public.lesson_assessments to service_role;
create policy profile_read on public.profiles for select to authenticated using (
 id=(select auth.uid()) or (select auth.jwt()->'app_metadata'->>'app_role')='admin'
 or exists(select 1 from public.bookings b where b.student_id=profiles.id and b.instructor_id=(select auth.uid()) and b.status in ('confirmed','completed'))
);
create policy profile_update on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));
create policy vehicle_read on public.vehicles for select to authenticated using(active or (select auth.jwt()->'app_metadata'->>'app_role')='admin');
create policy booking_read on public.bookings for select to authenticated using(
 student_id=(select auth.uid()) or (instructor_id=(select auth.uid()) and status in ('confirmed','completed')) or (select auth.jwt()->'app_metadata'->>'app_role')='admin'
);
create policy payment_read on public.payments for select to authenticated using(
 (select auth.jwt()->'app_metadata'->>'app_role')='admin' or exists(select 1 from public.bookings b where b.id=payments.booking_id and b.student_id=(select auth.uid()))
);
create policy assessment_read on public.lesson_assessments for select to authenticated using(exists(select 1 from public.bookings b where b.id=lesson_assessments.booking_id));
commit;
