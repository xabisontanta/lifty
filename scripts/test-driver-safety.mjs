// Safety assertions include destructive fixture cleanup, entirely inside a rollback.
import { readFileSync } from 'node:fs'
import { sandboxSql } from './sandbox-safety.mjs'
const test = readFileSync('supabase/tests/test_driver_safety.sql','utf8').replaceAll('__SAFE_CLEANUP_SQL__',()=>readFileSync('supabase/remove-test-drivers-local.sql','utf8'))
console.log(sandboxSql(test).split(/\r?\n/).filter(line=>line.includes('"suite"')).join('\n'))
