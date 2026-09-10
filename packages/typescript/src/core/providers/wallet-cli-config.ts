/**
 * Config resolver for the wallet-cli signing backend.
 *
 * Mirrors PrivyConfigResolver: config-only (no env), normalizes (trim),
 * validates required fields, and fails fast on missing configuration.
 * The wallet-cli keystore password is a config-stored credential
 * (like Privy's app_secret) that may be plaintext or an exec script ref.
 */

import { WalletCliConfigError } from '../errors.js'
import {
  ExternalSignerConfigResolver,
  normalizeValue,
  requireFields,
} from './external-signer-config.js'
import type { SecretValue } from '../secret-resolver.js'

export type WalletCliConfig = {
  account?: string
  password: SecretValue
}

export type WalletCliConfigSource = {
  account?: string
  password?: SecretValue
}

export class WalletCliConfigResolver extends ExternalSignerConfigResolver<
  WalletCliConfig,
  WalletCliConfigSource
> {
  async resolve(): Promise<WalletCliConfig> {
    const merged = this.merge()
    const missing = requireFields(merged as Record<string, unknown>, ['password'])
    if (missing.length > 0) {
      throw new WalletCliConfigError(
        `Missing required wallet-cli config keys: ${missing.join(', ')}`,
      )
    }

    return {
      account: merged.account,
      password: normalizePassword(merged.password),
    }
  }

  private merge(): WalletCliConfigSource {
    const source = this.source
    return {
      account: normalizeValue(source?.account),
      password: source?.password,
    }
  }
}

function normalizePassword(value: SecretValue | undefined): SecretValue {
  if (typeof value === 'string') {
    const normalized = normalizeValue(value)
    if (!normalized) throw new WalletCliConfigError('wallet-cli password must not be empty')
    return normalized
  }
  if (!value || !value.exec.trim()) {
    throw new WalletCliConfigError('wallet-cli password exec path must not be empty')
  }
  return {
    exec: value.exec.trim(),
    ...(value.timeout === undefined ? {} : { timeout: value.timeout }),
  }
}
