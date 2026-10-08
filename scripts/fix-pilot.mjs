import {readFileSync,writeFileSync} from 'node:fs'
const edit=(p,f)=>writeFileSync(p,f(readFileSync(p,'utf8')))
for(const p of ['supabase/pilot-matching.fragment.sql','supabase/pilot-tracking.fragment.sql'])edit(p,s=>s.replaceAll('end $function$\n','end $function$;\n').replaceAll('$function$\nCREATE','$function$;\nCREATE').replace(/\$function\$\s*$/,'$function$;\n'))
edit('src/screens/passenger/Tabs.tsx',s=>s.replace('export function PassengerProfile() {','export function PassengerProfile() {\n  const toast=useToast()'))
edit('src/screens/driver/Driver.tsx',s=>s.replace('export function DriverSettings() {','export function DriverSettings() {\n  const toast=useToast()'))
edit('src/services/liveApi.ts',s=>s.replace("select('*, vehicles(*)')","select('id,role,first_name,last_initial,avatar_path,rating,rating_count,identity_status,completed_arrangements,created_at,about,reliability,vehicles(*)')"))
