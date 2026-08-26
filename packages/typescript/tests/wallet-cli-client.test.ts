import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mockSpawn }))

import {
  WalletCliClient,
  assertWalletCliNodeRuntime,
  validateWalletCliLaunchTarget,
  walletCliLaunchTargetFromPath,
} from '../src/core/clients/wallet-cli.js'
import {
  WalletCliExecutionError,
  WalletCliNotFoundError,
  WalletCliUsageError,
} from '../src/core/errors.js'

const DataSchema = z.object({ address: z.string() })
const contract = { command: 'current', dataSchema: DataSchema, chain: 'none' as const }

function envelope(data: unknown, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: 'wallet-cli.result.v1',
    success: true,
    command: 'current',
    data,
    meta: { durationMs: 1, warnings: [] },
    ...overrides,
  })
}

function failure(code: string, message: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: 'wallet-cli.result.v1',
    success: false,
    command: 'current',
    error: { code, message },
    meta: { durationMs: 1, warnings: [] },
    ...overrides,
  })
}

function fakeChild(options: {
  stdout?: string | Buffer
  stderr?: string | Buffer
  exitCode?: number
  spawnError?: NodeJS.ErrnoException
  neverClose?: boolean
}) {
  const events = new EventEmitter()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const stdinChunks: Buffer[] = []
  let completed = false

  const complete = () => {
    if (completed || options.neverClose) return
    completed = true
    process.nextTick(() => {
      if (options.spawnError) {
        events.emit('error', options.spawnError)
        return
      }
      if (options.stdout) stdout.write(options.stdout)
      if (options.stderr) stderr.write(options.stderr)
      stdout.end()
      stderr.end()
      events.emit('close', options.exitCode ?? 0)
    })
  }
  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      stdinChunks.push(Buffer.from(chunk))
      callback()
    },
    final(callback) {
      complete()
      callback()
    },
  })
  const child = Object.assign(events, {
    stdin,
    stdout,
    stderr,
    kill: vi.fn((signal: string) => {
      if (!completed && options.neverClose && signal === 'SIGKILL') {
        completed = true
        events.emit('close', null)
      } else if (!completed && !options.neverClose) {
        complete()
      }
      return true
    }),
  })
  return { child, stdinChunks }
}

describe('WalletCliClient bounded runner', () => {
  beforeEach(() => mockSpawn.mockReset())

  it('maps JavaScript paths to Node and rejects unsafe Windows shell shims', () => {
    expect(
      walletCliLaunchTargetFromPath('C:\\wallet\\dist\\index.js', 'win32', 'node.exe'),
    ).toEqual({
      command: 'node.exe',
      argsPrefix: ['C:\\wallet\\dist\\index.js'],
    })
    expect(() => validateWalletCliLaunchTarget({ command: 'wallet-cli.cmd' }, 'win32')).toThrow(
      /JavaScript entrypoint/,
    )
    expect(() =>
      assertWalletCliNodeRuntime(
        { command: 'node.exe', argsPrefix: ['index.js'] },
        'v18.20.0',
        'node.exe',
      ),
    ).toThrow(/Node\.js >=20/)
  })

  it('accepts a valid success envelope and always uses shell:false', async () => {
    const { child } = fakeChild({ stdout: envelope({ address: 'T123' }) })
    mockSpawn.mockReturnValueOnce(child)
    const result = await new WalletCliClient({ binary: '/safe/wallet-cli' }).run(
      ['current', '-o', 'json'],
      contract,
    )
    expect(result.data.address).toBe('T123')
    expect(mockSpawn.mock.calls[0][2]).toMatchObject({ shell: false })
  })

  it('resolves launch target precedence before binary and environment overrides', async () => {
    const env = {
      ...process.env,
      AGENT_WALLET_WALLET_CLI_PATH: '/environment/wallet-cli',
    }
    for (const options of [
      {
        launchTarget: { command: '/explicit/node', argsPrefix: ['/explicit/index.js'] },
        binary: '/binary/wallet-cli',
        env,
        expected: ['/explicit/node', '/explicit/index.js'],
      },
      {
        binary: '/binary/wallet-cli',
        env,
        expected: ['/binary/wallet-cli'],
      },
      {
        env,
        expected: ['/environment/wallet-cli'],
      },
    ]) {
      mockSpawn.mockReturnValueOnce(fakeChild({ stdout: envelope({ address: 'T123' }) }).child)
      const { expected, ...clientOptions } = options
      await new WalletCliClient(clientOptions).run(['current'], contract)
      const call = mockSpawn.mock.calls.at(-1)!
      expect(call[0]).toBe(expected[0])
      expect(call[1]).toEqual([...(expected.slice(1) as string[]), 'current'])
    }
  })

  it('preserves structured warnings and additive fields', async () => {
    const { child } = fakeChild({
      stdout: envelope(
        { address: 'T123', future: true },
        { meta: { durationMs: 1, warnings: [{ code: 'future', message: 'notice' }] } },
      ),
    })
    mockSpawn.mockReturnValueOnce(child)
    const result = await new WalletCliClient({ binary: 'wallet-cli' }).run(['current'], contract)
    expect(result.meta.warnings).toEqual([{ code: 'future', message: 'notice' }])
  })

  it('dispatches exit 1/2 by class and tolerates unknown error codes', async () => {
    mockSpawn.mockReturnValueOnce(
      fakeChild({ stdout: failure('future_error', 'runtime failure'), exitCode: 1 }).child,
    )
    await expect(
      new WalletCliClient({ binary: 'wallet-cli' }).run(['current'], contract),
    ).rejects.toMatchObject({ code: 'future_error' } satisfies Partial<WalletCliExecutionError>)

    mockSpawn.mockReturnValueOnce(
      fakeChild({ stdout: failure('future_usage', 'bad invocation'), exitCode: 2 }).child,
    )
    await expect(
      new WalletCliClient({ binary: 'wallet-cli' }).run(['current'], contract),
    ).rejects.toBeInstanceOf(WalletCliUsageError)
  })

  it('rejects command and chain mismatches in failure envelopes', async () => {
    for (const sample of [
      failure('auth_failed', 'wrong password', { command: 'account.remove' }),
      failure('auth_failed', 'wrong password', {
        chain: { family: 'tron', network: 'tron:nile', chainId: 'nile' },
      }),
    ]) {
      mockSpawn.mockReturnValueOnce(fakeChild({ stdout: sample, exitCode: 1 }).child)
      await expect(
        new WalletCliClient({ binary: 'wallet-cli' }).run(['current'], contract),
      ).rejects.toMatchObject({ code: 'contract_mismatch' })
    }
  })

  it('removes control characters and bounds a valid failure-envelope message', async () => {
    const rawMessage = `bad\0line\n${'x'.repeat(600)}`
    mockSpawn.mockReturnValueOnce(
      fakeChild({ stdout: failure('future_error', rawMessage), exitCode: 1 }).child,
    )
    let caught: WalletCliExecutionError | undefined
    try {
      await new WalletCliClient({ binary: 'wallet-cli' }).run(['current'], contract)
    } catch (error) {
      caught = error as WalletCliExecutionError
    }
    expect(caught?.message).not.toContain('\0')
    expect(caught?.message).not.toContain('\n')
    expect(caught?.message).toHaveLength(512)
  })

  it('rejects command, neutral-chain, data and success/exit mismatches', async () => {
    for (const sample of [
      envelope({ address: 'T123' }, { command: 'list' }),
      envelope(
        { address: 'T123' },
        { chain: { family: 'tron', network: 'tron:nile', chainId: 'nile' } },
      ),
      envelope({ wrong: true }),
    ]) {
      mockSpawn.mockReturnValueOnce(fakeChild({ stdout: sample }).child)
      await expect(
        new WalletCliClient({ binary: 'wallet-cli' }).run(['current'], contract),
      ).rejects.toMatchObject({ code: 'contract_mismatch' })
    }

    mockSpawn.mockReturnValueOnce(
      fakeChild({ stdout: envelope({ address: 'T123' }), exitCode: 1 }).child,
    )
    await expect(
      new WalletCliClient({ binary: 'wallet-cli' }).run(['current'], contract),
    ).rejects.toMatchObject({ code: 'contract_mismatch' })
  })

  it('maps ENOENT without exposing the OS command line', async () => {
    const error = new Error('spawn /secret/path ENOENT') as NodeJS.ErrnoException
    error.code = 'ENOENT'
    mockSpawn.mockReturnValueOnce(fakeChild({ spawnError: error }).child)
    let caught: Error | undefined
    try {
      await new WalletCliClient({ binary: '/secret/path' }).run(['current'], contract)
    } catch (value) {
      caught = value as Error
    }
    expect(caught).toBeInstanceOf(WalletCliNotFoundError)
    expect(caught?.message).not.toContain('/secret/path')
  })

  it('writes the configured stdin payload exactly once', async () => {
    const { child, stdinChunks } = fakeChild({ stdout: envelope({ address: 'T123' }) })
    mockSpawn.mockReturnValueOnce(child)
    await new WalletCliClient({ binary: 'wallet-cli' }).run(['current'], {
      ...contract,
      stdin: 'signed-transaction',
    })
    expect(Buffer.concat(stdinChunks).toString('utf8')).toBe('signed-transaction')
  })

  it('classifies a lease stdin write failure without exposing the underlying message', async () => {
    const { child } = fakeChild({})
    mockSpawn.mockReturnValueOnce(child)
    const lease = {
      writeTo: vi.fn().mockRejectedValue(new Error('fixture-password leaked here')),
      dispose: vi.fn(),
    }
    let caught: WalletCliExecutionError | undefined
    try {
      await new WalletCliClient({ binary: 'wallet-cli' }).run(['current'], {
        ...contract,
        stdin: lease,
      })
    } catch (error) {
      caught = error as WalletCliExecutionError
    }
    expect(caught?.code).toBe('stdin_write')
    expect(caught?.message).not.toContain('fixture-password')
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('bounds stdout without including its contents in the error', async () => {
    const secretOutput = 'leaked-wallet-output'
    mockSpawn.mockReturnValueOnce(
      fakeChild({ stdout: Buffer.from(secretOutput.repeat(100)), exitCode: 0 }).child,
    )
    let caught: WalletCliExecutionError | undefined
    try {
      await new WalletCliClient({ binary: 'wallet-cli', maxStdoutBytes: 32 }).run(
        ['current'],
        contract,
      )
    } catch (error) {
      caught = error as WalletCliExecutionError
    }
    expect(caught?.code).toBe('output_limit')
    expect(caught?.message).not.toContain(secretOutput)
  })

  it('escalates timeout from TERM to KILL and settles once', async () => {
    vi.useFakeTimers()
    const { child } = fakeChild({ neverClose: true })
    mockSpawn.mockReturnValueOnce(child)
    const promise = new WalletCliClient({
      binary: 'wallet-cli',
      timeoutMs: 10,
      killGraceMs: 20,
    })
      .run(['current'], contract)
      .catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(10)
    await vi.advanceTimersByTimeAsync(20)
    const error = await promise
    expect(error).toMatchObject({ code: 'timeout' })
    expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGTERM')
    expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL')
    vi.useRealTimers()
  })

  it('aborts with TERM then KILL and removes the abort listener after settling', async () => {
    vi.useFakeTimers()
    const { child } = fakeChild({ neverClose: true })
    mockSpawn.mockReturnValueOnce(child)
    const controller = new AbortController()
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')
    const promise = new WalletCliClient({
      binary: 'wallet-cli',
      timeoutMs: 1_000,
      killGraceMs: 20,
    })
      .run(['current'], { ...contract, signal: controller.signal })
      .catch((error: unknown) => error)

    controller.abort()
    await vi.advanceTimersByTimeAsync(20)
    const error = await promise
    expect(error).toMatchObject({ code: 'aborted' })
    expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGTERM')
    expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL')
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))
    vi.useRealTimers()
  })
})
