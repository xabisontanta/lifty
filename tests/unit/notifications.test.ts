import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  enabled: true,
  permission: vi.fn(),
  register: vi.fn(),
  unregister: vi.fn(),
  removeDelivered: vi.fn(),
  addListener: vi.fn(),
  callbacks: new Map<string, (value: any) => void>(),
  removes: [] as ReturnType<typeof vi.fn>[],
}))

vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'android' } }))
vi.mock('@/services/location', () => ({ isNative: () => native.enabled }))
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: { requestPermissions: vi.fn(), schedule: vi.fn() } }))
vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    requestPermissions: native.permission,
    register: native.register,
    unregister: native.unregister,
    removeAllDeliveredNotifications: native.removeDelivered,
    addListener: native.addListener,
  },
}))

let online = true
let storage: Map<string, string>
let surface: EventTarget
const DEVICE = 'lifty.push.device'
const PENDING = 'lifty.push.unregister-pending'
const load = () => import('@/services/notifications')
async function settle() { for (let n = 0; n < 20; n++) await Promise.resolve() }
function emit(name: string, value: any) { native.callbacks.get(name)?.(value) }
function returnToApp() { surface.dispatchEvent(new Event('focus')) }

beforeEach(() => {
  vi.resetModules()
  online = true
  storage = new Map()
  surface = new EventTarget()
  vi.stubGlobal('window', Object.assign(surface, { location: { assign: vi.fn() } }))
  vi.stubGlobal('navigator', { get onLine() { return online } })
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  })
  native.enabled = true
  native.permission.mockReset().mockResolvedValue({ receive: 'granted' })
  native.register.mockReset().mockResolvedValue(undefined)
  native.unregister.mockReset().mockResolvedValue(undefined)
  native.removeDelivered.mockReset().mockResolvedValue(undefined)
  native.callbacks.clear()
  native.removes = []
  native.addListener.mockReset().mockImplementation(async (name: string, callback: (value: any) => void) => {
    native.callbacks.set(name, callback)
    const remove = vi.fn().mockResolvedValue(undefined)
    native.removes.push(remove)
    return { remove }
  })
})

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Android push registration lifecycle', () => {
  it('reports ready only after the current account destination is persisted', async () => {
    const api = await load()
    let finish!: () => void
    const save = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    const states: string[] = []
    const removeState = api.subscribePushRegistrationState(state => states.push(state.status))
    const cleanup = await api.registerPush(save)
    expect(api.getPushRegistrationState().status).toBe('registering')
    emit('registration', { value: 'device-token' })
    await settle()
    expect(api.getPushRegistrationState().status).toBe('saving')
    expect(save).toHaveBeenCalledWith('device-token', 'android')
    finish(); await settle()
    expect(api.getPushRegistrationState()).toEqual({ status: 'ready', message: null })
    expect(states).toEqual(['idle', 'registering', 'saving', 'ready'])
    removeState(); cleanup()
  })

  it('retries failed destination persistence on reconnect and return without registering twice', async () => {
    const api = await load()
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    const cleanup = await api.registerPush(save)
    emit('registration', { value: 'device-token' }); await settle()
    expect(api.getPushRegistrationState().status).toBe('error')
    surface.dispatchEvent(new Event('online')); await settle()
    expect(save).toHaveBeenCalledTimes(2)
    expect(api.getPushRegistrationState().status).toBe('ready')
    returnToApp(); await settle()
    expect(save).toHaveBeenCalledTimes(2)
    expect(native.register).toHaveBeenCalledOnce()
    cleanup()
  })

  it('exposes asynchronous registration errors and retries when the user returns', async () => {
    const api = await load()
    const cleanup = await api.registerPush(vi.fn())
    emit('registrationError', { error: 'provider details must not be shown' })
    expect(api.getPushRegistrationState()).toEqual({ status: 'error', message: expect.stringContaining('could not register') })
    expect(api.getPushRegistrationState().message).not.toContain('provider details')
    returnToApp(); await settle()
    expect(native.register).toHaveBeenCalledTimes(2)
    expect(native.addListener).toHaveBeenCalledTimes(3)
    cleanup()
  })

  it('times out a silent registration and retries using the existing listeners', async () => {
    vi.useFakeTimers()
    const api = await load()
    const save = vi.fn().mockResolvedValue(undefined)
    const cleanup = await api.registerPush(save)
    await vi.advanceTimersByTimeAsync(19_999)
    expect(api.getPushRegistrationState().status).toBe('registering')
    returnToApp(); await settle()
    expect(native.register).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(api.getPushRegistrationState()).toEqual({ status: 'error', message: expect.stringContaining('did not finish registering') })
    returnToApp(); await settle()
    expect(native.register).toHaveBeenCalledTimes(2)
    expect(native.addListener).toHaveBeenCalledTimes(3)
    emit('registration', { value: 'retry-token' }); await settle()
    expect(save).toHaveBeenCalledExactlyOnceWith('retry-token', 'android')
    expect(api.getPushRegistrationState().status).toBe('ready')
    cleanup()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('accepts a late current-account token after timeout only once and cancels the deadline', async () => {
    vi.useFakeTimers()
    const api = await load()
    const save = vi.fn().mockResolvedValue(undefined)
    const cleanup = await api.registerPush(save)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(api.getPushRegistrationState().status).toBe('error')
    emit('registration', { value: 'late-token' }); await settle()
    emit('registration', { value: 'late-token' }); await settle()
    expect(save).toHaveBeenCalledExactlyOnceWith('late-token', 'android')
    expect(api.getPushRegistrationState().status).toBe('ready')
    await vi.advanceTimersByTimeAsync(20_000)
    expect(api.getPushRegistrationState().status).toBe('ready')
    expect(vi.getTimerCount()).toBe(0)
    cleanup()
  })

  it('returns cleanup after a hung SDK registration and prevents stale callbacks after disposal', async () => {
    vi.useFakeTimers()
    const api = await load()
    native.register.mockImplementationOnce(() => new Promise<void>(() => {}))
    const save = vi.fn().mockResolvedValue(undefined)
    const registering = api.registerPush(save)
    await settle()
    expect(native.register).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(20_000)
    const cleanup = await registering
    expect(api.getPushRegistrationState().status).toBe('error')
    returnToApp(); await settle()
    expect(native.register).toHaveBeenCalledTimes(2)
    expect(native.addListener).toHaveBeenCalledTimes(3)
    cleanup()
    emit('registration', { value: 'stale-token' }); returnToApp(); await settle()
    expect(save).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('releases a hung registration immediately when account cleanup begins', async () => {
    vi.useFakeTimers()
    const api = await load()
    native.register.mockImplementationOnce(() => new Promise<void>(() => {}))
    const save = vi.fn()
    const registering = api.registerPush(save)
    await settle()
    await api.clearNativePushDestination()
    const cleanup = await registering
    emit('registration', { value: 'old-account' }); await settle()
    expect(save).not.toHaveBeenCalled()
    expect(api.getPushRegistrationState().status).toBe('idle')
    expect(vi.getTimerCount()).toBe(0)
    cleanup()
  })

  it('can recover from denied permission without attaching duplicate listeners', async () => {
    const api = await load()
    native.permission.mockResolvedValueOnce({ receive: 'denied' })
    const cleanup = await api.registerPush(vi.fn())
    expect(api.getPushRegistrationState().status).toBe('permission-denied')
    expect(native.register).not.toHaveBeenCalled()
    expect(native.addListener).not.toHaveBeenCalled()
    returnToApp(); await settle()
    expect(native.register).toHaveBeenCalledOnce()
    expect(native.addListener).toHaveBeenCalledTimes(3)
    cleanup()
  })

  it('removes its listeners and suppresses retries and late token callbacks after cleanup', async () => {
    const api = await load()
    const save = vi.fn()
    const cleanup = await api.registerPush(save)
    cleanup()
    emit('registration', { value: 'old-device' })
    returnToApp(); surface.dispatchEvent(new Event('online')); await settle()
    expect(save).not.toHaveBeenCalled()
    expect(native.removes.every(remove => remove.mock.calls.length === 1)).toBe(true)
    expect(native.register).toHaveBeenCalledOnce()
  })

  it('checks the account guard before saving or updating registration status', async () => {
    const api = await load()
    let current = true
    const save = vi.fn()
    const onState = vi.fn()
    const cleanup = await api.registerPush(save, { isCurrent: () => current, onState })
    current = false
    emit('registration', { value: 'previous-account' })
    emit('registrationError', { error: 'late' })
    returnToApp(); await settle()
    expect(save).not.toHaveBeenCalled()
    expect(onState).toHaveBeenCalledTimes(1)
    expect(api.getPushRegistrationState().status).toBe('registering')
    cleanup()
  })

  it('does not let a previous account save failure overwrite the new account status', async () => {
    const api = await load()
    let rejectOld!: (error: Error) => void
    await api.registerPush(() => new Promise((_resolve, reject) => { rejectOld = reject }))
    const oldCallback = native.callbacks.get('registration')!
    oldCallback({ value: 'previous-account' }); await settle()
    const save = vi.fn().mockResolvedValue(undefined)
    const cleanup = await api.registerPush(save)
    emit('registration', { value: 'new-account' }); await settle()
    rejectOld(new Error('previous save failed')); await settle()
    oldCallback({ value: 'late-old-token' }); await settle()
    expect(save).toHaveBeenCalledExactlyOnceWith('new-account', 'android')
    expect(api.getPushRegistrationState().status).toBe('ready')
    cleanup()
  })

  it('persists a rotated token that arrives while an earlier save is in flight', async () => {
    const api = await load()
    let finish!: () => void
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve })).mockResolvedValue(undefined)
    const cleanup = await api.registerPush(save)
    emit('registration', { value: 'first-token' }); await settle()
    emit('registration', { value: 'rotated-token' }); await settle()
    finish(); await settle()
    expect(save.mock.calls.map(call => call[0])).toEqual(['first-token', 'rotated-token'])
    expect(api.getPushRegistrationState().status).toBe('ready')
    cleanup()
  })

  it('removes partially installed listeners before retrying a failed setup', async () => {
    const api = await load()
    const add = native.addListener.getMockImplementation()!
    let fail = true
    native.addListener.mockImplementation((name: string, callback: (value: any) => void) => {
      if (name === 'registrationError' && fail) { fail = false; return Promise.reject(new Error('bridge failure')) }
      return add(name, callback)
    })
    const cleanup = await api.registerPush(vi.fn())
    expect(native.removes[0]).toHaveBeenCalledOnce()
    returnToApp(); await settle()
    expect(native.register).toHaveBeenCalledOnce()
    expect(native.removes).toHaveLength(4)
    cleanup()
  })

  it('does not call native push APIs in a browser', async () => {
    const api = await load()
    native.enabled = false
    const cleanup = await api.registerPush(vi.fn())
    expect(api.getPushRegistrationState().status).toBe('unsupported')
    expect(native.permission).not.toHaveBeenCalled()
    expect(native.register).not.toHaveBeenCalled()
    cleanup()
  })
})

describe('clearing Android push when leaving an account', () => {
  it('invalidates callbacks, clears the cached device token and delivered alerts through the SDK', async () => {
    const api = await load()
    const save = vi.fn().mockResolvedValue(undefined)
    await api.registerPush(save)
    emit('registration', { value: 'previous-account' }); await settle()
    await api.clearNativePushDestination()
    emit('registration', { value: 'late-old-token' }); returnToApp(); await settle()
    expect(native.unregister).toHaveBeenCalledOnce()
    expect(native.removeDelivered).toHaveBeenCalledOnce()
    expect(storage.has(DEVICE)).toBe(false)
    expect(storage.has(PENDING)).toBe(false)
    expect(save).toHaveBeenCalledOnce()
    expect(api.getPushRegistrationState().status).toBe('idle')
  })

  it('retains cleanup while offline and retries it before another account registers', async () => {
    const api = await load()
    online = false
    await expect(api.clearNativePushDestination()).rejects.toThrow('cleanup needs another attempt')
    expect(storage.get(PENDING)).toBe('1')
    const save = vi.fn().mockResolvedValue(undefined)
    const cleanup = await api.registerPush(save)
    expect(native.register).not.toHaveBeenCalled()
    online = true
    surface.dispatchEvent(new Event('online')); await settle()
    expect(native.unregister).toHaveBeenCalledTimes(3)
    expect(native.register).toHaveBeenCalledOnce()
    expect(storage.has(PENDING)).toBe(false)
    emit('registration', { value: 'new-account' }); await settle()
    expect(save).toHaveBeenCalledExactlyOnceWith('new-account', 'android')
    cleanup()
  })

  it('retries a persisted cleanup marker after an app reload without using an old account token', async () => {
    storage.set(PENDING, '1')
    const api = await load()
    const cleanup = await api.registerPush(vi.fn())
    expect(native.unregister).toHaveBeenCalledOnce()
    expect(native.removeDelivered).toHaveBeenCalledOnce()
    expect(native.unregister.mock.invocationCallOrder[0]).toBeLessThan(native.register.mock.invocationCallOrder[0])
    expect(storage.has(PENDING)).toBe(false)
    cleanup()
  })

  it('bounds sign-out cleanup but prevents registration racing a still-running SDK cleanup', async () => {
    vi.useFakeTimers()
    const api = await load()
    let finish!: () => void
    native.unregister.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const clearing = api.clearNativePushDestination()
    const cleared = expect(clearing).rejects.toThrow('still pending')
    await vi.advanceTimersByTimeAsync(8_000)
    await cleared
    expect(storage.get(PENDING)).toBe('1')
    const registering = api.registerPush(vi.fn())
    await vi.advanceTimersByTimeAsync(8_000)
    const cleanup = await registering
    expect(native.unregister).toHaveBeenCalledOnce()
    expect(native.register).not.toHaveBeenCalled()
    finish(); await settle()
    returnToApp(); await settle()
    expect(native.register).toHaveBeenCalledOnce()
    expect(storage.has(PENDING)).toBe(false)
    cleanup()
  })

  it('does not let an old cleanup timeout overwrite a new account registration state', async () => {
    vi.useFakeTimers()
    const api = await load()
    let finish!: () => void
    native.unregister.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const clearing = api.clearNativePushDestination()
    const cleared = expect(clearing).rejects.toThrow('still pending')
    await vi.advanceTimersByTimeAsync(7_000)
    const registering = api.registerPush(vi.fn())
    await vi.advanceTimersByTimeAsync(1_000); await cleared
    expect(api.getPushRegistrationState().status).toBe('registering')
    finish(); await settle()
    const cleanup = await registering
    expect(native.register).toHaveBeenCalledOnce()
    cleanup()
  })

  it('removes a native listener that finishes installation after sign-out', async () => {
    const api = await load()
    let finish!: (handle: { remove: ReturnType<typeof vi.fn> }) => void
    native.addListener.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const registering = api.registerPush(vi.fn())
    await settle()
    await api.clearNativePushDestination()
    const remove = vi.fn().mockResolvedValue(undefined)
    finish({ remove }); await registering
    expect(remove).toHaveBeenCalledOnce()
    expect(native.register).not.toHaveBeenCalled()
  })
})
