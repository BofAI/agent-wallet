import { PrivyConfigError } from '../errors.js'
import {
  ExternalSignerConfigResolver,
  normalizeValue,
  requireFields,
} from './external-signer-config.js'
import type { SecretValue } from '../secret-resolver.js'

export type PrivyConfig = {
  appId: string
  appSecret: string
  walletId: string
}

export type PrivyConfigSource = {
  app_id?: string
  app_secret?: SecretValue
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

  async resolve(): Promise<PrivyConfig> {
    const merged = this.merge()
    const missing = requireFields(merged as Record<string, unknown>, [...REQUIRED_KEYS])
    if (missing.length > 0) {
      throw new PrivyConfigError(`Missing required Privy config keys: ${missing.join(', ')}`)
    }

    const appSecret = await this.resolveCredential(merged.app_secret, 'privy app_secret')

    return {
      appId: merged.app_id!,
      appSecret: appSecret!,
      walletId: merged.wallet_id!,
    }
  }

  private merge(): PrivyConfigSource {
    const source = this.source
    return {
      app_id: normalizeValue(source?.app_id),
      app_secret: source?.app_secret,
      wallet_id: normalizeValue(source?.wallet_id),
    }
  }
}
