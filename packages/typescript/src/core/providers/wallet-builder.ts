/**
 * Shared wallet construction helpers for providers.
 */

import { type Wallet } from '../base.js'
import type { WalletConfig } from '../config.js'
import { WalletType } from '../base.js'
import { LocalSecureSigner } from '../adapters/local-secure.js'
import type { SecretLoaderFn } from '../adapters/local-secure.js'
import { RawSecretSigner } from '../adapters/raw-secret.js'
import type { RawSecretPrivateKeyParams, RawSecretMnemonicParams, PrivyWalletParams } from '../config.js'
import { PrivyAdapter } from '../adapters/privy.js'
import { PrivyClient } from '../clients/privy.js'
import { PrivyConfigResolver } from './privy-config.js'

export function createAdapter(
  conf: WalletConfig,
  configDir: string,
  password: string | undefined,
  network: string | undefined,
  secretLoader: SecretLoaderFn | undefined,
): Wallet {
  if (conf.type === WalletType.LOCAL_SECURE) {
    return new LocalSecureSigner(
      conf.params as { secret_ref: string },
      configDir,
      password,
      network,
      secretLoader,
    )
  }
  if (conf.type === WalletType.RAW_SECRET) {
    return new RawSecretSigner(
      conf.params as RawSecretPrivateKeyParams | RawSecretMnemonicParams,
      network,
    )
  }
  if (conf.type === WalletType.PRIVY) {
    const resolver = new PrivyConfigResolver({
      source: conf.params as PrivyWalletParams,
    })
    const resolved = resolver.resolve()
    const client = new PrivyClient({
      appId: resolved.appId,
      appSecret: resolved.appSecret,
    })
    return new PrivyAdapter(resolved, client)
  }
  throw new Error(`Unknown wallet config type: ${conf.type}`)
}

export type EnvWalletResolved =
  | {
      params: RawSecretPrivateKeyParams | RawSecretMnemonicParams
      network: string | undefined
    }

export function createEnvAdapter(resolved: EnvWalletResolved): Wallet {
  return new RawSecretSigner(resolved.params, resolved.network)
}
