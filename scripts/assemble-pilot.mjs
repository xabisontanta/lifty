import {readFileSync,writeFileSync} from 'node:fs'
import {holidaysFor} from '../src/lib/holidays.ts'
const migration='supabase/migrations/20261008112915_reliable_pilot.sql'
const base=readFileSync(migration,'utf8').split('-- ASSEMBLED FRAGMENTS')[0]
let schedules=readFileSync('supabase/pilot-schedules.fragment.sql','utf8')
const values=[]
for(let y=2025;y<=2036;y++)for(const [date,name] of holidaysFor(y))values.push(`('${date}','${name.replaceAll("'","''")}')`)
schedules=schedules.replace('create table lifty_private.holidays(service_date date primary key,name text not null);',`create table lifty_private.holidays(service_date date primary key,name text not null);\ninsert into lifty_private.holidays values ${values.join(',\n')};`)
writeFileSync(migration,base+'\n-- ASSEMBLED FRAGMENTS\n'+schedules+'\n'+readFileSync('supabase/pilot-matching.fragment.sql','utf8')+'\n'+readFileSync('supabase/pilot-tracking.fragment.sql','utf8')+'\n'+readFileSync('supabase/pilot-operations.fragment.sql','utf8')+'\n'+readFileSync('supabase/pilot-final.fragment.sql','utf8'))
