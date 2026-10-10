import { describe, expect, it } from 'vitest'
import { ApiError } from '@/services/api'
import { authFail } from '@/services/authErrors'

const run = (e: { message?: string; code?: string }, step: Parameters<typeof authFail>[1]) => {
  try {
    authFail(e, step)
  } catch (x) {
    return x as ApiError
  }
  throw new Error('authFail must always throw')
}

// Messages below are copied from the real Supabase Auth logs of the Lifty project.
describe('sign-up / sign-in error mapping', () => {
  it('the production failure: the SMS sender is set to a Twilio Account SID (21212)', () => {
    const e = run({ code: 'sms_send_failed', message: "Error sending confirmation OTP to provider: Invalid From Number (caller ID): AC00000000000000000000000000000000 More information: https://www.twilio.com/docs/errors/21212" }, 'sign-up')
    expect(e.code).toBe('sms-failed')
    expect(e.message).toMatch(/sender isn’t set up correctly/)
    expect(e.message).toContain('21212')
    expect(e.message).not.toMatch(/AC0000/) // never echo account identifiers to the screen
  })

  it('login with a number that has no account is NOT reported as "phone sign-in isn’t switched on"', () => {
    const e = run({ code: 'otp_disabled', message: 'Signups not allowed for otp' }, 'sign-in')
    expect(e.code).toBe('no-account')
    expect(e.message).toMatch(/Create an account first/)
    expect(e.message).not.toMatch(/switched on/)
  })

  it('phone auth genuinely switched off is still reported as not configured', () => {
    expect(run({ code: 'phone_provider_disabled', message: 'Phone signups are disabled' }, 'sign-up').code).toBe('not-configured')
    expect(run({ message: 'Unsupported phone provider' }, 'sign-in').code).toBe('not-configured')
  })

  it.each([
    ['21211', 'sms-failed', /mobile number/],
    ['21608', 'sms-failed', /trial mode/],
    ['21408', 'sms-failed', /South Africa/],
    ['21610', 'sms-failed', /opted out/],
    ['20003', 'sms-failed', /sender isn’t set up/],
  ])('Twilio %s gets a specific, actionable message', (twilio, code, text) => {
    const e = run({ code: 'sms_send_failed', message: `Error sending confirmation OTP to provider: x More information: https://www.twilio.com/docs/errors/${twilio}` }, 'sign-up')
    expect(e.code).toBe(code)
    expect(e.message).toMatch(text)
    expect(e.message).toContain(twilio)
  })

  it('an unknown SMS failure still gives a safe generic message', () => {
    const e = run({ code: 'sms_send_failed', message: 'Error sending confirmation OTP to provider: boom' }, 'sign-up')
    expect(e.code).toBe('sms-failed')
    expect(e.message).toMatch(/try again in a few minutes/)
  })

  it('a rate limit that states the wait shows the real number of seconds', () => {
    expect(run({ code: 'over_sms_send_rate_limit', message: 'For security purposes, you can only request this after 42 seconds.' }, 'sign-in').message).toBe('Please wait 42 seconds before asking for another code.')
  })

  it('a wait of under a second is never shown as "0 seconds"', () => {
    const wait = (n: number) => run({ code: 'over_sms_send_rate_limit', message: `For security purposes, you can only request this after ${n} second${n === 1 ? '' : 's'}.` }, 'sign-in').message
    expect(wait(0)).toBe('Please wait 1 second before asking for another code.')
    expect(wait(1)).toBe('Please wait 1 second before asking for another code.')
    expect(wait(2)).toBe('Please wait 2 seconds before asking for another code.')
  })

  it('rate limits', () => {
    expect(run({ code: 'over_sms_send_rate_limit', message: 'SMS rate limit exceeded' }, 'sign-in').code).toBe('rate-limit')
    expect(run({ message: 'For security purposes, you can only request this after 42 seconds.' }, 'sign-up').code).toBe('rate-limit')
  })

  it('a wrong or expired code is explained on the verify step only', () => {
    expect(run({ code: 'otp_expired', message: 'Token has expired or is invalid' }, 'verify')).toMatchObject({ code: 'otp' })
    // the same words on the send step must not be mistaken for a bad code
    expect(run({ code: 'sms_send_failed', message: "Error sending confirmation OTP to provider: Invalid 'To' Phone Number: +27 More information: https://www.twilio.com/docs/errors/21211" }, 'sign-up').code).toBe('sms-failed')
  })

  it('anything else keeps its own message', () => {
    const e = run({ message: 'ERROR: something specific' }, 'verify')
    expect(e.code).toBe('server')
    expect(e.message).toBe('something specific')
  })
})
