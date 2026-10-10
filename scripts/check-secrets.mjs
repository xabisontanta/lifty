// Scan only versioned/proposed source; report locations, never credential values.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
const checks = [
  ['Mapbox token', /\b(?:pk|sk)\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/],
  ['Supabase key', /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{20,}/],
  ['embedded JWT', /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
]
const findings = []
for (const file of files) {
  if (!/\.(?:[cm]?[jt]sx?|json|sql|md|toml|ya?ml|html|properties|xml|gradle)$/.test(file) && file !== '.env.example') continue
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  for (const [kind, pattern] of checks) for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) findings.push(`${file}:${i + 1}: possible ${kind}`)
  }
}
if (findings.length) { console.error(findings.join('\n')); process.exitCode = 1 }
else console.log(`Source credential scan passed (${files.length} tracked/proposed files; ignored environment files excluded).`)
