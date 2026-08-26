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

function script(contents: string): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'agent-wallet-secret-provider-'))
  dirs.push(dir)
  const path = join(dir, 'secret.sh')
  writeFileSync(path, `#!/bin/sh\n${contents}\n`, 'utf8')
  chmodSync(path, 0o700)
  return { dir, path }
}

describe('SecretProvider', () => {
  it('uses a fixed ComSpec argv for Windows cmd/bat sources while keeping shell:false viable', () => {
    expect(resolveSecretLaunchTarget('C:\\secrets\\password.cmd', 'win32', 'cmd.exe')).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'C:\\secrets\\password.cmd'],
    })
    expect(resolveSecretLaunchTarget('/opt/secret.sh', 'linux')).toEqual({
      command: '/opt/secret.sh',
      args: [],
    })
  })
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
    const { dir, path } = script(
      'count_file="$(dirname "$0")/count"\ncount=$(cat "$count_file" 2>/dev/null || printf 0)\ncount=$((count + 1))\nprintf "%s" "$count" > "$count_file"\nprintf "  fixture-password  \\n"',
    )
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
    const timeoutScript = script('sleep 2\nprintf leaked-secret')
    await expect(
      new ExecSecretProvider({ exec: timeoutScript.path, timeout: 20 }).acquire(context),
    ).rejects.toThrow('timed out')

    const outputScript = script('printf leaked-secret-value')
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

    const stderrScript = script('printf leaked-stderr >&2\nsleep 1')
    await expect(
      new ExecSecretProvider({ exec: stderrScript.path }, 'wallet-cli password', {
        maxStderrBytes: 4,
      }).acquire(context),
    ).rejects.toThrow('stderr limit')
  })

  it('classifies empty output and non-zero exit without including process output', async () => {
    const emptyScript = script('printf "  \n"')
    await expect(
      new ExecSecretProvider({ exec: emptyScript.path }).acquire(context),
    ).rejects.toThrow('produced no output')

    const failedScript = script('printf leaked-output\nexit 7')
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
    const { path } = script('printf password')
    expect(defaultSecretProviderFactory({ exec: path }, { label: 'test' })).toBeInstanceOf(
      ExecSecretProvider,
    )
  })
})
