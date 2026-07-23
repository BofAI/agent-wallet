import { PrivyConfigError } from '../errors.js'
import {
  ExternalSignerConfigResolver,
  normalizeValue,
  requireFields,
} from './external-signer-config.js'

export type PrivyConfig = {
  appId: string
  appSecret: string
  walletId: string
}

export type PrivyConfigSource = {
  app_id?: string
  app_secret?: string
  wallet_id?: string
}

const REQUIRED_KEYS = ['app_id', 'app_secret', 'wallet_id'] as const

export class PrivyConfigResolver extends ExternalSignerConfigResolver<
  PrivyConfig,
  PrivyConfigSource
> {
  isEnabled(): boolean {
    const merged = this.merge()
    return Boolean(merged.app_id && merged.app_secret && merged.wallet_id)
  }

  resolve(): PrivyConfig {
    const merged = this.merge()
    const missing = requireFields(merged as Record<string, unknown>, [...REQUIRED_KEYS])
    if (missing.length > 0) {
      throw new PrivyConfigError(`Missing required Privy config keys: ${missing.join(', ')}`)
    }

    return {
      appId: merged.app_id!,
      appSecret: merged.app_secret!,
      walletId: merged.wallet_id!,
    }
  }

  private merge(): PrivyConfigSource {
    const source = this.source
    return {
      app_id: normalizeValue(source?.app_id),
      app_secret: normalizeValue(source?.app_secret),
      wallet_id: normalizeValue(source?.wallet_id),
    }
  }
}

// NOTE: base URL is fixed to Privy API; no validation required.
