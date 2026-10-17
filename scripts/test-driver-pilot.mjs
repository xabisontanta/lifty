import { readFileSync } from 'node:fs'
import { sandboxSql } from './sandbox-safety.mjs'

const output = sandboxSql(readFileSync('supabase/tests/driver_pilot_hardening.sql', 'utf8'))
const line = output.split(/\r?\n/).find(value => value.startsWith('{') && value.includes('"suite": "driver-pilot-hardening"'))
if (!line) throw new Error('Driver pilot assertions did not return a summary.')
const summary = JSON.parse(line)
if (summary.failed !== 0 || summary.passed < 60) throw new Error('Driver pilot verification was incomplete.')
console.log(JSON.stringify(summary))
