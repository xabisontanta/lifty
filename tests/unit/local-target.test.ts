import { describe, expect, it } from 'vitest'
import { validateTestDatabaseUrl } from '../../scripts/test-database-target.mjs'

describe('database test target guard', () => {
  it.each(['postgresql://postgres:local@127.0.0.1:57322/postgres', 'postgres://postgres:local@localhost:57322/postgres', 'postgresql://postgres:local@[::1]:57322/postgres'])('accepts the isolated local target %s', url => {
    expect(validateTestDatabaseUrl(url).port).toBe('57322')
  })
  it.each(['postgresql://postgres:secret@db.example.supabase.co:5432/postgres', 'postgresql://postgres:local@127.0.0.1:54322/postgres', 'postgresql://postgres:local@127.0.0.1:57322/other_app', 'https://127.0.0.1:57322/postgres', 'postgresql://127.0.0.1.evil.invalid:57322/postgres'])('rejects hosted or unrelated database %s before connecting', url => {
    expect(() => validateTestDatabaseUrl(url)).toThrow()
  })
})
