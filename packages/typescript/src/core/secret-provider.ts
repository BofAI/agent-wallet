import type { Writable } from 'node:stream'

import { ExternalSignerConfigError } from './errors.js'
import {
  DEFAULT_EXEC_TIMEOUT_MS,
  isSecretRef,
  type SecretRef,
  type SecretValue,
} from './secret-resolver.js'
import {
  DEFAULT_SECRET_EXEC_STDERR_LIMIT,
  DEFAULT_SECRET_EXEC_STDOUT_LIMIT,
  executeSecretSource,
} from './secret-exec.js'
export { resolveSecretLaunchTarget } from './secret-exec.js'
export type { SecretLaunchTarget } from './secret-exec.js'

export const DEFAULT_SECRET_STDOUT_LIMIT = DEFAULT_SECRET_EXEC_STDOUT_LIMIT
export const DEFAULT_SECRET_STDERR_LIMIT = DEFAULT_SECRET_EXEC_STDERR_LIMIT

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
  killGraceMs?: number
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
    const secret = await executeSecretSource(this.ref, this.label, {
      ...this.options,
      defaultTimeoutMs: DEFAULT_EXEC_TIMEOUT_MS,
    })
    return new BufferSecretLease(secret)
  }
}

export const defaultSecretProviderFactory: SecretProviderFactory = (value, context) => {
  if (typeof value === 'string') return new StaticSecretProvider(value, context.label)
  if (isSecretRef(value)) return new ExecSecretProvider(value, context.label)
  throw new ExternalSignerConfigError(`${context.label}: invalid secret source`)
}
