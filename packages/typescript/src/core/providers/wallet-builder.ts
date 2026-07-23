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
import type { WalletCliWalletParams } from '../config.js'
import { WalletCliConfigResolver } from './wallet-cli-config.js'
import { WalletCliClient } from '../clients/wallet-cli.js'
import { WalletCliSigner } from '../adapters/wallet-cli.js'

export function createAdapter(
  conf: WalletConfig,
  configDir: string,
  password: string | undefined,
  network: string | undefined,
  secretLoader: SecretLoaderFn | undefined,
): Wallet {
  // External signers (privy, wallet_cli, and future types) use the registry;
  // they carry their own credentials in params and don't need
  // password/configDir/secretLoader.
  const externalBuilder = externalSignerRegistry.get(conf.type)
  if (externalBuilder) {
    return externalBuilder(conf.params, { network })
  }

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
  throw new Error(`Unknown wallet config type: ${conf.type}`)
}

// ---------------------------------------------------------------------------
// External signer registry — new external signing backends self-register
// here instead of adding if-else branches to createAdapter.
// ---------------------------------------------------------------------------

export type ExternalSignerBuilder = (
  params: unknown,
  ctx: { network?: string },
) => Wallet

const externalSignerRegistry = new Map<string, ExternalSignerBuilder>()

export function registerExternalSigner(type: string, builder: ExternalSignerBuilder): void {
  externalSignerRegistry.set(type, builder)
}

export function isRegisteredExternalSigner(type: string): boolean {
  return externalSignerRegistry.has(type)
}

// ---------------------------------------------------------------------------
// External signer registrations — privy and wallet_cli both follow the same
// pattern: resolver → resolve → client → adapter. They carry their own
// credentials in params (not agent-wallet master password).
// ---------------------------------------------------------------------------

registerExternalSigner('privy', (params, _ctx) => {
  const resolver = new PrivyConfigResolver({
    source: params as PrivyWalletParams,
  })
  const resolved = resolver.resolve()
  const client = new PrivyClient({
    appId: resolved.appId,
    appSecret: resolved.appSecret,
  })
  return new PrivyAdapter(resolved, client)
})

registerExternalSigner('wallet_cli', (params, _ctx) => {
  const resolver = new WalletCliConfigResolver({
    source: params as WalletCliWalletParams,
  })
  const resolved = resolver.resolve()
  const client = new WalletCliClient()
  return new WalletCliSigner(resolved, client)
})

export type EnvWalletResolved =
  | {
      params: RawSecretPrivateKeyParams | RawSecretMnemonicParams
      network: string | undefined
    }

export function createEnvAdapter(resolved: EnvWalletResolved): Wallet {
  return new RawSecretSigner(resolved.params, resolved.network)
}
