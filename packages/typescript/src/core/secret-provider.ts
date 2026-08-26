import { spawn } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { extname } from 'node:path'
import type { Writable } from 'node:stream'

import { ExternalSignerConfigError } from './errors.js'
import {
  DEFAULT_EXEC_TIMEOUT_MS,
  isSecretRef,
  type SecretRef,
  type SecretValue,
} from './secret-resolver.js'

export const DEFAULT_SECRET_STDOUT_LIMIT = 64 * 1024
export const DEFAULT_SECRET_STDERR_LIMIT = 16 * 1024

export interface SecretContext {
  label: string
  accountId: string
  network: string
}

export interface SecretLease {
  writeTo(destination: NodeJS.WritableStream): Promise<void>
  dispose(): Promise<void>
}

export interface SecretProvider {
  acquire(context: SecretContext): Promise<SecretLease>
}

export type SecretProviderFactory = (
  value: SecretValue,
  context: { label: string },
) => SecretProvider

export interface ExecSecretProviderOptions {
  env?: NodeJS.ProcessEnv
  maxStdoutBytes?: number
  maxStderrBytes?: number
  platform?: NodeJS.Platform
  comspec?: string
}

export interface SecretLaunchTarget {
  command: string
  args: string[]
}

class BufferSecretLease implements SecretLease {
  private consumed = false
  private disposed = false

  constructor(private readonly secret: Buffer) {}

  async writeTo(destination: NodeJS.WritableStream): Promise<void> {
    if (this.disposed) throw new ExternalSignerConfigError('secret lease has been disposed')
    if (this.consumed) throw new ExternalSignerConfigError('secret lease may only be consumed once')
    this.consumed = true

    const writable = destination as Writable
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: Error | null) => {
        if (settled) return
        settled = true
        writable.off('error', onError)
        writable.off('finish', onFinish)
        writable.off('close', onClose)
        if (error) {
          const code = (error as NodeJS.ErrnoException).code ?? 'stream_error'
          reject(new ExternalSignerConfigError(`failed to write secret to stdin (${code})`))
        } else resolve()
      }
      const onError = (error: Error) => finish(error)
      const onFinish = () => finish()
      const onClose = () => finish(Object.assign(new Error('stream closed'), { code: 'EPIPE' }))
      writable.once('error', onError)
      writable.once('finish', onFinish)
      writable.once('close', onClose)
      try {
        writable.end(this.secret)
      } catch (error) {
        finish(error as Error)
      }
    })
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.secret.fill(0)
  }
}

export class StaticSecretProvider implements SecretProvider {
  private readonly value: string

  constructor(value: string, label = 'secret') {
    this.value = value.trim()
    if (!this.value) throw new ExternalSignerConfigError(`${label}: secret is empty`)
  }

  async acquire(_context: SecretContext): Promise<SecretLease> {
    return new BufferSecretLease(Buffer.from(this.value, 'utf8'))
  }
}

export class ExecSecretProvider implements SecretProvider {
  private readonly ref: SecretRef
  private readonly label: string
  private readonly options: ExecSecretProviderOptions

  constructor(ref: SecretRef, label = 'secret', options: ExecSecretProviderOptions = {}) {
    if (!ref.exec.trim()) throw new ExternalSignerConfigError(`${label}: exec path is empty`)
    this.ref = { ...ref, exec: ref.exec.trim() }
    this.label = label
    this.options = options
  }

  async acquire(_context: SecretContext): Promise<SecretLease> {
    const secret = await executeSecret(this.ref, this.label, this.options)
    return new BufferSecretLease(secret)
  }
}

export const defaultSecretProviderFactory: SecretProviderFactory = (value, context) => {
  if (typeof value === 'string') return new StaticSecretProvider(value, context.label)
  if (isSecretRef(value)) return new ExecSecretProvider(value, context.label)
  throw new ExternalSignerConfigError(`${context.label}: invalid secret source`)
}

function executeSecret(
  ref: SecretRef,
  label: string,
  options: ExecSecretProviderOptions,
): Promise<Buffer> {
  const platform = options.platform ?? process.platform
  try {
    accessSync(ref.exec, platform === 'win32' ? constants.F_OK : constants.X_OK)
  } catch {
    throw new ExternalSignerConfigError(
      `${label}: exec script not found or not executable: ${ref.exec}`,
    )
  }

  const { command, args } = resolveSecretLaunchTarget(
    ref.exec,
    platform,
    options.comspec ?? process.env.ComSpec ?? process.env.COMSPEC,
  )
  const timeoutMs = ref.timeout ?? DEFAULT_EXEC_TIMEOUT_MS
  const maxStdoutBytes = options.maxStdoutBytes ?? DEFAULT_SECRET_STDOUT_LIMIT
  const maxStderrBytes = options.maxStderrBytes ?? DEFAULT_SECRET_STDERR_LIMIT

  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env ?? process.env,
      shell: false,
    })
    const stdout: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let timedOut = false
    let exceeded: 'stdout' | 'stderr' | undefined
    let settled = false
    let terminating = false
    let killTimer: NodeJS.Timeout | undefined

    const finish = (error?: Error, value?: Buffer) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(killTimer)
      if (error) {
        for (const chunk of stdout) chunk.fill(0)
        reject(error)
      } else {
        resolve(value!)
      }
    }
    const terminate = () => {
      if (terminating) return
      terminating = true
      child.kill('SIGTERM')
      killTimer = setTimeout(() => child.kill('SIGKILL'), 3_000)
      killTimer.unref?.()
    }
    const timer = setTimeout(() => {
      if (terminating) return
      timedOut = true
      terminate()
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      if (exceeded) return
      stdoutBytes += chunk.length
      if (stdoutBytes > maxStdoutBytes) {
        exceeded = 'stdout'
        clearTimeout(timer)
        terminate()
        return
      }
      stdout.push(Buffer.from(chunk))
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (exceeded) return
      stderrBytes += chunk.length
      if (stderrBytes > maxStderrBytes) {
        exceeded = 'stderr'
        clearTimeout(timer)
        terminate()
      }
    })
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish(
        new ExternalSignerConfigError(
          `${label}: failed to execute secret source (${error.code ?? 'spawn_error'}): ${ref.exec}`,
        ),
      )
    })
    child.on('close', (code) => {
      if (exceeded) {
        finish(
          new ExternalSignerConfigError(
            `${label}: secret source exceeded ${exceeded} limit: ${ref.exec}`,
          ),
        )
        return
      }
      if (timedOut) {
        finish(
          new ExternalSignerConfigError(
            `${label}: secret source timed out after ${timeoutMs}ms: ${ref.exec}`,
          ),
        )
        return
      }
      if (code !== 0) {
        finish(
          new ExternalSignerConfigError(
            `${label}: secret source exited with code ${code}: ${ref.exec}`,
          ),
        )
        return
      }

      const joined = Buffer.concat(stdout, stdoutBytes)
      for (const chunk of stdout) chunk.fill(0)
      const trimmed = trimBuffer(joined)
      joined.fill(0)
      if (trimmed.length === 0) {
        trimmed.fill(0)
        finish(
          new ExternalSignerConfigError(`${label}: secret source produced no output: ${ref.exec}`),
        )
        return
      }
      finish(undefined, trimmed)
    })
  })
}

export function resolveSecretLaunchTarget(
  path: string,
  platform: NodeJS.Platform = process.platform,
  comspec = 'cmd.exe',
): SecretLaunchTarget {
  const extension = extname(path).toLowerCase()
  if (platform === 'win32' && (extension === '.cmd' || extension === '.bat')) {
    return { command: comspec, args: ['/d', '/s', '/c', path] }
  }
  return { command: path, args: [] }
}

function trimBuffer(input: Buffer): Buffer {
  let start = 0
  let end = input.length
  while (start < end && isAsciiWhitespace(input[start])) start += 1
  while (end > start && isAsciiWhitespace(input[end - 1])) end -= 1
  return Buffer.from(input.subarray(start, end))
}

function isAsciiWhitespace(byte: number): boolean {
  return byte === 0x20 || (byte >= 0x09 && byte <= 0x0d)
}
