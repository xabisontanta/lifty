// Local sandbox gateway. One URL for the app: it serves the REAL find-matches handler (supabase/functions/find-matches/handler.ts)
// and proxies everything else — REST, Auth, Realtime websockets — to the local Supabase API.
// (Docker on this machine can't mount the functions folder into Supabase's edge runtime, so Node runs the same code.)
//   node scripts/local-gateway.mjs            (needs the sandbox up: node scripts/local-stack.mjs up)
import http from 'node:http'
import net from 'node:net'
import { execSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { handle } from '../supabase/functions/find-matches/handler.ts'
import { handle as vehicleIllustration, openAiProvider } from '../supabase/functions/vehicle-illustration/handler.ts'
import { existsSync, readFileSync } from 'node:fs'
import { assertLocalContainer, assertLoopbackUrl, sandboxDirectory } from './sandbox-safety.mjs'

assertLocalContainer()
sandboxDirectory()
const PORT = 57330

export function stackEnv() {
  const out = execSync('npx --no-install supabase status --workdir .local-stack -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  return Object.fromEntries(out.split(/\r?\n/).filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')] }))
}

const s = stackEnv()
const target = assertLoopbackUrl(s.API_URL)
if (target.port !== '57321') throw new Error('Sandbox gateway only proxies the fixed local API on port 57321.')
const db = createClient(s.API_URL, s.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
// This server-only local fallback never returns a token to the browser. Staging
// and production Edge Functions require their own MAPBOX_TOKEN secret.
const localMapToken = existsSync('.env') ? readFileSync('.env', 'utf8').split(/\r?\n/).find(line => line.startsWith('VITE_MAPBOX_TOKEN='))?.slice('VITE_MAPBOX_TOKEN='.length).trim() : null
const mapboxSecret = process.env.MAPBOX_TOKEN || localMapToken || null
if (!mapboxSecret) throw new Error('Configure MAPBOX_TOKEN for road-based sandbox searches.')
const illustrationKey = process.env.VEHICLE_ILLUSTRATION_GENERATION_ENABLED === 'true' ? process.env.OPENAI_API_KEY : null
const illustrationOutput = db.storage.from('vehicle-illustrations')
const illustrationDeps = {
  db, provider: illustrationKey ? openAiProvider(illustrationKey) : null,
  async downloadReference(path) {
    const result = await db.storage.from('vehicle-illustration-references').download(path)
    if (result.error || !result.data) throw new Error('Reference unavailable')
    return { bytes: new Uint8Array(await result.data.arrayBuffer()), contentType: result.data.type }
  },
  async upload(path, file) {
    const result = await illustrationOutput.upload(path, file.bytes, { contentType: file.contentType, upsert: false })
    if (result.error) throw new Error('Image upload unavailable')
  },
  async signedUrl(path) {
    const result = await illustrationOutput.createSignedUrl(path, 900)
    if (result.error || !result.data?.signedUrl) throw new Error('Image unavailable')
    return result.data.signedUrl
  },
  async remove(path) { await illustrationOutput.remove([path]) },
  log: message => console.error('[vehicle-illustration]', message),
}

const server = http.createServer(async (req, res) => {
  try {
    const functionPath = req.url?.split('?')[0]
    if (functionPath === '/functions/v1/find-matches' || functionPath === '/functions/v1/vehicle-illustration') {
      const chunks = []
      let bytes = 0
      for await (const c of req) { bytes += c.length; if (bytes > 1_000_000) { res.writeHead(413); res.end('request too large'); return }; chunks.push(c) }
      const headers = new Headers()
      for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : String(v))
      const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks)
      const request = new Request(`http://localhost${req.url}`, { method: req.method, headers, body })
      const response = functionPath === '/functions/v1/vehicle-illustration' ? await vehicleIllustration(request, illustrationDeps)
        : await handle(request, { db, mapboxSecret, log: (m) => console.error('[find-matches]', m) })
      res.writeHead(response.status, Object.fromEntries(response.headers))
      res.end(Buffer.from(await response.arrayBuffer()))
      return
    }
    const up = http.request({ hostname: target.hostname, port: target.port, path: req.url, method: req.method, headers: req.headers }, (pr) => {
      res.writeHead(pr.statusCode ?? 502, pr.headers)
      pr.pipe(res)
    })
    up.on('error', (e) => { res.writeHead(502); res.end(String(e)) })
    req.pipe(up)
  } catch (e) {
    console.error('[gateway]', e)
    if (!res.headersSent) res.writeHead(500)
    res.end('gateway error')
  }
})

// websockets (Realtime) pass straight through
server.on('upgrade', (req, socket, head) => {
  const up = net.connect(Number(target.port), target.hostname, () => {
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`)
    if (head?.length) up.write(head)
    socket.pipe(up).pipe(socket)
  })
  up.on('error', () => socket.destroy())
  socket.on('error', () => up.destroy())
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`gateway on http://127.0.0.1:${PORT}  →  ${s.API_URL}  (find-matches and vehicle-illustration served locally)`)
  console.log(`VITE_SUPABASE_URL=http://127.0.0.1:${PORT}`)
})
