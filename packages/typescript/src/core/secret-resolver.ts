/**
 * Secret resolution for external signer credentials.
 *
 * Config params can reference a secret via an exec script instead of storing
 * the plaintext value directly:
 *
 *   "password": "/path/to/fetch-password.sh"          // plaintext string
 *   "password": { "exec": "/path/to/fetch.sh" }       // script reference
 *
 * Exec scripts must be file paths (not inline commands). stdout (trimmed) is
 * used as the secret value. The script
 * inherits process.env so tools like 1Password CLI (OP_SESSION_*) work
 * automatically. Non-zero exit codes throw with stderr as the message.
 */

import { executeSecretSource } from './secret-exec.js'

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
  const secret = await executeSecretSource(value, label, {
    defaultTimeoutMs: DEFAULT_EXEC_TIMEOUT_MS,
  })
  try {
    return secret.toString('utf8')
  } finally {
    secret.fill(0)
  }
}
