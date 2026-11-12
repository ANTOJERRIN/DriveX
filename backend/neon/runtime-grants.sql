-- Run as migration owner after creating a dedicated LOGIN role drivex_app.
-- Do not grant this login a platform admin role or table grants on booking data.
begin;
grant authenticated to drivex_app;
grant usage on schema auth to drivex_app;
grant select (id, provider_subject, email), insert (provider_subject,email,raw_user_meta_data),
 update (email) on auth.users to drivex_app;
commit;
