-- Forward-only correction: SQL errors roll back audit inserts. Send denials to
-- Postgres logs instead, and describe committed request counters accurately.
begin;

create or replace function drivex_private.check_rate_limit(p_key text, p_max int, p_window_seconds int)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_count int;
begin
  if p_key is null or p_key = '' or p_max is null or p_max < 1
     or p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'Invalid rate limit configuration.' using errcode = '22023';
  end if;

  -- ON CONFLICT locks the same row even for two concurrent first requests.
  -- The predicate applies to both initial conflicts and existing buckets.
  insert into drivex_private.rate_limits as bucket(rate_key,bucket_count,window_start)
  values(p_key,1,v_now)
  on conflict(rate_key) do update set
    bucket_count = case when bucket.window_start <= v_now - make_interval(secs => p_window_seconds)
      then 1 else bucket.bucket_count + 1 end,
    window_start = case when bucket.window_start <= v_now - make_interval(secs => p_window_seconds)
      then v_now else bucket.window_start end
  where bucket.window_start <= v_now - make_interval(secs => p_window_seconds)
     or bucket.bucket_count < p_max
  returning bucket_count into v_count;

  if not found then
    -- No payload, credential or client-supplied header is included in this log.
    -- Hosted log collection/retention must be assessed separately.
    raise log 'DriveX RATE_LIMITED actor=% limit=% window_seconds=%',auth.uid(),p_max,p_window_seconds;
    raise exception 'RATE_LIMIT_EXCEEDED: Rate limit exceeded for action. Please wait before retrying.' using errcode = 'P0001';
  end if;
end; $$;
revoke all on function drivex_private.check_rate_limit(text,int,int) from public,anon,authenticated;

create or replace function drivex_private.dispatch(action text, payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor drivex_private.profiles;
  v_limit int;
begin
  perform drivex_private.inspect_request(action,payload);
  select * into actor from drivex_private.profiles where id = auth.uid();
  if not found then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  v_limit := case when action in ('enroll','reserve','cancel_booking','recommendation_feedback')
    then 60 else 1200 end;
  perform drivex_private.check_rate_limit(actor.id::text || ':' || action,v_limit,60);

  if action = 'firewall_status' then
    if actor.role <> 'admin' then
      raise exception 'Admin access required.' using errcode = '42501';
    end if;
    return jsonb_build_object(
      'status','active',
      'counter_scope','committed_requests',
      'denial_log','postgres',
      'rate_limits_tracked',(select count(*) from drivex_private.rate_limits),
      -- Retain historical audit fields for compatibility; these do not count
      -- denied transactions. Never fabricate rows or counts for those denials.
      'violations_logged',(select count(*) from drivex_private.security_audit_log where status = 'RATE_LIMITED'),
      'recent_violations',coalesce((select jsonb_agg(to_jsonb(l) order by l.event_time desc,l.id)
        from (select sal.id,sal.event_time,sal.actor_id,sal.client_ip,sal.action,sal.status,sal.details
          from drivex_private.security_audit_log sal where sal.status = 'RATE_LIMITED'
          order by sal.event_time desc,sal.id limit 10) l),'[]'::jsonb)
    );
  end if;

  -- No production test endpoint. The prior dispatcher still authorizes each
  -- domain action, including approval and ownership checks.
  return drivex_private.dispatch_before_firewall(action,payload);
end; $$;
revoke all on function drivex_private.dispatch(text,jsonb) from public,anon,authenticated;
grant execute on function drivex_private.dispatch(text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
