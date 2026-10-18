import { LocalNotifications } from '@capacitor/local-notifications'
import { PushNotifications } from '@capacitor/push-notifications'
import { isNative } from './location'
import {Capacitor,type PluginListenerHandle} from '@capacitor/core'
import {notificationDestination} from './notificationRoutes'

/**
 * Commute alerts ("Driver 5 min away", "Driver arrived", "You're in!").
 * Native: local notifications + push registration (token stored server-side;
 * sending requires the Android Firebase service account on the backend).
 * Web: the Notification API while the tab is open.
 */

let nextId = 1

export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    if (isNative()) {
      const p = await LocalNotifications.requestPermissions()
      return p.display === 'granted'
    }
    if (!('Notification' in window)) return false
    if (Notification.permission === 'granted') return true
    if (Notification.permission === 'denied') return false
    return (await Notification.requestPermission()) === 'granted'
  } catch {
    return false
  }
}

export async function notifyLocal(title: string, body: string) {
  try {
    if (isNative()) {
      await LocalNotifications.schedule({ notifications: [{ id: nextId++, title, body }] })
      return
    }
    if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
      new Notification(title, { body, icon: '/images/role-driver.webp' })
    }
  } catch {
    /* notifications are best-effort; in-app banners still show */
  }
}

export interface PushRegistrationState {
  status: 'idle' | 'unsupported' | 'permission-denied' | 'registering' | 'saving' | 'ready' | 'error'
  message: string | null
}

export interface PushRegistrationOptions {
  /** The caller must also guard its authenticated save operation against account changes. */
  isCurrent?: () => boolean
  onState?: (state: PushRegistrationState) => void
}

const DEVICE_TOKEN_KEY = 'lifty.push.device'
const PENDING_UNREGISTER_KEY = 'lifty.push.unregister-pending'
let registrationState: PushRegistrationState = { status: 'idle', message: null }
const stateListeners = new Set<(state: PushRegistrationState) => void>()
let registrationEpoch = 0
let disposeRegistration: (() => void) | undefined
let pendingUnregister = false
let nativeCleanup: Promise<void> | null = null
const NATIVE_CLEANUP_TIMEOUT_MS = 8_000
const PUSH_REGISTRATION_TIMEOUT_MS = 20_000

export function getPushRegistrationState(): PushRegistrationState { return registrationState }

export function subscribePushRegistrationState(listener: (state: PushRegistrationState) => void): () => void {
  stateListeners.add(listener)
  listener(registrationState)
  return () => { stateListeners.delete(listener) }
}

function setRegistrationState(state: PushRegistrationState) {
  registrationState = state
  stateListeners.forEach(listener => listener(state))
}

function readStored(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

function storeValue(key: string, value: string | null) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value) } catch { /* memory still guards this session */ }
}

function isAndroidPush(): boolean { return isNative() && Capacitor.getPlatform() === 'android' }
function isOffline(): boolean { return typeof navigator !== 'undefined' && navigator.onLine === false }

/** No old JWT is required: clean up through the device SDK before a new account registers. */
async function cleanupNativeDestination(): Promise<void> {
  if (!nativeCleanup) {
    pendingUnregister = true
    storeValue(PENDING_UNREGISTER_KEY, '1')
    nativeCleanup = (async () => {
      const results = await Promise.allSettled([
        Promise.resolve().then(() => PushNotifications.unregister()),
        Promise.resolve().then(() => PushNotifications.removeAllDeliveredNotifications()),
      ])
      // Capacitor accepts unregister before Firebase's deletion task finishes. Keep a
      // durable retry when offline; SDK resolution is not proof of remote revocation.
      if (results.some(result => result.status === 'rejected') || isOffline()) {
        throw new Error('Device notification cleanup needs another attempt. Reconnect before enabling alerts again.')
      }
      pendingUnregister = false
      storeValue(PENDING_UNREGISTER_KEY, null)
    })().finally(() => { nativeCleanup = null })
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      nativeCleanup,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Device notification cleanup is still pending. Return to Lifty to retry.')), NATIVE_CLEANUP_TIMEOUT_MS)
      }),
    ])
  } finally { if (timer) clearTimeout(timer) }
}

/** Call on sign-out/account change even when removing the server destination fails. */
export async function clearNativePushDestination(): Promise<void> {
  const epoch = ++registrationEpoch
  disposeRegistration?.()
  disposeRegistration = undefined
  storeValue(DEVICE_TOKEN_KEY, null)
  setRegistrationState({ status: 'idle', message: null })
  if (!isAndroidPush()) return
  try { await cleanupNativeDestination() }
  catch (error) {
    if (epoch === registrationEpoch) setRegistrationState({ status: 'error', message: error instanceof Error ? error.message : 'Could not clear device notifications. Reconnect and try again.' })
    throw error
  }
}

export async function registerPush(
  saveToken: (token: string, platform: 'android' | 'ios') => Promise<void>,
  options: PushRegistrationOptions = {},
): Promise<() => void> {
  const epoch = ++registrationEpoch
  disposeRegistration?.()
  const handles: PluginListenerHandle[] = []
  let active = true
  let installing = false
  let installed = false
  let saving = false
  let token: string | null = null
  let savedToken: string | null = null
  let registrationTimer: ReturnType<typeof setTimeout> | undefined
  let releaseRegistrationWait: (() => void) | undefined
  const current = () => active && epoch === registrationEpoch && (options.isCurrent?.() ?? true)
  const state = (status: PushRegistrationState['status'], message: string | null = null) => {
    if (!current()) return
    const next = { status, message }
    setRegistrationState(next)
    options.onState?.(next)
  }
  const finishRegistrationWait = () => {
    if (registrationTimer) clearTimeout(registrationTimer)
    registrationTimer = undefined
    releaseRegistrationWait?.()
    releaseRegistrationWait = undefined
  }
  const cleanup = () => {
    if (!active) return
    active = false
    finishRegistrationWait()
    handles.splice(0).forEach(handle => { void handle.remove().catch(() => {}) })
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', retry)
      window.removeEventListener('focus', retry)
    }
    if (disposeRegistration === cleanup) disposeRegistration = undefined
  }
  disposeRegistration = cleanup

  const persist = async () => {
    if (!current() || saving || !token || token === savedToken) return
    const attemptedToken = token
    saving = true
    state('saving')
    try {
      await saveToken(attemptedToken, 'android')
      if (!current()) return
      savedToken = attemptedToken
      if (token === attemptedToken) state('ready')
    } catch {
      state('error', 'Your notification destination could not be saved. We will retry when you reconnect or return to Lifty.')
    } finally {
      saving = false
      // Token rotation can arrive while the previous destination is being saved.
      if (current() && token !== attemptedToken) void persist()
    }
  }

  const addHandle = async (promise: Promise<PluginListenerHandle>) => {
    const handle = await promise
    if (current()) handles.push(handle)
    else await handle.remove()
  }
  const attempt = async () => {
    if (!current() || installing || registrationTimer) return
    if (token) { await persist(); return }
    installing = true
    state('registering')
    try {
      if (nativeCleanup || pendingUnregister || readStored(PENDING_UNREGISTER_KEY)) await cleanupNativeDestination()
      if (!current()) return
      const permission = await PushNotifications.requestPermissions()
      if (!current()) return
      if (permission.receive !== 'granted') {
        state('permission-denied', 'Device notifications are blocked. Allow them in your phone settings, then return to Lifty.')
        return
      }
      if (!installed) {
        await addHandle(PushNotifications.addListener('registration', destination => {
          if (!current()) return
          finishRegistrationWait()
          token = destination.value
          storeValue(DEVICE_TOKEN_KEY, token)
          void persist()
        }))
        if (!current()) return
        await addHandle(PushNotifications.addListener('registrationError', () => {
          if (!current()) return
          finishRegistrationWait()
          state('error', 'This device could not register for push notifications. Return to Lifty to retry; your inbox remains available.')
        }))
        if (!current()) return
        await addHandle(PushNotifications.addListener('pushNotificationActionPerformed', event => {
          if (current()) window.location.assign(notificationDestination(event.notification.data?.link))
        }))
        installed = true
      }
      if (current()) {
        const deadline = new Promise<void>(resolve => {
          releaseRegistrationWait = resolve
          registrationTimer = setTimeout(() => {
            registrationTimer = undefined
            releaseRegistrationWait = undefined
            state('error', 'This device did not finish registering for notifications. Return to Lifty to retry; your inbox remains available.')
            resolve()
          }, PUSH_REGISTRATION_TIMEOUT_MS)
        })
        // register() normally resolves before the token event. Bound both a
        // missing event and a hung SDK promise without reinstalling listeners.
        await Promise.race([PushNotifications.register(), deadline])
      }
    } catch {
      finishRegistrationWait()
      if (!installed) handles.splice(0).forEach(handle => { void handle.remove().catch(() => {}) })
      state('error', 'Device notifications are unavailable. Reconnect and return to Lifty to retry; your inbox remains available.')
    } finally { installing = false }
  }
  function retry() { if (current() && !isOffline()) void attempt() }

  if (!isAndroidPush()) { state('unsupported'); return cleanup }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', retry)
    window.addEventListener('focus', retry)
  }
  await attempt()
  return cleanup
}
