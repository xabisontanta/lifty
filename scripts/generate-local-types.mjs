import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import ts from 'typescript'
import { assertLocalContainer } from './sandbox-safety.mjs'
assertLocalContainer()
const types = execSync('npx --no-install supabase gen types typescript --local --workdir .local-stack --schema public', { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
if (!types.includes('export type Json') || !/"?is_test"?\s*:\s*boolean/.test(types)) throw new Error('Local type output is incomplete; the existing file was preserved.')
const source = ts.createSourceFile('database.types.ts', types, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
if (source.parseDiagnostics.length) throw new Error('Local generated types did not parse; the existing file was preserved.')
writeFileSync('src/domain/database.types.ts', ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(source), 'utf8')
console.log('Database types generated from the local sandbox; no hosted project was accessed.')
