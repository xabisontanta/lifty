import { readFileSync } from 'node:fs'
import { sandboxSql } from './sandbox-safety.mjs'
const output = sandboxSql(readFileSync('supabase/tests/test_driver_isolation.sql','utf8'))
const result = output.split(/\r?\n/).find(line => line.startsWith('{'))
if (!result) throw new Error('Database verification did not return its assertion count.')
console.log(result)
