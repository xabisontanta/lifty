import { readFileSync } from 'node:fs'
import { sandboxSql } from './sandbox-safety.mjs'

const output = sandboxSql(readFileSync('supabase/tests/driver_verification_trip_hold.sql', 'utf8'))
const line = output.split(/\r?\n/).find(value => value.startsWith('{') && value.includes('"suite": "driver-verification-trip-hold"'))
if (!line) throw new Error('Driver verification hold assertions did not return a summary.')
const summary = JSON.parse(line)
if (summary.failed !== 0 || summary.passed < 30) throw new Error('Driver verification hold verification was incomplete.')
console.log(JSON.stringify(summary))
