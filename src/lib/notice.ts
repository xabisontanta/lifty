/**
 * One-time messages that must survive a screen change (e.g. "Your session expired" shown on the welcome screen after the app
 * signed the user out). Stored per tab (sessionStorage) and read exactly once.
 */
const NOTICE_KEY = 'lifty.notice'
const DELIBERATE_KEY = 'lifty.signedOutOnPurpose'

export function setNotice(message: string) {
  try {
    sessionStorage.setItem(NOTICE_KEY, message)
  } catch {
    /* storage unavailable — the sign-out still happens, just without the explanation */
  }
}

export function peekNotice(): string | null {
  try {
    return sessionStorage.getItem(NOTICE_KEY)
  } catch {
    return null
  }
}

export function clearNotice() {
  try {
    sessionStorage.removeItem(NOTICE_KEY)
  } catch {
    /* ignore */
  }
}

export function takeNotice(): string | null {
  try {
    const m = sessionStorage.getItem(NOTICE_KEY)
    if (m) sessionStorage.removeItem(NOTICE_KEY)
    return m
  } catch {
    return null
  }
}

/** Marks a sign-out the user asked for, so the unexpected-sign-out explanation is not shown after it. */
export function markDeliberateSignOut() {
  try {
    sessionStorage.setItem(DELIBERATE_KEY, String(Date.now()))
  } catch {
    /* ignore */
  }
}

export function wasDeliberateSignOut(withinMs = 10_000): boolean {
  try {
    const at = Number(sessionStorage.getItem(DELIBERATE_KEY) ?? 0)
    return at > 0 && Date.now() - at < withinMs
  } catch {
    return false
  }
}
