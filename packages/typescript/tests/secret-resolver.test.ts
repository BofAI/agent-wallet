import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { resolveSecret, isSecretRef, DEFAULT_EXEC_TIMEOUT_MS } from '../src/core/secret-resolver.js'
import { ExternalSignerConfigError } from '../src/core/errors.js'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'agent-wallet-secret-test-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

const isWindows = process.platform === 'win32'

function makeExecutable(name: string, content: string): string {
  const ext = isWindows ? '.cmd' : ''
  const path = join(tempDir, name + ext)
  if (isWindows) {
    // Windows: .cmd batch wrapper
    writeFileSync(path, content, 'utf-8')
  } else {
    writeFileSync(path, content, 'utf-8')
    chmodSync(path, 0o755)
  }
  return path
}

function echoScript(value: string): string {
  if (isWindows) return `@echo off\r\necho ${value}`
  return `#!/bin/sh\necho "${value}"`
}

function failScript(stderrMsg: string): string {
  if (isWindows) return `@echo off\r\necho ${stderrMsg} 1>&2\r\nexit /b 1`
  return `#!/bin/sh\necho "${stderrMsg}" >&2\nexit 1`
}

function emptyScript(): string {
  return isWindows ? '@echo off\r\nexit /b 0' : '#!/bin/sh\nexit 0'
}

function sleepScript(seconds: number): string {
  return isWindows
    ? `@echo off\r\nping -n ${seconds + 1} 127.0.0.1 >nul`
    : `#!/bin/sh\nsleep ${seconds}\necho "done"`
}

function envCheckScript(): string {
  return isWindows
    ? '@echo off\r\necho %PATH%'
    : '#!/bin/sh\necho "$PATH" | head -c 1'
}

describe('isSecretRef', () => {
  it('returns true for { exec: string } objects', () => {
    expect(isSecretRef({ exec: '/bin/echo' })).toBe(true)
    expect(isSecretRef({ exec: '/bin/echo', timeout: 5000 })).toBe(true)
  })

  it('returns false for plain strings', () => {
    expect(isSecretRef('plaintext')).toBe(false)
  })

  it('returns false for objects without exec', () => {
    expect(isSecretRef({ foo: 'bar' })).toBe(false)
    expect(isSecretRef(null)).toBe(false)
    expect(isSecretRef(undefined)).toBe(false)
  })
})

describe('resolveSecret', () => {
  it('passes through plain strings unchanged', async () => {
    const result = await resolveSecret('my-secret-value', 'test')
    expect(result).toBe('my-secret-value')
  })

  it('executes a script and returns trimmed stdout', async () => {
    const script = makeExecutable('echo-secret', echoScript('my-secret-value'))
    const result = await resolveSecret({ exec: script }, 'test')
    expect(result).toBe('my-secret-value')
  })

  it('trims trailing whitespace from stdout', async () => {
    const script = makeExecutable('multiline', echoScript('value'))
    const result = await resolveSecret({ exec: script }, 'test')
    expect(result).toBe('value')
  })

  it('inherits process.env (e.g. PATH)', async () => {
    const script = makeExecutable('env-check', envCheckScript())
    const result = await resolveSecret({ exec: script }, 'test')
    expect(result.length).toBeGreaterThan(0)
  })

  it('throws ExternalSignerConfigError on non-zero exit', async () => {
    const script = makeExecutable('fail', failScript('error msg'))
    await expect(resolveSecret({ exec: script }, 'test-label')).rejects.toThrow(
      ExternalSignerConfigError,
    )
    await expect(resolveSecret({ exec: script }, 'test-label')).rejects.toThrow(
      /test-label.*exited with code 1.*error msg/,
    )
  })

  it('never includes stdout in a failed script error', async () => {
    const script = makeExecutable('leak.sh', '#!/bin/bash\necho "super-secret"\nexit 1')
    try {
      await resolveSecret({ exec: script }, 'test-label')
      expect.fail('should have thrown')
    } catch (error) {
      expect((error as Error).message).not.toContain('super-secret')
      expect((error as Error).message).toContain('(no stderr output)')
    }
  })

  it('throws when script produces no output', async () => {
    const script = makeExecutable('empty', emptyScript())
    await expect(resolveSecret({ exec: script }, 'test-label')).rejects.toThrow(
      /test-label.*no output/,
    )
  })

  it('throws when script does not exist', async () => {
    await expect(
      resolveSecret({ exec: '/nonexistent/path/script.sh' }, 'test-label'),
    ).rejects.toThrow(/test-label.*not found or not executable/)
  })

  it('respects custom timeout', async () => {
    const script = makeExecutable('slow', sleepScript(5))
    await expect(resolveSecret({ exec: script, timeout: 500 }, 'test-label')).rejects.toThrow(
      /test-label.*timed out after 500ms/,
    )
  })

  it('uses default timeout of 10 seconds', () => {
    expect(DEFAULT_EXEC_TIMEOUT_MS).toBe(10_000)
  })
})
