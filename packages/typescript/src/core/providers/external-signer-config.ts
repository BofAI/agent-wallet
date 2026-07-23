/**
 * Shared config resolver base for external signing backends.
 *
 * Encapsulates the common config-only (no env) resolution pattern used by
 * Privy, wallet-cli, and future external signers: normalize (trim) values,
 * detect missing required fields, and fail-fast on incomplete configuration.
 *
 * Concrete resolvers extend this base and declare their own field set and
 * required keys (see PrivyConfigResolver, WalletCliConfigResolver).
 */

export abstract class ExternalSignerConfigResolver<TConfig, TSource> {
  protected readonly source: TSource | undefined

  constructor(opts: { source?: TSource }) {
    this.source = opts.source
  }

  abstract resolve(): TConfig

  /**
   * Normalize a string value: trim whitespace, return undefined for empty.
   */
  protected normalizeValue(value: string | undefined): string | undefined {
    const trimmed = value?.trim()
    return trimmed ? trimmed : undefined
  }

  /**
   * Detect which required fields are missing from a normalized source object.
   * Returns the list of missing field names (empty if all present).
   */
  protected requireFields(merged: Record<string, unknown>, required: string[]): string[] {
    const missing: string[] = []
    for (const field of required) {
      const value = merged[field]
      if (value === undefined || value === null || value === '') {
        missing.push(field)
      }
    }
    return missing
  }
}
