/**
 * Tells a BAD SESSION (expired, revoked, user gone — the only cure is to sign in again) apart from a TRANSIENT problem
 * (weak connection, server hiccup — the session is fine and a retry will work). Signing a user out because their phone
 * briefly lost signal would be as wrong as showing "JWT expired" with a Retry button that can never succeed.
 */
interface ErrorLike {
  message?: string
  code?: string
  name?: string
  status?: number
}

const SESSION_CODES = new Set(['auth', 'bad_jwt', 'session_not_found', 'session_expired', 'user_not_found', 'refresh_token_not_found', 'refresh_token_already_used', 'no_authorization', 'PGRST301', 'PGRST302', 'PGRST303'])
const SESSION_MESSAGE = /\bJWT\b|jwt expired|invalid refresh token|refresh token not found|refresh_token_not_found|auth session missing|not authenticated|user from sub claim|session (not found|expired|missing)|invalid claim/i
const NETWORK_MESSAGE = /failed to fetch|network ?error|load failed|networkerror|timed? ?out|timeout|offline|econnreset|err_internet|fetch failed/i

export function isSessionProblem(e: unknown): boolean {
  const x = (e ?? {}) as ErrorLike
  if (x.code && SESSION_CODES.has(x.code)) return true
  if (x.status === 401) return true
  return SESSION_MESSAGE.test(x.message ?? '')
}

export function isTransientProblem(e: unknown): boolean {
  const x = (e ?? {}) as ErrorLike
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  if (x.name === 'AuthRetryableFetchError') return true
  if (typeof x.status === 'number' && (x.status === 0 || x.status >= 500)) return true
  return NETWORK_MESSAGE.test(x.message ?? '')
}

/** Wording for the full-screen "couldn't restore your account" state (never raw technical text). */
export function restoreFailureMessage(e: unknown): string {
  return isTransientProblem(e) ? 'We couldn’t reach Lifty. Check your connection, then try again.' : 'We couldn’t restore your account just now. Try again, or sign out and sign back in.'
}

/** Is there a saved login in this browser? (supabase-js keeps it under sb-<project>-auth-token.) */
export function hasStoredLogin(): boolean {
  try {
    return Object.keys(localStorage).some((k) => /^sb-.+-auth-token$/.test(k))
  } catch {
    return false
  }
}
