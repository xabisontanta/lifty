import { readFileSync } from 'node:fs'
import { sandboxSql } from './sandbox-safety.mjs'
const [command, confirmation] = process.argv.slice(2)
if (command === 'list' || !command) {
  console.log(sandboxSql(`select jsonb_agg(jsonb_build_object('id',p.id,'name',p.first_name,'phone',u.phone,'is_test',p.is_test,'automatic',s.auto_respond)) from public.profiles p join auth.users u on u.id=p.id join lifty_private.test_driver_settings s on s.driver_id=p.id where p.is_test and p.role='driver';`))
} else if (command === 'seed') {
  sandboxSql(`begin;update lifty_private.test_environment set mode='local' where id;set local lifty.nonproduction_seed='LOCAL_LIFTY_ONLY';${readFileSync('supabase/seed-test-drivers.sql','utf8')}commit;`)
  console.log('20 labelled test drivers and their measured routes/review history are available in the local sandbox.')
} else if (command === 'cleanup') {
  if (confirmation !== '--confirm-lifty-e2e') throw new Error('Cleanup is local-only and needs: cleanup --confirm-lifty-e2e. No data was changed.')
  console.log(sandboxSql(`begin;set local lifty.nonproduction_cleanup='REMOVE_TEST_ONLY_FROM_LOCAL_LIFTY';${readFileSync('supabase/remove-test-drivers-local.sql','utf8')}commit;`))
  console.log('Only explicitly labelled fixture accounts/pickups were removed from supabase_db_lifty-e2e.')
} else throw new Error('Usage: list | seed | cleanup --confirm-lifty-e2e')

