-- Owner-run provisioning after creating a dedicated LOGIN named drivex_worker.
-- Never use the database owner or drivex_app connection for worker operations.
begin;
grant usage on schema public to drivex_worker;
grant execute on function public.register_payment_order(uuid,text,integer) to drivex_worker;
grant execute on function public.process_payment_event(text,text,integer,text,text,text) to drivex_worker;
grant execute on function public.drivex_notification_jobs(text,jsonb) to drivex_worker;
commit;
