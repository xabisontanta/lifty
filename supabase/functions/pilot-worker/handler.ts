export interface FirebaseCredentials { project_id: string; client_email: string; private_key: string }
export interface PilotJob {
  kind: 'cleanup' | 'push'; id: string; lease: string
  files?: { bucket: string; path: string }[]
  tokens?: { token: string; hash: string }[]
  title?: string; body?: string; link?: string
}
export interface PilotWorkerDependencies {
  env(name: string): string | undefined
  rpc(name: string, args: Record<string, unknown>): Promise<unknown>
  removeFiles(bucket: string, paths: string[]): Promise<void>
  deleteToken(token: string): Promise<void>
  accessToken(config: FirebaseCredentials): Promise<string>
  fetch: typeof fetch
}

function firebaseCredentials(raw: string | undefined): FirebaseCredentials | null {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const config = value as Record<string, unknown>
    if (['project_id', 'client_email', 'private_key'].some(key => typeof config[key] !== 'string' || !(config[key] as string).trim())) return null
    return config as unknown as FirebaseCredentials
  } catch { return null }
}

export async function handle(request: Request, deps: PilotWorkerDependencies): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const token = request.headers.get('x-worker-token')
  if (!token || !await deps.rpc('authorize_pilot_worker', { p_token: token })) return new Response('Unauthorized', { status: 401 })

  const firebase = firebaseCredentials(deps.env('FCM_SERVICE_ACCOUNT_JSON'))
  // Installing credentials must never activate delivery or release queued messages.
  const pushConfigured = firebase !== null
  const pushDeliveryEnabled = deps.env('PILOT_PUSH_DELIVERY_ENABLED') === 'true' && pushConfigured
  const jobs = await deps.rpc('claim_pilot_work', { p_push_ready: pushDeliveryEnabled }) as PilotJob[]
  let bearer: string | undefined
  let completed = 0, failed = 0
  const deadline = Date.now() + 50_000
  for (const job of jobs) {
    if (Date.now() > deadline) break
    try {
      if (job.kind === 'cleanup') {
        const buckets = new Map<string, string[]>()
        for (const file of job.files ?? []) buckets.set(file.bucket, [...(buckets.get(file.bucket) ?? []), file.path])
        for (const [bucket, paths] of buckets) {
          for (let offset = 0; offset < paths.length; offset += 100) await deps.removeFiles(bucket, paths.slice(offset, offset + 100))
        }
        await deps.rpc('finalize_account_deletion', { p_job: job.id, p_lease: job.lease })
      } else {
        // Defense in depth if an unexpected/already-leased push job is returned while off.
        if (!pushDeliveryEnabled || !firebase) throw new Error(pushConfigured ? 'Push delivery is disabled' : 'Firebase not configured')
        bearer ??= await deps.accessToken(firebase)
        for (const destination of job.tokens ?? []) {
          if (!await deps.rpc('can_dispatch_push', { p_id: job.id, p_lease: job.lease, p_hash: destination.hash })) continue
          const response = await deps.fetch(`https://fcm.googleapis.com/v1/projects/${firebase.project_id}/messages:send`, {
            method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: { token: destination.token, notification: { title: job.title, body: job.body },
              data: { link: job.link ?? '/', notificationId: job.id }, android: { priority: 'high', ttl: '86400s', notification: { tag: job.id } } } }),
            signal: AbortSignal.timeout(15_000),
          })
          const result = await response.json()
          if (!response.ok) {
            if (result.error?.details?.some((detail: { errorCode?: string }) => detail.errorCode === 'UNREGISTERED')) { await deps.deleteToken(destination.token); continue }
            throw new Error(`Firebase delivery failed (${response.status})`)
          }
          await deps.rpc('record_push_receipt', { p_id: job.id, p_lease: job.lease, p_hash: destination.hash, p_provider: result.name })
        }
        await deps.rpc('finish_pilot_work', { p_kind: 'push', p_id: job.id, p_lease: job.lease, p_error: null })
      }
      completed++
    } catch (error) {
      failed++
      await deps.rpc('finish_pilot_work', { p_kind: job.kind, p_id: job.id, p_lease: job.lease, p_error: error instanceof Error ? error.message : 'Worker operation failed' })
    }
  }
  return Response.json({ completed, failed, pushConfigured, pushDeliveryEnabled })
}
