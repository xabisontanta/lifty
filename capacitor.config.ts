import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'za.co.lifty.app',
  appName: 'Lifty',
  webDir: 'dist',
  backgroundColor: '#0F2D4A',
  // Background-geolocation's documented Android bridge requirement.
  android: { useLegacyBridge: true },
  plugins: {
    // Native transport avoids WebView HTTP throttling during locked-screen tracking.
    CapacitorHttp: { enabled: true },
    LocalNotifications: { iconColor: '#00B386' },
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
}

export default config
