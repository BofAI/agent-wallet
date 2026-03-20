/**
 * Shared wallet construction helpers for providers.
 */

import { mnemonicToAccount } from 'viem/accounts'
import { Network, type Wallet } from '../base.js'
import type { WalletConfig } from '../config.js'
import { WalletType } from '../base.js'
import { LocalSecureSigner } from '../adapters/local-secure.js'
import type { SecretLoaderFn } from '../adapters/local-secure.js'
import { RawSecretSigner } from '../adapters/raw-secret.js'
import type { RawSecretPrivateKeyParams, RawSecretMnemonicParams } from '../config.js'

export function parseNetworkFamily(network: string | undefined): Network {
  const normalized = network?.trim().toLowerCase()
  if (!normalized) throw new Error('network is required')
  if (normalized === 'tron' || normalized.startsWith('tron:')) return Network.TRON
  if (normalized === 'eip155' || normalized.startsWith('eip155:')) return Network.EVM
  throw new Error("network must start with 'tron' or 'eip155'")
}

export function createAdapter(
  conf: WalletConfig,
  configDir: string,
  password: string | undefined,
  network: string,
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
  throw new Error(`Unknown wallet config type: ${conf.type}`)
}

export function decodePrivateKey(privateKey: string): Uint8Array {
  const normalized = privateKey.trim().replace(/^0x/, '')
  if (normalized.length !== 64) {
    throw new Error('Private key must be 32 bytes (64 hex characters)')
  }
  if (!/^[0-9a-fA-F]+$/.test(normalized)) {
    throw new Error('Private key must be a valid hex string')
  }
  return Uint8Array.from(Buffer.from(normalized, 'hex'))
}

export function deriveKeyFromMnemonic(
  network: Network,
  mnemonic: string,
  accountIndex: number,
): Uint8Array {
  const path =
    network === Network.TRON
      ? (`m/44'/195'/0'/0/${accountIndex}` as `m/44'/60'/${string}`)
      : undefined // viem defaults to m/44'/60'/0'/0/{addressIndex}

  const account = path
    ? mnemonicToAccount(mnemonic, { path })
    : mnemonicToAccount(mnemonic, { addressIndex: accountIndex })

  const privateKey = account.getHdKey().privateKey
  if (!privateKey) {
    throw new Error(`Failed to derive private key from mnemonic for ${network}`)
  }
  return privateKey
}
