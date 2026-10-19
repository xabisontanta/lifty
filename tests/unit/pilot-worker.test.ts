import { describe, expect, it, vi } from 'vitest'
import { handle, type PilotJob, type PilotWorkerDependencies } from '../../supabase/functions/pilot-worker/handler'

const credentials = { project_id: 'lifty-test-project', client_email: 'messaging@lifty-test-project.iam.gserviceaccount.com', private_key: 'synthetic-key-never-used' }
const push: PilotJob = { kind: 'push', id: 'notification-id', lease: 'push-lease', title: 'Request accepted', body: 'Your club is ready', link: '/p/club', tokens: [{ token: 'device-token', hash: 'token-hash' }] }
const cleanup: PilotJob = { kind: 'cleanup', id: 'cleanup-id', lease: 'cleanup-lease', files: [{ bucket: 'documents', path: 'owned/file.pdf' }] }
function harness(env: Record<string, string | undefined> = {}, jobs: PilotJob[] = []) {
  const rpc = vi.fn(async (name: string, _args: Record<string, unknown>): Promise<unknown> => name === 'claim_pilot_work' ? jobs : true)
  const fetcher = vi.fn(async () => Response.json({ name: 'projects/lifty-test-project/messages/provider-id' }))
  const deps: PilotWorkerDependencies = { env: name => env[name], rpc, fetch: fetcher as typeof fetch,
    removeFiles: vi.fn(async () => {}), deleteToken: vi.fn(async () => {}), accessToken: vi.fn(async () => 'access-token') }
  return { deps, rpc, fetcher }
}
const request = (token: string | null = 'worker-token', method = 'POST') => new Request('http://local.invalid/pilot-worker', { method, headers: token ? { 'x-worker-token': token } : {} })

describe('pilot worker explicit push activation', () => {
  it.each([undefined, 'false', 'TRUE', '1', ' true '])('credentials alone or a non-exact switch (%s) never enable push claims', async enabled => {
    const h = harness({ FCM_SERVICE_ACCOUNT_JSON: JSON.stringify(credentials), PILOT_PUSH_DELIVERY_ENABLED: enabled })
    expect(await (await handle(request(), h.deps)).json()).toEqual({ completed: 0, failed: 0, pushConfigured: true, pushDeliveryEnabled: false })
    expect(h.rpc).toHaveBeenCalledWith('claim_pilot_work', { p_push_ready: false })
    expect(h.deps.accessToken).not.toHaveBeenCalled(); expect(h.fetcher).not.toHaveBeenCalled()
  })
  it('blocks provider work even if a push job is unexpectedly returned while delivery is off', async () => {
    const h = harness({ FCM_SERVICE_ACCOUNT_JSON: JSON.stringify(credentials) }, [push])
    expect(await (await handle(request(), h.deps)).json()).toMatchObject({ completed: 0, failed: 1, pushConfigured: true, pushDeliveryEnabled: false })
    expect(h.deps.accessToken).not.toHaveBeenCalled(); expect(h.fetcher).not.toHaveBeenCalled()
    expect(h.rpc).toHaveBeenCalledWith('finish_pilot_work', { p_kind: 'push', p_id: push.id, p_lease: push.lease, p_error: 'Push delivery is disabled' })
    expect(h.rpc.mock.calls.some(([name]) => name === 'record_push_receipt')).toBe(false)
  })
  it.each([undefined, '{bad-json', 'null', '[]', '{}', JSON.stringify({ ...credentials, project_id: 123 }), JSON.stringify({ ...credentials, client_email: '' }), JSON.stringify({ ...credentials, private_key: '   ' })])('missing or malformed credentials keep claims off even with the switch on: %s', async raw => {
    const h = harness({ FCM_SERVICE_ACCOUNT_JSON: raw, PILOT_PUSH_DELIVERY_ENABLED: 'true' })
    expect(await (await handle(request(), h.deps)).json()).toMatchObject({ pushConfigured: false, pushDeliveryEnabled: false })
    expect(h.rpc).toHaveBeenCalledWith('claim_pilot_work', { p_push_ready: false })
    expect(h.deps.accessToken).not.toHaveBeenCalled(); expect(h.fetcher).not.toHaveBeenCalled()
  })
  it('claims and dispatches only when explicitly enabled and credentials are configured', async () => {
    const h = harness({ FCM_SERVICE_ACCOUNT_JSON: JSON.stringify(credentials), PILOT_PUSH_DELIVERY_ENABLED: 'true' }, [push])
    expect(await (await handle(request(), h.deps)).json()).toEqual({ completed: 1, failed: 0, pushConfigured: true, pushDeliveryEnabled: true })
    expect(h.rpc).toHaveBeenCalledWith('claim_pilot_work', { p_push_ready: true })
    expect(h.deps.accessToken).toHaveBeenCalledWith(credentials)
    const [url, options] = h.fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://fcm.googleapis.com/v1/projects/lifty-test-project/messages:send')
    expect(options.headers).toMatchObject({ Authorization: 'Bearer access-token' })
    expect(JSON.parse(options.body as string)).toMatchObject({ message: { token: 'device-token', notification: { title: push.title, body: push.body }, data: { link: push.link, notificationId: push.id } } })
    expect(h.rpc).toHaveBeenCalledWith('can_dispatch_push', { p_id: push.id, p_lease: push.lease, p_hash: 'token-hash' })
    expect(h.rpc).toHaveBeenCalledWith('record_push_receipt', expect.objectContaining({ p_id: push.id, p_provider: 'projects/lifty-test-project/messages/provider-id' }))
    expect(h.rpc).toHaveBeenLastCalledWith('finish_pilot_work', { p_kind: 'push', p_id: push.id, p_lease: push.lease, p_error: null })
  })
  it.each([{}, { FCM_SERVICE_ACCOUNT_JSON: JSON.stringify(credentials) }])('keeps cleanup operational while push is off: %o', async env => {
    const h = harness(env, [cleanup])
    expect(await (await handle(request(), h.deps)).json()).toMatchObject({ completed: 1, failed: 0, pushDeliveryEnabled: false })
    expect(h.deps.removeFiles).toHaveBeenCalledWith('documents', ['owned/file.pdf'])
    expect(h.rpc).toHaveBeenCalledWith('finalize_account_deletion', { p_job: cleanup.id, p_lease: cleanup.lease })
    expect(h.deps.accessToken).not.toHaveBeenCalled(); expect(h.fetcher).not.toHaveBeenCalled()
  })
  it('preserves per-destination database authorization when delivery is enabled', async () => {
    const h = harness({ FCM_SERVICE_ACCOUNT_JSON: JSON.stringify(credentials), PILOT_PUSH_DELIVERY_ENABLED: 'true' }, [push])
    h.rpc.mockImplementation(async (name: string) => name === 'claim_pilot_work' ? [push] : name !== 'can_dispatch_push')
    await handle(request(), h.deps)
    expect(h.fetcher).not.toHaveBeenCalled()
    expect(h.rpc.mock.calls.some(([name]) => name === 'record_push_receipt')).toBe(false)
  })
  it('authorizes worker requests before reading configuration or claiming work', async () => {
    const h = harness({ FCM_SERVICE_ACCOUNT_JSON: JSON.stringify(credentials), PILOT_PUSH_DELIVERY_ENABLED: 'true' }, [push])
    h.deps.env = vi.fn(h.deps.env)
    expect((await handle(request(null), h.deps)).status).toBe(401)
    expect((await handle(request('worker-token', 'GET'), h.deps)).status).toBe(405)
    h.rpc.mockResolvedValue(false)
    expect((await handle(request(), h.deps)).status).toBe(401)
    expect(h.deps.env).not.toHaveBeenCalled(); expect(h.fetcher).not.toHaveBeenCalled()
    expect(h.rpc).toHaveBeenCalledTimes(1)
    expect(h.rpc).toHaveBeenCalledWith('authorize_pilot_worker', { p_token: 'worker-token' })
  })
})
