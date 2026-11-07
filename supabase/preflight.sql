-- Read-only checks BEFORE applying the product-completion migration.
-- Any false row needs investigation; do not delete or rewrite historical rows to make it pass.
select 'no duplicate provider orders' as check_name,not exists(
 select provider_order_id from drivex_private.payments where provider_order_id is not null group by provider_order_id having count(*)>1) as ok
union all select 'no duplicate provider payment IDs',not exists(
 select provider_payment_id from drivex_private.payments where provider_payment_id is not null group by provider_payment_id having count(*)>1)
union all select 'one payment per enrollment',not exists(
 select enrollment_id from drivex_private.payments where enrollment_id is not null group by enrollment_id having count(*)>1)
union all select 'no over-reserved enrollments',not exists(
 select e.id from drivex_private.enrollments e join drivex_private.bookings b on b.enrollment_id=e.id
 where b.status in ('confirmed','cancellation_requested') group by e.id,e.credits_total,e.credits_used
 having count(*)>e.credits_total-e.credits_used)
union all select 'one unfinished enrollment per learner',not exists(
 select learner_id from drivex_private.enrollments where status in ('pending_payment','active') group by learner_id having count(*)>1);
