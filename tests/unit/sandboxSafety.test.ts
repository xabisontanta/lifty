import { describe, expect, it } from 'vitest'
import { assertLocalDockerEndpoint, assertLoopbackUrl, assertSandboxDirectory, sandboxDirectory } from '../../scripts/sandbox-safety.mjs'

describe('sandbox safety boundary', () => {
  it('rejects hosted projects, arbitrary network addresses, and hostname lookalikes', () => {
    for (const url of ['https://test.supabase.co', 'postgres://user:secret@10.0.0.2:57322/postgres', 'http://localhost.attacker.invalid:57321', 'http://127.0.0.1.attacker.invalid']) expect(() => assertLoopbackUrl(url)).toThrow(/loopback/)
    expect(assertLoopbackUrl('http://127.0.0.1:57321').port).toBe('57321')
    expect(assertLoopbackUrl('postgresql://postgres:local@localhost:57322/postgres').hostname).toBe('localhost')
  })
  it('never accepts a parent or unrelated directory for recursive staging cleanup', () => {
    expect(assertSandboxDirectory(sandboxDirectory())).toBe(sandboxDirectory())
    expect(() => assertSandboxDirectory('../')).toThrow(/leaves/)
    expect(() => assertSandboxDirectory('supabase')).toThrow(/leaves/)
  })
  it('rejects remote Docker contexts even when a container name matches', () => {
    for (const endpoint of ['ssh://staging.example', 'tcp://127.0.0.1:2376', 'npipe:////remote/pipe/docker', undefined]) expect(() => assertLocalDockerEndpoint(endpoint)).toThrow(/local Docker/)
    expect(() => assertLocalDockerEndpoint('npipe:////./pipe/dockerDesktopLinuxEngine')).not.toThrow()
    expect(() => assertLocalDockerEndpoint('unix:///var/run/docker.sock')).not.toThrow()
  })
})
