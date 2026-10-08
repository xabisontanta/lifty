import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'za.co.lifty.app',
  appName: 'Lifty',
  webDir: 'dist',
  backgroundColor: '#0F2D4A',
  plugins: {
    LocalNotifications: { iconColor: '#00B386' },
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
}

export default config
