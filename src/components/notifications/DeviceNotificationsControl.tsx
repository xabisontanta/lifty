import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { Card, SecondaryButton, useToast } from '@/components/ui/kit'
import { isNative } from '@/services/location'
import { ensureNotificationPermission, getPushRegistrationState, subscribePushRegistrationState } from '@/services/notifications'

export function DeviceNotificationsControl() {
  const toast = useToast()
  const [push, setPush] = useState(getPushRegistrationState)
  const [requesting, setRequesting] = useState(false)
  const native = isNative() && Capacitor.getPlatform() === 'android'
  useEffect(() => subscribePushRegistrationState(setPush), [])
  const pending = requesting || (native && (push.status === 'registering' || push.status === 'saving'))
  const status = !native ? 'Browser alerts work while Lifty is open. Your requests and messages also remain in the inbox.'
    : push.status === 'ready' ? 'This device is registered for push alerts. Delivery also depends on your connection and device settings.'
    : push.status === 'registering' ? 'Registering this device for alerts…'
    : push.status === 'saving' ? 'Saving this device’s notification destination…'
    : push.status === 'permission-denied' ? 'Notifications are blocked in device settings. Your inbox remains available.'
    : push.status === 'error' ? 'Device notification setup could not finish. Retry when connected; your inbox remains available.'
    : 'Allow alerts on this device. Your requests and messages remain in the inbox if an alert cannot be delivered.'
  async function enable() {
    setRequesting(true)
    try {
      const granted = await ensureNotificationPermission()
      if (!granted) { toast('Notifications are blocked or unavailable. Use your inbox and device settings.', 'info'); return }
      if (native) {
        window.dispatchEvent(new Event('lifty:enable-push'))
        toast('Checking this device’s notification setup…', 'info')
      } else toast('Browser alerts are allowed while Lifty is open.', 'success')
    } finally { setRequesting(false) }
  }
  return <Card>
    <h2 className="h3">Commute notifications</h2>
    <p className="small muted" role="status" aria-live="polite">{status}</p>
    <SecondaryButton disabled={pending} onClick={() => void enable()}>{pending ? 'Enabling notifications…' : 'Enable device notifications'}</SecondaryButton>
  </Card>
}
