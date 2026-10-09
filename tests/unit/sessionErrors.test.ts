import { describe, expect, it } from 'vitest'
import { isSessionProblem, isTransientProblem, restoreFailureMessage } from '@/services/sessionErrors'

describe('bad session vs bad signal', () => {
  it.each([
    [{ code: 'PGRST301', message: 'JWT expired' }],
    [{ message: 'JWT expired' }],
    [{ message: 'Invalid JWT' }],
    [{ code: 'refresh_token_not_found', message: 'Invalid Refresh Token: Refresh Token Not Found' }],
    [{ code: 'session_not_found', message: 'Session from session_id claim in JWT does not exist' }],
    [{ message: 'User from sub claim in JWT does not exist' }],
    [{ message: 'Not authenticated' }],
    [{ message: 'Auth session missing!' }],
    [{ code: 'auth', message: 'whatever' }],
    [{ status: 401, message: 'Unauthorized' }],
  ])('%j is a session problem (sign in again)', (e) => {
    expect(isSessionProblem(e)).toBe(true)
  })

  it.each([
    [{ name: 'AuthRetryableFetchError', message: 'Failed to fetch' }],
    [{ message: 'Failed to fetch' }],
    [{ message: 'NetworkError when attempting to fetch resource.' }],
    [{ message: 'Load failed' }],
    [{ status: 503, message: 'Service Unavailable' }],
    [{ status: 0, message: '' }],
    [{ message: 'The request timed out' }],
  ])('%j is transient (keep the login, offer a retry)', (e) => {
    expect(isTransientProblem(e)).toBe(true)
    expect(isSessionProblem(e)).toBe(false) // a weak signal must never sign anyone out
  })

  it('ordinary application errors are neither', () => {
    for (const e of [{ message: 'Commute not found' }, { code: '23505', message: 'duplicate key value' }, new Error('Enter your full name')]) {
      expect(isSessionProblem(e)).toBe(false)
      expect(isTransientProblem(e)).toBe(false)
    }
    expect(isSessionProblem(null)).toBe(false)
    expect(isSessionProblem(undefined)).toBe(false)
  })

  it('the full-screen message is plain language, never the raw error', () => {
    expect(restoreFailureMessage({ message: 'Failed to fetch' })).toMatch(/check your connection/i)
    expect(restoreFailureMessage({ message: 'weird server thing' })).toMatch(/sign out and sign back in/i)
    expect(restoreFailureMessage({ message: 'JWT expired' })).not.toMatch(/JWT/)
  })
})
