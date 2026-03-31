import { PrivyConfigError } from '../errors.js'

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

export class PrivyConfigResolver {
  private readonly source: PrivyConfigSource | undefined

  constructor(opts: {
    source?: PrivyConfigSource
  }) {
    this.source = opts.source
  }

  isEnabled(): boolean {
    const merged = this.merge()
    if (!merged.app_id || !merged.app_secret || !merged.wallet_id) return false
    return true
  }

  resolve(): PrivyConfig {
    const merged = this.merge()
    const missing = requiredMissing(merged)
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
    const source = normalizeSource(this.source)
    return {
      app_id: source.app_id,
      app_secret: source.app_secret,
      wallet_id: source.wallet_id,
    }
  }
}

function normalizeSource(input: PrivyConfigSource | undefined): PrivyConfigSource {
  return {
    app_id: normalizeValue(input?.app_id),
    app_secret: normalizeValue(input?.app_secret),
    wallet_id: normalizeValue(input?.wallet_id),
  }
}

function normalizeValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function requiredMissing(config: PrivyConfigSource): string[] {
  const missing: string[] = []
  if (!config.app_id) missing.push('app_id')
  if (!config.app_secret) missing.push('app_secret')
  if (!config.wallet_id) missing.push('wallet_id')
  return missing
}

// NOTE: base URL is fixed to Privy API; no validation required.
