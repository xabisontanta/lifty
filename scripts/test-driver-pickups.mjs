import { readFileSync } from 'node:fs'
import { sandboxSql } from './sandbox-safety.mjs'

const output = sandboxSql(readFileSync('supabase/tests/driver_pickup_preferences.sql', 'utf8'))
const line = output.split(/\r?\n/).find(value => value.startsWith('{') && value.includes('"suite"'))
if (!line) throw new Error('Pickup assertions did not return a summary')
const summary = JSON.parse(line)
if (summary.failed !== 0 || summary.passed < 46) throw new Error('Pickup preference verification was incomplete')
console.log(JSON.stringify(summary))
