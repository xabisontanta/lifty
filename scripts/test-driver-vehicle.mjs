import { readFileSync } from 'node:fs'
import { sandboxSql } from './sandbox-safety.mjs'

const output = sandboxSql(readFileSync('supabase/tests/driver_vehicle_setup.sql', 'utf8'))
const line = output.split(/\r?\n/).find(value => value.startsWith('{') && value.includes('"suite": "driver-vehicle-setup"'))
if (!line) throw new Error('Vehicle setup assertions did not return a summary.')
const summary = JSON.parse(line)
if (summary.failed !== 0 || summary.passed < 40) throw new Error('Vehicle setup verification was incomplete.')
console.log(JSON.stringify(summary))
