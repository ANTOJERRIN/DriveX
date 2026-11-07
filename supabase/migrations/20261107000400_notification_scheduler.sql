begin;
-- PGlite does not provide these platform extensions; the queue and worker remain testable there.
do $$ begin
 if exists(select 1 from pg_available_extensions where name='pg_cron') then execute 'create extension if not exists pg_cron'; end if;
 if exists(select 1 from pg_available_extensions where name='pg_net') then execute 'create extension if not exists pg_net'; end if;
end; $$;
create function drivex_private.run_notification_schedule() returns jsonb
language plpgsql security definer set search_path='' as $$
declare endpoint text; token text; request_id bigint; queued integer;
begin
 queued:=drivex_private.enqueue_lesson_reminders();
 if to_regclass('vault.decrypted_secrets') is null or to_regnamespace('net') is null then return jsonb_build_object('configured',false,'queued',queued); end if;
 execute 'select decrypted_secret from vault.decrypted_secrets where name=$1 limit 1' into endpoint using 'drivex_notification_url';
 execute 'select decrypted_secret from vault.decrypted_secrets where name=$1 limit 1' into token using 'drivex_notification_token';
 if endpoint is null or endpoint !~ '^https://[a-z0-9-]+\.supabase\.co/functions/v1/notification-worker$' or coalesce(length(token),0)<32 then
  return jsonb_build_object('configured',false,'queued',queued);
 end if;
 execute 'select net.http_post(url:=$1,headers:=$2,body:=$3,timeout_milliseconds:=10000)' into request_id
 using endpoint,jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),'{}'::jsonb;
 return jsonb_build_object('configured',true,'queued',queued,'request_id',request_id);
end; $$;
revoke all on function drivex_private.run_notification_schedule() from public,anon,authenticated;
do $$ begin
 if to_regnamespace('cron') is not null then
  perform cron.schedule('drivex-notifications','* * * * *','select drivex_private.run_notification_schedule();');
 end if;
end; $$;
commit;
