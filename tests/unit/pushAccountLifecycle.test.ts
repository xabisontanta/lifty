import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ signOut: vi.fn(), cleanup: vi.fn(), from: vi.fn(), eq: vi.fn(), rpc: vi.fn(), abort: vi.fn() }))
vi.mock('@/services/supabase', () => ({
  currentUserId: 'current-owner', publicFileUrl: () => undefined,
  sb: () => ({ from: h.from, rpc: h.rpc, auth: { signOut: h.signOut } }),
}))
vi.mock('@/services/notifications', () => ({ clearNativePushDestination: h.cleanup }))
vi.mock('@/services/pilotApi', () => ({ pilotMethods: {}, pilotRpc: vi.fn() }))
import { liveApi } from '@/services/liveApi'

let stored: Map<string, string>
beforeEach(() => {
  stored = new Map([['lifty.push.device', 'fixture-token']])
  for (const key of ['localStorage', 'sessionStorage']) vi.stubGlobal(key, {
    getItem: (name: string) => stored.get(name) ?? null,
    setItem: (name: string, value: string) => stored.set(name, value),
    removeItem: (name: string) => stored.delete(name),
  })
  h.signOut.mockReset().mockResolvedValue({ error: null })
  h.cleanup.mockReset().mockImplementation(async () => { stored.delete('lifty.push.device') })
  const query = { eq: h.eq }
  h.eq.mockReset().mockImplementation((key: string) => key === 'token' ? Promise.resolve({ error: null }) : query)
  h.from.mockReset().mockReturnValue({ delete: () => query })
  h.abort.mockReset().mockResolvedValue({ error: null })
  h.rpc.mockReset().mockReturnValue({ abortSignal: h.abort })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

test('logout captures the owned destination before native cleanup and signs out this device only', async () => {
  await liveApi.signOut()
  expect(h.cleanup).toHaveBeenCalledOnce()
  expect(h.from).toHaveBeenCalledWith('push_tokens')
  expect(h.eq.mock.calls).toEqual([['user_id', 'current-owner'], ['token', 'fixture-token']])
  expect(h.cleanup.mock.invocationCallOrder[0]).toBeLessThan(h.signOut.mock.invocationCallOrder[0])
  expect(h.signOut).toHaveBeenCalledWith({ scope: 'local' })
  expect(stored.has('lifty.push.device')).toBe(false)
})

test('failed server deletion and native cleanup cannot prevent local sign-out', async () => {
  h.from.mockImplementation(() => { throw new Error('offline') })
  h.cleanup.mockRejectedValue(new Error('native cleanup pending'))
  await expect(liveApi.signOut()).resolves.toBeUndefined()
  expect(h.signOut).toHaveBeenCalledWith({ scope: 'local' })
})

test('saving a push destination uses a bounded authenticated request', async () => {
  await liveApi.savePushToken('fixture-token', 'android')
  expect(h.rpc).toHaveBeenCalledWith('register_push_destination', { p_token: 'fixture-token', p_platform: 'android' })
  expect(h.abort).toHaveBeenCalledWith(expect.any(AbortSignal))
  expect(h.abort.mock.calls[0][0].aborted).toBe(false)
})

test('a stalled destination save aborts after twelve seconds so registration can be retried', async () => {
  vi.useFakeTimers()
  h.abort.mockImplementation((signal: AbortSignal) => new Promise(resolve => {
    signal.addEventListener('abort', () => resolve({ error: { message: 'Notification request timed out' } }), { once: true })
  }))
  const request = expect(liveApi.savePushToken('fixture-token', 'android')).rejects.toThrow('timed out')
  await vi.advanceTimersByTimeAsync(12000)
  await request
  expect(h.abort.mock.calls[0][0].aborted).toBe(true)
})

test('logout aborts an old account’s in-flight destination save before removing its token', async () => {
  h.abort.mockImplementation((signal: AbortSignal) => new Promise(resolve => {
    signal.addEventListener('abort', () => resolve({ error: { message: 'Destination save aborted' } }), { once: true })
  }))
  const pending = expect(liveApi.savePushToken('fixture-token', 'android')).rejects.toThrow('aborted')
  await liveApi.signOut()
  await pending
  expect(h.abort.mock.calls[0][0].aborted).toBe(true)
  expect(h.eq.mock.calls).toContainEqual(['token', 'fixture-token'])
})
