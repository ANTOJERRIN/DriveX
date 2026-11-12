-- Forward-only backend firewall: RPC rate limiting, WAF request inspection,
-- search_path isolation, security audit logging, and private table defense-in-depth.
begin;

-- 1. Security Audit Log Table
create table if not exists drivex_private.security_audit_log (
  id bigint generated always as identity primary key,
  event_time timestamptz not null default now(),
  actor_id uuid,
  client_ip text not null default '127.0.0.1',
  action text not null,
  status text not null,
  details jsonb not null default '{}'::jsonb
);
alter table drivex_private.security_audit_log enable row level security;
revoke all on drivex_private.security_audit_log from public, anon, authenticated;

-- 2. Rate Limits Tracking Table
create table if not exists drivex_private.rate_limits (
  rate_key text primary key,
  bucket_count int not null default 1,
  window_start timestamptz not null default now()
);
alter table drivex_private.rate_limits enable row level security;
revoke all on drivex_private.rate_limits from public, anon, authenticated;

-- 3. Private Client IP resolver helper
create or replace function drivex_private.client_ip() returns text
language plpgsql stable set search_path = '' as $$
declare headers jsonb; ip text;
begin
  headers := nullif(current_setting('request.headers', true), '')::jsonb;
  ip := headers->>'x-forwarded-for';
  if ip is not null and position(',' in ip) > 0 then
    ip := split_part(ip, ',', 1);
  end if;
  if ip is null then
    ip := headers->>'x-real-ip';
  end if;
  return coalesce(nullif(trim(ip), ''), '127.0.0.1');
exception when others then
  return '127.0.0.1';
end; $$;
revoke all on function drivex_private.client_ip() from public, anon, authenticated;

-- 4. Private Rate Limiter Check function
create or replace function drivex_private.check_rate_limit(p_key text, p_max int, p_window_seconds int)
returns void language plpgsql security definer set search_path = '' as $$
declare v_rec drivex_private.rate_limits;
begin
  select * into v_rec from drivex_private.rate_limits where rate_key = p_key for update;
  if not found then
    insert into drivex_private.rate_limits(rate_key, bucket_count, window_start)
    values(p_key, 1, now())
    on conflict(rate_key) do update
    set bucket_count = drivex_private.rate_limits.bucket_count + 1;
  elsif v_rec.window_start < now() - (p_window_seconds || ' seconds')::interval then
    update drivex_private.rate_limits set bucket_count = 1, window_start = now() where rate_key = p_key;
  elsif v_rec.bucket_count >= p_max then
    insert into drivex_private.security_audit_log(actor_id, client_ip, action, status, details)
    values(auth.uid(), drivex_private.client_ip(), p_key, 'RATE_LIMITED', jsonb_build_object('limit', p_max, 'window', p_window_seconds));
    raise exception 'RATE_LIMIT_EXCEEDED: Rate limit exceeded for action. Please wait before retrying.' using errcode = 'P0001';
  else
    update drivex_private.rate_limits set bucket_count = bucket_count + 1 where rate_key = p_key;
  end if;
end; $$;
revoke all on function drivex_private.check_rate_limit(text, int, int) from public, anon, authenticated;

-- 5. Request Inspector (WAF rules)
create or replace function drivex_private.inspect_request(p_action text, p_payload jsonb)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_action is null or p_action !~ '^[a-zA-Z0-9_]{2,64}$' then
    raise exception 'MALFORMED_ACTION: Invalid action name.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) is distinct from 'object' then
    raise exception 'An object payload is required.' using errcode = '22023';
  end if;
  if octet_length(coalesce(p_payload::text, '')) > 65536 then
    raise exception 'PAYLOAD_TOO_LARGE: Request payload exceeds 64KB limit.' using errcode = '22023';
  end if;
end; $$;
revoke all on function drivex_private.inspect_request(text, jsonb) from public, anon, authenticated;

-- 6. Forward Dispatcher Chain
alter function drivex_private.dispatch(text,jsonb) rename to dispatch_before_firewall;
revoke all on function drivex_private.dispatch_before_firewall(text,jsonb) from public,anon,authenticated;

create function drivex_private.dispatch(action text, payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor drivex_private.profiles;
  v_rate_key text;
  v_limit int;
  v_window int;
begin
  -- 1. Deep WAF inspection
  perform drivex_private.inspect_request(action, payload);

  -- 2. Action-specific and general rate-limiting thresholds
  if action = 'firewall_test_rate_limit' then
    v_limit := 3;
    v_window := 60;
  elsif action in ('enroll', 'reserve', 'cancel_booking', 'recommendation_feedback') then
    v_limit := 60;
    v_window := 60;
  else
    v_limit := 1200;
    v_window := 60;
  end if;

  v_rate_key := coalesce(auth.uid()::text, drivex_private.client_ip()) || ':' || action;
  perform drivex_private.check_rate_limit(v_rate_key, v_limit, v_window);

  -- 3. Dedicated Firewall administration action (admin only)
  if action = 'firewall_status' then
    select * into actor from drivex_private.profiles where id = auth.uid();
    if not found or actor.role <> 'admin' then
      raise exception 'Admin access required.' using errcode = '42501';
    end if;
    return jsonb_build_object(
      'status', 'active',
      'rate_limits_tracked', (select count(*) from drivex_private.rate_limits),
      'violations_logged', (select count(*) from drivex_private.security_audit_log sal where sal.status = 'RATE_LIMITED'),
      'recent_violations', coalesce((
        select jsonb_agg(to_jsonb(l) order by l.event_time desc, l.id)
        from (
          select sal.id, sal.event_time, sal.actor_id, sal.client_ip, sal.action, sal.status, sal.details
          from drivex_private.security_audit_log sal
          order by sal.event_time desc, sal.id limit 10
        ) l
      ), '[]'::jsonb)
    );
  end if;

  if action = 'firewall_test_rate_limit' then
    return jsonb_build_object('status', 'allowed', 'action', action);
  end if;

  -- 4. Delegate to prior dispatcher
  return drivex_private.dispatch_before_firewall(action, payload);
end; $$;

revoke all on function drivex_private.dispatch(text,jsonb) from public,anon,authenticated;
grant execute on function drivex_private.dispatch(text,jsonb) to authenticated;

create or replace function public.drivex(action text,payload jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select drivex_private.dispatch(action,payload); $$;

notify pgrst,'reload schema';
commit;
