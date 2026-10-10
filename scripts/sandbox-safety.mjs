import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { execFileSync } from 'node:child_process'

export const SANDBOX_CONTAINER = 'supabase_db_lifty-e2e'
export function assertLocalDockerEndpoint(host) {
  if (!host?.startsWith('npipe:////./pipe/') && !host?.startsWith('unix:///')) throw new Error('Fixture tools require a local Docker socket; remote Docker engines are refused.')
}
export function assertLocalDocker() {
  const endpoint = process.env.DOCKER_HOST || JSON.parse(execFileSync('docker', ['context', 'inspect'], { encoding: 'utf8' }))[0]?.Endpoints?.docker?.Host
  assertLocalDockerEndpoint(endpoint)
}
export function sandboxDirectory() {
  const dir = resolve('.local-stack')
  if (process.env.LIFTY_STACK_DIR && resolve(process.env.LIFTY_STACK_DIR) !== dir) throw new Error('Only the fixed .local-stack directory is allowed.')
  return dir
}
export function assertSandboxDirectory(path) {
  const base = sandboxDirectory(), candidate = resolve(path)
  if (candidate !== base && !candidate.startsWith(base + sep)) throw new Error('Sandbox path leaves .local-stack.')
  let existing = candidate
  while (!existsSync(existing)) existing = dirname(existing)
  if (realpathSync(existing).toLowerCase() !== resolve(existing).toLowerCase()) throw new Error('Sandbox path contains a symlink or junction.')
  return candidate
}
export function assertLoopbackUrl(value) {
  const url = new URL(value)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('This operation only accepts a loopback local Supabase URL; no hosted project was changed.')
  return url
}
export function assertLocalContainer(container = SANDBOX_CONTAINER) {
  if (container !== SANDBOX_CONTAINER) throw new Error('Only supabase_db_lifty-e2e is allowed for fixture writes or cleanup.')
  assertLocalDocker()
  const dir = sandboxDirectory()
  assertSandboxDirectory(dir)
  const cfg = readFileSync(resolve(dir, 'supabase/config.toml'), 'utf8')
  if (!/^project_id\s*=\s*"lifty-e2e"$/m.test(cfg) || !/port\s*=\s*57322/.test(cfg)) throw new Error('Sandbox identity or database port does not match.')
  const inspect = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }))[0]
  if (inspect?.NetworkSettings?.Ports?.['5432/tcp']?.[0]?.HostPort !== '57322') throw new Error('Container database port does not match the sandbox.')
  return container
}
export function sandboxSql(query) {
  const container = assertLocalContainer()
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input: query, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
}
