-- Forward-only, database-owned learning suggestions. No password or payment storage changes.
begin;

create table drivex_private.recommendation_feedback (
 learner_id uuid not null references drivex_private.profiles(id),
 lesson_id uuid not null references drivex_private.course_lessons(id),
 recommendation_hash text not null check(recommendation_hash ~ '^[0-9a-f]{64}$'),
 feedback text not null check(feedback in ('helpful','dismissed')),
 updated_at timestamptz not null default now(),
 primary key(learner_id,lesson_id)
);
alter table drivex_private.recommendation_feedback enable row level security;
revoke all on drivex_private.recommendation_feedback from public,anon,authenticated;
create index bookings_recommendation_scores on drivex_private.bookings(student_id,ends_at desc,id)
 where status='completed' and score is not null;

-- SHA-256 is PostgreSQL core; no extension, external service or client-generated score is needed.
-- Only the authorized dispatcher can invoke this owner-only helper on a learner's behalf.
create function drivex_private.learning_recommendations(p_learner uuid,p_limit int,p_include_dismissed boolean default false)
returns jsonb language sql stable security invoker set search_path='' as $$
 with curriculum as (
  select c.id,c.kind,c.title,c.youtube_url,c.sort_order,lp.completed_at
  from drivex_private.course_lessons c left join drivex_private.lesson_progress lp
   on lp.lesson_id=c.id and lp.learner_id=p_learner
 ), recent_scores as (
  select b.id,b.score,b.ends_at from drivex_private.bookings b
  where b.student_id=p_learner and b.status='completed' and b.score is not null
  order by b.ends_at desc,b.id limit 3
 ), features as (
  select jsonb_build_object('algorithm','curriculum-v1','learner_id',p_learner,
   'curriculum',coalesce((select jsonb_agg(to_jsonb(c) order by c.kind,c.sort_order,c.id) from curriculum c),'[]'::jsonb),
   'recent_scores',coalesce((select jsonb_agg(to_jsonb(s) order by s.ends_at desc,s.id) from recent_scores s),'[]'::jsonb)) as value,
   (select avg(score) from recent_scores) as average_score
 ), context as (
  select encode(sha256(convert_to(value::text,'UTF8')),'hex') as fingerprint,average_score from features
 ), frontier as (
  -- Recommend the earliest unfinished step of each kind; never suggest skipping prerequisites.
  select distinct on(c.kind) c.* from curriculum c where c.completed_at is null
  order by c.kind,c.sort_order,c.id
 ), ranked as (
  select c.id as lesson_id,c.kind,c.title,c.youtube_url,
   encode(sha256(convert_to('curriculum-v1|'||x.fingerprint||'|'||c.id::text,'UTF8')),'hex') as recommendation_id,
   case when c.kind='theory' then 170 else 150+coalesce(round((10-x.average_score)*10)::int,0) end as priority,
   case when c.kind='theory' then 'Continue with your next unfinished theory topic.'
    when x.average_score<=5 then 'Recent lesson scores suggest more guided practice. Start with your next unfinished practical skill.'
    else 'Build on your progress with the next unfinished practical skill.' end as reason,
   c.kind='practical' or c.youtube_url is not null as resource_available,
   f.feedback
  from frontier c cross join context x left join drivex_private.recommendation_feedback f
   on f.learner_id=p_learner and f.lesson_id=c.id and f.recommendation_hash=
    encode(sha256(convert_to('curriculum-v1|'||x.fingerprint||'|'||c.id::text,'UTF8')),'hex')
 ), limited as (
  select * from ranked where p_include_dismissed or feedback is distinct from 'dismissed'
  order by priority desc,kind,lesson_id limit p_limit
 )
 select jsonb_build_object('algorithm','curriculum-v1','fingerprint',(select fingerprint from context),
  'completed',exists(select 1 from curriculum) and not exists(select 1 from curriculum where completed_at is null),
  'items',coalesce((select jsonb_agg(to_jsonb(r) order by r.priority desc,r.kind,r.lesson_id) from limited r),'[]'::jsonb));
$$;
revoke all on function drivex_private.learning_recommendations(uuid,int,boolean) from public,anon,authenticated;

alter function drivex_private.dispatch(text,jsonb) rename to dispatch_before_recommendations;
revoke all on function drivex_private.dispatch_before_recommendations(text,jsonb) from public,anon,authenticated;

create function drivex_private.dispatch(action text,payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor drivex_private.profiles; target uuid; bundle jsonb; item jsonb; old_feedback drivex_private.recommendation_feedback;
 requested_limit int:=3;
begin
 if action not in ('learning_recommendations','recommendation_feedback') then
  return drivex_private.dispatch_before_recommendations(action,payload);
 end if;
 select * into actor from drivex_private.profiles where id=auth.uid();
 if not found then raise exception 'Please sign in.' using errcode='42501'; end if;
 if actor.role='instructor' and actor.approval_status<>'approved' then
  raise exception 'Instructor approval required.' using errcode='42501';
 end if;
 if jsonb_typeof(payload) is distinct from 'object' then raise exception 'An object payload is required.'; end if;
 target:=coalesce((payload->>'learner_id')::uuid,actor.id);
 if actor.role='student' and target<>actor.id then raise exception 'Only your own recommendations are available.' using errcode='42501'; end if;
 if actor.role='instructor' then
  -- Retain the existing latest paid/reviewed assignment check, including former-instructor isolation.
  perform drivex_private.dispatch_before_recommendations('learner_lessons',jsonb_build_object('learner_id',target));
 end if;
 perform 1 from drivex_private.profiles where id=target and role='student';
 if not found then raise exception 'Learner is not available.' using errcode='42501'; end if;
 if action='learning_recommendations' then
  if payload ? 'limit' then
   if jsonb_typeof(payload->'limit') is distinct from 'number' or (payload->>'limit') !~ '^([1-9]|10)$' then
    raise exception 'Recommendation limit must be an integer from 1 to 10.';
   end if;
   requested_limit:=(payload->>'limit')::int;
  end if;
  return drivex_private.learning_recommendations(target,requested_limit);
 end if;
 if actor.role<>'student' then raise exception 'Only learners can submit recommendation feedback.' using errcode='42501'; end if;
 if payload->>'feedback' is null or payload->>'feedback' not in ('helpful','dismissed') then raise exception 'Choose helpful or dismissed.'; end if;
 if payload->>'recommendation_id' is null or (payload->>'recommendation_id') !~ '^[0-9a-f]{64}$' then raise exception 'A current recommendation identifier is required.'; end if;
 -- Serialize feedback for this learner. The primary key bounds storage to one row per curriculum item.
 perform 1 from drivex_private.profiles where id=target for update;
 bundle:=drivex_private.learning_recommendations(target,10,true);
 select entry into item from jsonb_array_elements(bundle->'items') entry
  where entry->>'recommendation_id'=payload->>'recommendation_id';
 if item is null then raise exception 'Recommendation changed. Refresh your learning suggestions.'; end if;
 select * into old_feedback from drivex_private.recommendation_feedback where learner_id=target and lesson_id=(item->>'lesson_id')::uuid;
 if old_feedback.recommendation_hash=payload->>'recommendation_id' and old_feedback.feedback=payload->>'feedback' then
  return jsonb_build_object('status','success','idempotent',true);
 end if;
 insert into drivex_private.recommendation_feedback(learner_id,lesson_id,recommendation_hash,feedback)
 values(target,(item->>'lesson_id')::uuid,payload->>'recommendation_id',payload->>'feedback')
 on conflict(learner_id,lesson_id) do update set recommendation_hash=excluded.recommendation_hash,feedback=excluded.feedback,updated_at=now();
 return jsonb_build_object('status','success','idempotent',false);
end; $$;
revoke all on function drivex_private.dispatch(text,jsonb) from public,anon,authenticated;
grant execute on function drivex_private.dispatch(text,jsonb) to authenticated;
create or replace function public.drivex(action text,payload jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select drivex_private.dispatch(action,payload); $$;
notify pgrst,'reload schema';
commit;
