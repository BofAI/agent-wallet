/**
 * Shared wallet construction helpers for providers.
 */

import { mnemonicToAccount } from 'viem/accounts'
import { Network, type Wallet } from '../base.js'
import { EvmAdapter } from '../adapters/evm.js'
import { TronAdapter } from '../adapters/tron.js'

export function parseNetworkFamily(network: string | undefined): Network {
  const normalized = network?.trim().toLowerCase()
  if (!normalized) throw new Error('network is required')
  if (normalized === 'tron' || normalized.startsWith('tron:')) return Network.TRON
  if (normalized === 'eip155' || normalized.startsWith('eip155:')) return Network.EVM
  throw new Error("network must start with 'tron' or 'eip155'")
}

export function createAdapter(network: string, privateKey: Uint8Array): Wallet {
  const family = parseNetworkFamily(network)
  if (family === Network.EVM) return new EvmAdapter(privateKey, network)
  if (family === Network.TRON) return new TronAdapter(privateKey, network)
  throw new Error(`Unknown network: ${network}`)
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
