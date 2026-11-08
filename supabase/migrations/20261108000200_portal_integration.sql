-- Add learner checkout context without changing existing prices, payments or reservations.
begin;
alter function drivex_private.dispatch(text,jsonb) rename to dispatch_before_portal_integration;
revoke all on function drivex_private.dispatch_before_portal_integration(text,jsonb) from public,anon,authenticated;

create function drivex_private.dispatch(action text,payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; pending_plan jsonb;
begin
 -- The existing dispatcher remains the identity, role and business-rule authority.
 result:=drivex_private.dispatch_before_portal_integration(action,payload);
 if action in ('snapshot','me') and result->'me'->>'role'='student' then
  select jsonb_build_object('id',en.id,'plan_id',en.plan_id,'plan_name',pl.name,
   'instructor_id',en.instructor_id,'instructor_name',ip.name,'credits_total',en.credits_total,
   'amount_inr',py.amount_paise/100.0,'payment_status',py.status)
  into pending_plan from drivex_private.enrollments en
  join drivex_private.plans pl on pl.id=en.plan_id
  join drivex_private.profiles ip on ip.id=en.instructor_id
  join drivex_private.payments py on py.enrollment_id=en.id
  where en.learner_id=auth.uid() and en.status='pending_payment'
  order by en.created_at desc,en.id limit 1;
  result:=result||jsonb_build_object('pending_enrollment',pending_plan);
 end if;
 if action='instructor_overview' then
  -- Match current reviewed/paid assignments rather than counting legacy activations awaiting review.
  result:=jsonb_set(result,'{learners_count}',(select to_jsonb(count(*))
   from jsonb_array_elements(drivex_private.dispatch_before_portal_integration('instructor_learners','{}')) learner
   where learner->>'status'='active'));
 end if;
 return result;
end; $$;
revoke all on function drivex_private.dispatch(text,jsonb) from public,anon,authenticated;
grant execute on function drivex_private.dispatch(text,jsonb) to authenticated;
create or replace function public.drivex(action text,payload jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select drivex_private.dispatch(action,payload); $$;
notify pgrst,'reload schema';
commit;
