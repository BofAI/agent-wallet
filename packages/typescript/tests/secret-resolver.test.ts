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

function makeExecutable(name: string, content: string): string {
  const path = join(tempDir, name)
  writeFileSync(path, content, 'utf-8')
  chmodSync(path, 0o755)
  return path
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
    const script = makeExecutable('echo-secret.sh', '#!/bin/bash\necho "my-secret-value"')
    const result = await resolveSecret({ exec: script }, 'test')
    expect(result).toBe('my-secret-value')
  })

  it('trims trailing whitespace from stdout', async () => {
    const script = makeExecutable('multiline.sh', '#!/bin/bash\nprintf "value\\n\\n"')
    const result = await resolveSecret({ exec: script }, 'test')
    expect(result).toBe('value')
  })

  it('inherits process.env (e.g. PATH)', async () => {
    const script = makeExecutable('env-check.sh', '#!/bin/bash\necho "$PATH" | head -c 1')
    const result = await resolveSecret({ exec: script }, 'test')
    expect(result.length).toBeGreaterThan(0)
  })

  it('throws ExternalSignerConfigError on non-zero exit', async () => {
    const script = makeExecutable('fail.sh', '#!/bin/bash\necho "error msg" >&2\nexit 1')
    await expect(resolveSecret({ exec: script }, 'test-label')).rejects.toThrow(
      ExternalSignerConfigError,
    )
    await expect(resolveSecret({ exec: script }, 'test-label')).rejects.toThrow(
      /test-label.*exited with code 1.*error msg/,
    )
  })

  it('throws when script produces no output', async () => {
    const script = makeExecutable('empty.sh', '#!/bin/bash\nexit 0')
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
    const script = makeExecutable('slow.sh', '#!/bin/bash\nsleep 5\necho "done"')
    await expect(resolveSecret({ exec: script, timeout: 500 }, 'test-label')).rejects.toThrow(
      /test-label.*timed out after 500ms/,
    )
  })

  it('uses default timeout of 10 seconds', () => {
    expect(DEFAULT_EXEC_TIMEOUT_MS).toBe(10_000)
  })
})
