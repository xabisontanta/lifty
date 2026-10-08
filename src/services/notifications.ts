import { LocalNotifications } from '@capacitor/local-notifications'
import { PushNotifications } from '@capacitor/push-notifications'
import { isNative } from './location'

/**
 * Commute alerts ("Driver 5 min away", "Driver arrived", "You're in!").
 * Native: local notifications + push registration (token stored server-side;
 * sending requires an FCM/APNs server key configured on the backend).
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

export async function registerPush(saveToken: (token: string, platform: 'android' | 'ios') => Promise<void>) {
  if (!isNative()) return
  try {
    const perm = await PushNotifications.requestPermissions()
    if (perm.receive !== 'granted') return
    await PushNotifications.addListener('registration', (t) => void saveToken(t.value, /iPhone|iPad/.test(navigator.userAgent) ? 'ios' : 'android'))
    await PushNotifications.register()
  } catch {
    /* push requires google-services.json / APNs setup in the native projects */
  }
}
