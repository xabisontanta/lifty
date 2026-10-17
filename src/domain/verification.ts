import type { PublicVerification } from './types'
export function driverIsVerified(value: PublicVerification): boolean {
  return value.identity === 'verified' && value.licence === 'verified' && value.vehicle === 'verified' && value.insurance === 'verified'
}
