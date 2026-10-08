-- DriveX Verification Script
-- Run this in the Supabase SQL Editor to verify schema state

select 'plans table exists' as check_name,
  exists (select 1 from information_schema.tables where table_schema = 'drivex_private' and table_name = 'plans') as ok
union all
select 'enrollments table exists' as check_name,
  exists (select 1 from information_schema.tables where table_schema = 'drivex_private' and table_name = 'enrollments') as ok
union all
select 'course_lessons table exists' as check_name,
  exists (select 1 from information_schema.tables where table_schema = 'drivex_private' and table_name = 'course_lessons') as ok
union all
select 'drivex RPC exists in public' as check_name,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'drivex') as ok
union all
select 'confirm_payment_server exists in public' as check_name,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'confirm_payment_server') as ok
union all
select 'plans seeded correctly (1500 and 4000 INR)' as check_name,
  ((select price_inr from drivex_private.plans where id = 'plan_10_day') = 1500 and
   (select price_inr from drivex_private.plans where id = 'plan_monthly') = 4000) as ok
union all
select 'course_lessons seeded (13 total: 8 theory, 5 practical)' as check_name,
  ((select count(*) from drivex_private.course_lessons) = 13) as ok
union all
select 'exclusion constraints exist on bookings' as check_name,
  (select count(*) >= 3 from pg_constraint where conname like '%bookings%excl%' or conrelid = 'drivex_private.bookings'::regclass and contype = 'x') as ok;
