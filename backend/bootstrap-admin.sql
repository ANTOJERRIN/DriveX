-- Run ONLY after verifying the owner's account UUID in Supabase Auth.
-- Replace the placeholder with that UUID, then execute in the SQL editor.
-- The owner must have signed into DriveX once to create their profile.
do $$
declare owner_id uuid := 'REPLACE_WITH_VERIFIED_OWNER_AUTH_USER_UUID';
begin
 if not exists(select 1 from auth.users where id=owner_id and email_confirmed_at is not null) then
  raise exception 'An email-confirmed owner account is required.';
 end if;
 update drivex_private.profiles set role='admin' where id=owner_id;
 if not found then raise exception 'Owner must sign into DriveX once before promotion.'; end if;
end $$;
