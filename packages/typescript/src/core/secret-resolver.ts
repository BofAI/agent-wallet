/**
 * Secret resolution for external signer credentials.
 *
 * Config params can reference a secret via an exec script instead of storing
 * the plaintext value directly:
 *
 *   "password": "/path/to/fetch-password.sh"          // plaintext string
 *   "password": { "exec": "/path/to/fetch.sh" }       // script reference
 *
 * Exec scripts must be file paths (not inline commands) and are executed via
 * the system shell. stdout (trimmed) is used as the secret value. The script
 * inherits process.env so tools like 1Password CLI (OP_SESSION_*) work
 * automatically. Non-zero exit codes throw with stderr as the message.
 */

import { spawn } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { ExternalSignerConfigError } from './errors.js'

export const DEFAULT_EXEC_TIMEOUT_MS = 10_000

export type SecretRef = {
  exec: string
  timeout?: number
}

export type SecretValue = string | SecretRef

export function isSecretRef(value: unknown): value is SecretRef {
  return (
    typeof value === 'object' && value !== null && typeof (value as SecretRef).exec === 'string'
  )
}

/**
 * Resolve a SecretValue to a plaintext string.
 * - Plain strings pass through unchanged.
 * - SecretRef objects are resolved by executing the referenced script.
 */
export async function resolveSecret(value: SecretValue, label: string): Promise<string> {
  if (typeof value === 'string') return value.trim()
  return execSecret(value, label)
}

async function execSecret(ref: SecretRef, label: string): Promise<string> {
  const scriptPath = ref.exec

  // Validate the path exists — fail fast with a clear error rather than
  // letting spawn fail with a cryptic ENOENT. On Windows there is no
  // executable bit, so only check existence (F_OK); on POSIX also require
  // execute permission (X_OK).
  try {
    accessSync(scriptPath, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
  } catch {
    throw new ExternalSignerConfigError(
      `${label}: exec script not found or not executable: ${scriptPath}`,
    )
  }

  const timeoutMs = ref.timeout ?? DEFAULT_EXEC_TIMEOUT_MS

  return new Promise<string>((resolve, reject) => {
    const child = spawn(scriptPath, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
      shell: process.platform === 'win32',
    })

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 3_000)
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

    child.on('error', (err) => {
      clearTimeout(timer)
      reject(
        new ExternalSignerConfigError(
          `${label}: failed to execute script ${scriptPath}: ${err.message}`,
        ),
      )
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8').trim()
      const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim()

      if (timedOut) {
        reject(
          new ExternalSignerConfigError(
            `${label}: exec script timed out after ${timeoutMs}ms: ${scriptPath}`,
          ),
        )
        return
      }

      if (code !== 0) {
        reject(
          new ExternalSignerConfigError(
            `${label}: exec script exited with code ${code}: ${stderr || stdout || '(no output)'}`,
          ),
        )
        return
      }

      if (!stdout) {
        reject(
          new ExternalSignerConfigError(`${label}: exec script produced no output: ${scriptPath}`),
        )
        return
      }

      resolve(stdout)
    })
  })
}
