-- Run after the product-completion migration. Every schema/security row must return true.
select 'private tables have RLS' as check_name,not exists(
 select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='drivex_private' and c.relkind='r' and not c.relrowsecurity) as ok
union all select 'browsers have no direct table privileges',not exists(
 select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='drivex_private' and c.relkind='r'
 and (has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE')))
union all select 'authenticated can use drivex',has_function_privilege('authenticated','public.drivex(text,jsonb)','EXECUTE')
union all select 'anonymous cannot use drivex',not has_function_privilege('anon','public.drivex(text,jsonb)','EXECUTE')
union all select 'browser cannot confirm payments',not has_function_privilege('authenticated','public.confirm_payment_server(text,text,integer,text)','EXECUTE')
 and not has_function_privilege('anon','public.confirm_payment_server(text,text,integer,text)','EXECUTE')
union all select 'browser cannot bind orders',not has_function_privilege('authenticated','public.register_payment_order(uuid,text,integer)','EXECUTE')
 and not has_function_privilege('anon','public.register_payment_order(uuid,text,integer)','EXECUTE')
union all select 'browser cannot process payment events',not has_function_privilege('authenticated','public.process_payment_event(text,text,integer,text,text,text)','EXECUTE')
 and not has_function_privilege('anon','public.process_payment_event(text,text,integer,text,text,text)','EXECUTE')
union all select 'service role can reconcile payments',has_function_privilege('service_role','public.process_payment_event(text,text,integer,text,text,text)','EXECUTE')
union all select 'server profile trigger exists',exists(select 1 from pg_trigger where tgname='drivex_product_profile' and not tgisinternal)
union all select '10-Day plan: INR 1500 and 10 credits',exists(select 1 from drivex_private.plans where id='plan_10_day' and price_inr=1500 and lesson_credits=10)
union all select 'Monthly plan: INR 4000 and 30 credits',exists(select 1 from drivex_private.plans where id='plan_monthly' and price_inr=4000 and lesson_credits=30)
union all select '8 theory and 5 practical lessons',(select count(*) filter(where kind='theory')=8 and count(*) filter(where kind='practical')=5 from drivex_private.course_lessons)
union all select 'three booking exclusion constraints',(select count(*)=3 from pg_constraint where conrelid='drivex_private.bookings'::regclass and contype='x')
union all select 'server payment identifiers unique',(select count(*)=3 from pg_indexes where schemaname='drivex_private' and indexname in ('payments_provider_order_unique','payments_provider_payment_unique','payments_enrollment_unique'))
union all select 'instructor availability tables exist',to_regclass('drivex_private.instructor_hours') is not null and to_regclass('drivex_private.instructor_blocked_dates') is not null
union all select 'old dispatchers cannot bypass new rules',not has_function_privilege('authenticated','drivex_private.dispatch_before_availability(text,jsonb)','EXECUTE')
 and not has_function_privilege('authenticated','drivex_private.dispatch_with_availability(text,jsonb)','EXECUTE')
union all select 'notification queue is service-only',has_function_privilege('service_role','public.drivex_notification_jobs(text,jsonb)','EXECUTE')
 and not has_function_privilege('authenticated','public.drivex_notification_jobs(text,jsonb)','EXECUTE') and not has_function_privilege('anon','public.drivex_notification_jobs(text,jsonb)','EXECUTE')
union all select 'booking and refund queue triggers exist',(select count(*)=2 from pg_trigger where tgname in ('drivex_booking_notifications','drivex_refund_notifications') and not tgisinternal)
union all select 'recommendation feedback table exists',to_regclass('drivex_private.recommendation_feedback') is not null
union all select 'recommendation helpers cannot bypass dispatcher',not has_function_privilege('authenticated','drivex_private.learning_recommendations(uuid,integer,boolean)','EXECUTE')
 and not has_function_privilege('anon','drivex_private.learning_recommendations(uuid,integer,boolean)','EXECUTE')
 and not has_function_privilege('authenticated','drivex_private.dispatch_before_recommendations(text,jsonb)','EXECUTE')
 and not has_function_privilege('anon','drivex_private.dispatch_before_recommendations(text,jsonb)','EXECUTE')
union all select 'core SHA-256 matches standard test vector',encode(sha256(convert_to('abc','UTF8')),'hex')='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
