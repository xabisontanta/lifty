import { env } from '@/lib/env'

/**
 * Crash + error reporting. Sentry is only downloaded when VITE_SENTRY_DSN is set,
 * so users on mobile data don't pay for it otherwise.
 */
type SentryModule = typeof import('@sentry/react')
let sentry: SentryModule | null = null

export function initMonitoring() {
  if (!env.sentryDsn) return
  void import('@sentry/react').then((S) => {
    S.init({
      dsn: env.sentryDsn,
      tracesSampleRate: 0.1,
      // Never ship locations or phone numbers to the error tracker (POPIA).
      beforeSend(event) {
        if (event.request?.data) event.request.data = '[redacted]'
        return event
      },
    })
    sentry = S
  })
}

export function reportError(error: unknown, context?: Record<string, unknown>) {
  if (sentry) sentry.captureException(error, { extra: context })
  else console.error('[lifty]', error, context ?? '')
}
