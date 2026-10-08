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

export async function registerPush(saveToken: (token: string, platform: 'android' | 'ios') => Promise<void>):Promise<()=>void> {
  const handles:PluginListenerHandle[]=[]
  const cleanup=()=>handles.forEach(h=>void h.remove())
  if (!isNative() || Capacitor.getPlatform()!=='android') return cleanup
  try {
    const perm = await PushNotifications.requestPermissions()
    if (perm.receive !== 'granted') return cleanup
    handles.push(await PushNotifications.addListener('registration',t=>{try{localStorage.setItem('lifty.push.device',t.value)}catch{};void saveToken(t.value,'android').catch(()=>{})}))
    handles.push(await PushNotifications.addListener('pushNotificationActionPerformed',event=>{window.location.assign(notificationDestination(event.notification.data?.link))}))
    await PushNotifications.register()
  } catch {
    /* push requires google-services.json / APNs setup in the native projects */
  }
  return cleanup
}
