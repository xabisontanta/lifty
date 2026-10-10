import { readFileSync } from 'node:fs'
import { sandboxSql } from './sandbox-safety.mjs'
const output = sandboxSql(readFileSync('supabase/tests/test_driver_lifecycle.sql','utf8'))
const result = output.split(/\r?\n/).find(line => line.includes('"suite": "test-driver-lifecycle"'))
if (!result) throw new Error('Lifecycle verification did not return an assertion count.')
console.log(result)
