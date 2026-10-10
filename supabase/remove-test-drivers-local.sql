-- SAFE LOCAL cleanup proposal. This file does not execute by opening it.
-- Run through: node scripts/test-driver-tools.mjs cleanup --confirm-lifty-e2e
-- The runner independently checks the fixed Docker identity + loopback sandbox port.
do $$ begin
 if current_setting('lifty.nonproduction_cleanup',true) is distinct from 'REMOVE_TEST_ONLY_FROM_LOCAL_LIFTY'
  or not exists(select 1 from lifty_private.test_environment where id and mode='local')
 then raise exception 'Cleanup refused: use the confirmed local sandbox runner. No hosted project was changed';end if;
end $$;
delete from auth.users where id in (
 select id from public.profiles where is_test
 and (id::text like 'e0000000-0000-4000-8000-%' or (is_demo and id::text like 'd0000000-0000-4000-8000-%'))
);
delete from public.pickup_points where is_test and id::text like 'e0000000-0000-4000-8000-%';
