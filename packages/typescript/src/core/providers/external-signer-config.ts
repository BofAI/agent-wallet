/**
 * Shared config resolver base for external signing backends.
 *
 * Encapsulates the common config-only (no env) resolution pattern used by
 * Privy, wallet-cli, and future external signers: normalize (trim) values,
 * detect missing required fields, and fail-fast on incomplete configuration.
 *
 * Concrete resolvers extend this base and declare their own field set and
 * required keys (see PrivyConfigResolver, WalletCliConfigResolver).
 *
 * resolve() is async because credential fields may reference exec scripts
 * (see secret-resolver.ts) that need to be executed.
 */

import type { SecretValue } from '../secret-resolver.js'
import { resolveSecret } from '../secret-resolver.js'

/**
 * Normalize a string value: trim whitespace, return undefined for empty.
 */
export function normalizeValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/**
 * Detect which required fields are missing from a normalized source object.
 * Returns the list of missing field names (empty if all present).
 */
export function requireFields(merged: Record<string, unknown>, required: string[]): string[] {
  const missing: string[] = []
  for (const field of required) {
    const value = merged[field]
    if (value === undefined || value === null) {
      missing.push(field)
    } else if (typeof value === 'string' && value.trim() === '') {
      missing.push(field)
    }
  }
  return missing
}

export abstract class ExternalSignerConfigResolver<TConfig, TSource> {
  protected readonly source: TSource | undefined

  constructor(opts: { source?: TSource }) {
    this.source = opts?.source
  }

  abstract resolve(): Promise<TConfig>

  protected normalizeValue = normalizeValue
  protected requireFields = requireFields

  /**
   * Resolve a credential field that may be a plaintext string or a SecretRef.
   * The label is used in error messages to identify which field failed.
   */
  protected async resolveCredential(
    value: SecretValue | undefined,
    label: string,
  ): Promise<string | undefined> {
    if (value === undefined) return undefined
    return resolveSecret(value, label)
  }
}
