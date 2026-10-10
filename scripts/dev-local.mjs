// Start the unchanged Vite app against the fixed local backend. Keys stay in child environment.
import { execSync, spawn } from 'node:child_process'
import { assertLocalContainer, assertLoopbackUrl } from './sandbox-safety.mjs'

assertLocalContainer()
const output = execSync('npx --no-install supabase status --workdir .local-stack -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
const local = Object.fromEntries(output.split(/\r?\n/).filter(line => line.includes('=')).map(line => {
  const i = line.indexOf('=')
  return [line.slice(0, i), line.slice(i + 1).replace(/^"|"$/g, '')]
}))
const upstream = assertLoopbackUrl(local.API_URL)
if (upstream.port !== '57321' || !local.ANON_KEY) throw new Error('Start the Lifty local sandbox first.')
const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5180', '--strictPort'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_SUPABASE_URL: 'http://127.0.0.1:57330', VITE_SUPABASE_ANON_KEY: local.ANON_KEY },
})
child.on('exit', code => process.exit(code ?? 1))
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
