import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock child_process.spawn — we control the fake child per-test
const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mockSpawn }))

import { WalletCliClient } from '../src/core/clients/wallet-cli.js'
import {
  WalletCliExecutionError,
  WalletCliUsageError,
  WalletCliNotFoundError,
} from '../src/core/errors.js'

// ---------------------------------------------------------------------------
// Fake child process — properly handles event ordering:
// stdout/stderr on() → stdin.write() → stdin.end() → on('error'/'close')
// stdin.end() schedules stdout emission + close via process.nextTick,
// so all handlers are registered before events fire.
// ---------------------------------------------------------------------------

function makeFakeChild(stdout: string, exitCode: number, error?: NodeJS.ErrnoException) {
  const handlers: Record<string, ((...args: unknown[]) => void) | undefined> = {}
  const stdinWrites: string[] = []

  const child = {
    stdin: {
      write: vi.fn((data: string) => {
        stdinWrites.push(data)
      }),
      on: vi.fn(),
      end: vi.fn(() => {
        process.nextTick(() => {
          if (error) {
            handlers.error?.(error)
            return
          }
          if (stdout) handlers.data?.(Buffer.from(stdout))
          handlers.close?.(exitCode)
        })
      }),
    },
    stdout: {
      on(event: string, cb: (...args: unknown[]) => void) {
        if (event === 'data') handlers.data = cb
      },
    },
    stderr: { on: vi.fn() },
    on(event: string, cb: (...args: unknown[]) => void) {
      handlers[event] = cb
    },
    kill: vi.fn(),
  }

  return { child, stdinWrites }
}

function setSpawnResult(stdout: string, exitCode: number, error?: NodeJS.ErrnoException) {
  const { child, stdinWrites } = makeFakeChild(stdout, exitCode, error)
  mockSpawn.mockImplementationOnce(() => child)
  return { child, stdinWrites }
}

const ENVELOPE_OK = (data: unknown, command = 'test') =>
  JSON.stringify({
    schema: 'wallet-cli.result.v1',
    success: true,
    command,
    data,
    meta: { durationMs: 10, warnings: [] },
  })

const ENVELOPE_ERR = (code: string, message: string, command = 'test') =>
  JSON.stringify({
    schema: 'wallet-cli.result.v1',
    success: false,
    command,
    error: { code, message },
    meta: { durationMs: 10, warnings: [] },
  })

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WalletCliClient', () => {
  beforeEach(() => {
    mockSpawn.mockReset()
  })

  it('returns data on exit code 0', async () => {
    setSpawnResult(ENVELOPE_OK({ address: 'T123' }), 0)
    const client = new WalletCliClient({ binary: 'wallet-cli' })
    const result = await client.run(['current', '-o', 'json'])
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ address: 'T123' })
  })

  it('throws WalletCliExecutionError on exit code 1', async () => {
    setSpawnResult(ENVELOPE_ERR('auth_failed', 'wrong password'), 1)
    const client = new WalletCliClient({ binary: 'wallet-cli' })
    try {
      await client.run(['message', 'sign'])
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(WalletCliExecutionError)
      expect((e as WalletCliExecutionError).code).toBe('auth_failed')
    }
  })

  it('throws WalletCliUsageError on exit code 2', async () => {
    setSpawnResult(ENVELOPE_ERR('missing_option', 'missing --message'), 2)
    const client = new WalletCliClient({ binary: 'wallet-cli' })
    await expect(client.run(['message', 'sign'])).rejects.toThrow(WalletCliUsageError)
  })

  it('throws WalletCliNotFoundError on ENOENT', async () => {
    const err = new Error('spawn ENOENT') as NodeJS.ErrnoException
    err.code = 'ENOENT'
    setSpawnResult('', -1, err)
    const client = new WalletCliClient({ binary: 'nonexistent-binary' })
    await expect(client.run(['current'])).rejects.toThrow(WalletCliNotFoundError)
  })

  it('writes stdin payload (password) then closes', async () => {
    const { stdinWrites } = setSpawnResult(ENVELOPE_OK({ signed: {} }), 0)
    const client = new WalletCliClient({ binary: 'wallet-cli' })
    await client.run(['tx', 'sign', '--password-stdin'], 'my-secret-password')
    expect(stdinWrites).toContain('my-secret-password')
  })

  it('rejects invalid JSON output', async () => {
    setSpawnResult('not json at all', 0)
    const client = new WalletCliClient({ binary: 'wallet-cli' })
    await expect(client.run(['current'])).rejects.toThrow()
  })

  it('rejects output with wrong schema', async () => {
    setSpawnResult(JSON.stringify({ schema: 'wrong.version', success: true, command: 'test' }), 0)
    const client = new WalletCliClient({ binary: 'wallet-cli' })
    await expect(client.run(['current'])).rejects.toThrow()
  })

  it('uses custom binary path when provided', async () => {
    setSpawnResult(ENVELOPE_OK({ ok: true }), 0)
    const client = new WalletCliClient({ binary: '/custom/path/wallet-cli' })
    await client.run(['current'])
    expect(mockSpawn.mock.calls[0][0]).toBe('/custom/path/wallet-cli')
  })
  it('kills with SIGTERM then SIGKILL on timeout', async () => {
    vi.useFakeTimers()

    // "Zombie" child: never emits stdout/close until killed
    const killCalls: string[] = []
    let closeHandler: ((code: number | null) => void) | undefined
    const zombieChild = {
      stdin: { write: vi.fn(), on: vi.fn(), end: vi.fn() },
      stdout: {
        on: vi.fn(),
      },
      stderr: { on: vi.fn() },
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'close') closeHandler = cb as (code: number | null) => void
      }),
      kill: vi.fn((sig: string) => {
        killCalls.push(sig)
        // Real timed-out processes commonly close without a JSON envelope.
        if (sig === 'SIGKILL') {
          closeHandler?.(1)
        }
      }),
    }
    mockSpawn.mockImplementationOnce(() => zombieChild)

    const client = new WalletCliClient({ binary: 'wallet-cli', timeoutMs: 50 })
    const promise = client.run(['current'])
    // Attach catch handler early to prevent unhandled rejection when
    // the timeout reject fires inside advanceTimersByTimeAsync
    const resultPromise = promise.catch((e: unknown) => e)

    // Fire the timeout → triggers SIGTERM + schedules SIGKILL escalation
    await vi.advanceTimersByTimeAsync(50)
    // Fire the 5s SIGKILL escalation delay
    await vi.advanceTimersByTimeAsync(5000)

    const caught = await resultPromise
    expect(caught).toBeInstanceOf(WalletCliExecutionError)
    expect((caught as WalletCliExecutionError).code).toBe('timeout')
    expect(killCalls[0]).toBe('SIGTERM')
    expect(killCalls).toContain('SIGKILL')

    vi.useRealTimers()
  })
})
