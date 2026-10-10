import { assertLoopbackUrl, assertLocalContainer } from './sandbox-safety.mjs'

export function validateTestDatabaseUrl(value) {
  const url = assertLoopbackUrl(value)
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.port !== '57322' || url.pathname !== '/postgres') {
    throw new Error('Database tests only run against the Lifty local sandbox on port 57322, database postgres.')
  }
  return url
}

export function assertTestDatabase(value) {
  validateTestDatabaseUrl(value)
  assertLocalContainer()
}
