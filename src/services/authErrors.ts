import { ApiError } from './api'

/**
 * Turns a Supabase Auth / SMS-provider failure into something a person can act on.
 * Twilio's numeric code is kept as a short reference — it is what tells the team which provider setting is wrong.
 */
export function authFail(e: { message?: string; code?: string } | null, step: 'sign-up' | 'sign-in' | 'verify'): never {
  const msg = e?.message ?? ''
  const code = e?.code ?? ''
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ApiError("You're offline. Check your connection and try again.", 'offline')
  if (step === 'verify' && (code === 'otp_expired' || /expired|invalid|incorrect/i.test(msg))) throw new ApiError('That code is wrong or has expired. Check it, or request a new one.', 'otp')
  if (code === 'over_sms_send_rate_limit' || code === 'over_request_rate_limit' || /rate limit|too many|only request this after/i.test(msg))
    throw new ApiError('Please wait a minute before asking for another code.', 'rate-limit')
  // Signing in with a number that has no account: GoTrue says "signups not allowed for otp". That is not a configuration problem.
  if (step === 'sign-in' && (code === 'otp_disabled' || /signups not allowed/i.test(msg)))
    throw new ApiError('We couldn’t find a Lifty account for that number. Create an account first.', 'no-account')
  if (code === 'phone_provider_disabled' || /unsupported phone provider|phone signups are disabled/i.test(msg))
    throw new ApiError('Phone sign-in isn’t switched on for this Lifty project yet. You can explore Lifty in demo mode meanwhile.', 'not-configured')
  if (code === 'sms_send_failed' || /error sending (confirmation|sms|otp)/i.test(msg)) {
    const twilio = msg.match(/errors\/(\d{4,5})/)?.[1]
    const ref = twilio ? ` (SMS provider error ${twilio})` : ''
    if (twilio === '21211' || twilio === '21614' || twilio === '21612') throw new ApiError(`That doesn’t look like a mobile number we can text. Check it and try again.${ref}`, 'sms-failed')
    if (twilio === '21608') throw new ApiError(`We can’t text this number yet — the SMS provider is still in trial mode and only sends to verified numbers.${ref}`, 'sms-failed')
    if (twilio === '21408') throw new ApiError(`Texts to South Africa aren’t enabled with our SMS provider yet.${ref}`, 'sms-failed')
    if (twilio === '21610') throw new ApiError(`This number has opted out of texts from our provider. Reply START to the last message, then try again.${ref}`, 'sms-failed')
    if (twilio && /^(21212|21606|21609|21617|20003|20404|20422)$/.test(twilio)) throw new ApiError(`We can’t send codes right now — our SMS sender isn’t set up correctly. The team has been told.${ref}`, 'sms-failed')
    throw new ApiError(`We couldn’t send your code right now. Please try again in a few minutes.${ref}`, 'sms-failed')
  }
  throw new ApiError(msg.replace(/^.*?ERROR:\s*/, '') || 'Something went wrong. Please try again.', 'server')
}
