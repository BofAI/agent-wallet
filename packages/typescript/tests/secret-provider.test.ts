import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'

import { afterEach, describe, expect, it } from 'vitest'

import {
  ExecSecretProvider,
  StaticSecretProvider,
  defaultSecretProviderFactory,
  resolveSecretLaunchTarget,
  type SecretLease,
} from '../src/core/secret-provider.js'

const dirs: string[] = []
const context = { label: 'wallet-cli password', accountId: 'wlt_test.0', network: 'tron:nile' }
const isWindows = process.platform === 'win32'

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function consume(lease: SecretLease): Promise<string> {
  const chunks: Buffer[] = []
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk))
      callback()
    },
  })
  await lease.writeTo(destination)
  return Buffer.concat(chunks).toString('utf8')
}

function script(contents: { posix: string; windows: string }): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'agent-wallet-secret-provider-'))
  dirs.push(dir)
  const path = join(dir, isWindows ? 'secret.cmd' : 'secret.sh')
  writeFileSync(
    path,
    isWindows ? `@echo off\r\n${contents.windows}\r\n` : `#!/bin/sh\n${contents.posix}\n`,
    'utf8',
  )
  if (!isWindows) chmodSync(path, 0o700)
  return { dir, path }
}

describe('SecretProvider', () => {
  it('uses a fixed ComSpec argv for Windows cmd/bat sources while keeping shell:false viable', () => {
    for (const path of [
      'C:\\secrets\\password.cmd',
      'C:\\secret store\\password.BAT',
      'C:\\Program Files (x86)\\secret tools\\password.cmd',
      'C:\\secrets&tools\\password.cmd',
    ]) {
      expect(resolveSecretLaunchTarget(path, 'win32', 'cmd.exe')).toEqual({
        command: 'cmd.exe',
        args: ['/d', '/s', '/c', `""${path}""`],
        windowsVerbatimArguments: true,
      })
    }
    expect(resolveSecretLaunchTarget('/opt/secret.sh', 'linux')).toEqual({
      command: '/opt/secret.sh',
      args: [],
    })
  })

  it.each([
    'C:\\secrets^tools\\password.cmd',
    'C:\\%TEMP%\\password.cmd',
    'C:\\!SECRET_DIR!\\password.cmd',
    'C:\\secrets\\password\n.cmd',
    'C:\\secrets\\password".cmd',
  ])('rejects a Windows cmd path that could alter the command string: %s', (path) => {
    expect(() => resolveSecretLaunchTarget(path, 'win32', 'cmd.exe')).toThrow('unsafe characters')
  })

  it.each([' C:\\secrets\\password.cmd', 'C:\\secrets\\password.cmd ', 'C:\\password.cmd.'])(
    'rejects an ambiguous Windows secret path: %s',
    (path) => {
      expect(() => resolveSecretLaunchTarget(path, 'win32', 'cmd.exe')).toThrow(
        /surrounding whitespace|trailing dot/,
      )
    },
  )
  it('creates one-shot static leases and makes dispose idempotent', async () => {
    const provider = new StaticSecretProvider('  fixture-password\n')
    const lease = await provider.acquire(context)
    let written: Buffer | undefined
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        written = chunk as Buffer
        callback()
      },
    })
    await lease.writeTo(destination)
    expect(written?.toString('utf8')).toBe('fixture-password')
    await expect(consume(lease)).rejects.toThrow('only be consumed once')
    await lease.dispose()
    expect(written?.every((byte) => byte === 0)).toBe(true)
    await expect(lease.dispose()).resolves.toBeUndefined()
  })

  it('surfaces a bounded stdin write error and still permits idempotent disposal', async () => {
    const lease = await new StaticSecretProvider('fixture-password').acquire(context)
    const destination = new Writable({
      write(_chunk, _encoding, callback) {
        const error = Object.assign(new Error('pipe closed'), { code: 'EPIPE' })
        callback(error)
      },
    })

    await expect(lease.writeTo(destination)).rejects.toThrow('failed to write secret to stdin')
    await expect(lease.dispose()).resolves.toBeUndefined()
    await expect(lease.dispose()).resolves.toBeUndefined()
  })

  it('rejects empty static secrets', () => {
    expect(() => new StaticSecretProvider('  \n')).toThrow('empty')
  })

  it('executes an exec source for every acquire and trims its Buffer output', async () => {
    const { dir, path } = script({
      posix:
        'count_file="$(dirname "$0")/count"\ncount=$(cat "$count_file" 2>/dev/null || printf 0)\ncount=$((count + 1))\nprintf "%s" "$count" > "$count_file"\nprintf "  fixture-password  \\n"',
      windows:
        'set "count_file=%~dp0count"\r\nset "count=0"\r\nif exist "%count_file%" set /p count=<"%count_file%"\r\nset /a count+=1\r\n>"%count_file%" <nul set /p "=%count%"\r\n<nul set /p "=  fixture-password  "',
    })
    const provider = new ExecSecretProvider({ exec: path })
    const first = await provider.acquire(context)
    const second = await provider.acquire(context)
    expect(await consume(first)).toBe('fixture-password')
    expect(await consume(second)).toBe('fixture-password')
    expect(readFileSync(join(dir, 'count'), 'utf8')).toBe('2')
    await first.dispose()
    await second.dispose()
  })

  it('classifies timeout and output limits without including secret output', async () => {
    const timeoutScript = script({
      posix: 'sleep 2\nprintf leaked-secret',
      windows: 'ping -n 3 127.0.0.1 >nul\r\n<nul set /p "=leaked-secret"',
    })
    await expect(
      new ExecSecretProvider({ exec: timeoutScript.path, timeout: 20 }).acquire(context),
    ).rejects.toThrow('timed out')

    const outputScript = script({
      posix: 'printf leaked-secret-value',
      windows: '<nul set /p "=leaked-secret-value"',
    })
    let caught: Error | undefined
    try {
      await new ExecSecretProvider({ exec: outputScript.path }, 'wallet-cli password', {
        maxStdoutBytes: 4,
      }).acquire(context)
    } catch (error) {
      caught = error as Error
    }
    expect(caught?.message).toContain('stdout limit')
    expect(caught?.message).not.toContain('leaked-secret-value')

    const stderrScript = script({
      posix: 'printf leaked-stderr >&2\nsleep 1',
      windows: '<nul set /p "=leaked-stderr" 1>&2\r\nping -n 2 127.0.0.1 >nul',
    })
    await expect(
      new ExecSecretProvider({ exec: stderrScript.path }, 'wallet-cli password', {
        maxStderrBytes: 4,
      }).acquire(context),
    ).rejects.toThrow('stderr limit')
  })

  it('classifies empty output and non-zero exit without including process output', async () => {
    const emptyScript = script({
      posix: 'printf "  \n"',
      windows: '<nul set /p "=  "',
    })
    await expect(
      new ExecSecretProvider({ exec: emptyScript.path }).acquire(context),
    ).rejects.toThrow('produced no output')

    const failedScript = script({
      posix: 'printf leaked-output\nexit 7',
      windows: '<nul set /p "=leaked-output"\r\nexit /b 7',
    })
    let caught: Error | undefined
    try {
      await new ExecSecretProvider({ exec: failedScript.path }).acquire(context)
    } catch (error) {
      caught = error as Error
    }
    expect(caught?.message).toContain('code 7')
    expect(caught?.message).not.toContain('leaked-output')
  })

  it('preserves the public factory distinction between static and exec sources', () => {
    expect(defaultSecretProviderFactory('password', { label: 'test' })).toBeInstanceOf(
      StaticSecretProvider,
    )
    const { path } = script({
      posix: 'printf password',
      windows: '<nul set /p "=password"',
    })
    expect(defaultSecretProviderFactory({ exec: path }, { label: 'test' })).toBeInstanceOf(
      ExecSecretProvider,
    )
  })
})
