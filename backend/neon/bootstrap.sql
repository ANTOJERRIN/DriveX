-- Fresh dedicated Neon database only. Compatibility objects for unchanged DriveX migrations.
do $$ begin
 if not exists(select from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
create schema auth;
revoke all on schema auth from public;
create table auth.users (
 id uuid primary key default gen_random_uuid(),
 provider_subject text unique not null,
 email text not null,
 raw_user_meta_data jsonb not null default '{}',
 email_confirmed_at timestamptz not null default now()
);
create unique index drivex_identity_email on auth.users(lower(email));
create function auth.uid() returns uuid language sql stable set search_path='' as $$
 select nullif(current_setting('drivex.verified_uid',true),'')::uuid
$$;
revoke all on function auth.uid() from public;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
