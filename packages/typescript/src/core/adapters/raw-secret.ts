/**
 * Local signer backed by raw secret material stored in config.
 */

import { mnemonicToAccount } from 'viem/accounts'

import { Network } from '../base.js'
import type { RawSecretPrivateKeyParams, RawSecretMnemonicParams } from '../config.js'
import { LocalSigner, parseNetworkFamily } from './local.js'

export class RawSecretSigner extends LocalSigner {
  constructor(params: RawSecretPrivateKeyParams | RawSecretMnemonicParams, network: string) {
    const family = parseNetworkFamily(network)
    let privateKey: Uint8Array
    if (params.source === 'private_key') {
      privateKey = decodePrivateKey(params.private_key)
    } else if (params.source === 'mnemonic') {
      privateKey = deriveKeyFromMnemonic(family, params.mnemonic, params.account_index)
    } else {
      throw new Error('raw_secret wallets require valid raw secret params')
    }
    super(privateKey, network)
  }
}

function decodePrivateKey(privateKey: string): Uint8Array {
  const normalized = privateKey.trim().replace(/^0x/, '')
  if (normalized.length !== 64) {
    throw new Error('Private key must be 32 bytes (64 hex characters)')
  }
  if (!/^[0-9a-fA-F]+$/.test(normalized)) {
    throw new Error('Private key must be a valid hex string')
  }
  return Uint8Array.from(Buffer.from(normalized, 'hex'))
}

function deriveKeyFromMnemonic(
  network: Network,
  mnemonic: string,
  accountIndex: number,
): Uint8Array {
  const path =
    network === Network.TRON
      ? (`m/44'/195'/0'/0/${accountIndex}` as `m/44'/60'/${string}`)
      : undefined

  const account = path
    ? mnemonicToAccount(mnemonic, { path })
    : mnemonicToAccount(mnemonic, { addressIndex: accountIndex })

  const privateKey = account.getHdKey().privateKey
  if (!privateKey) {
    throw new Error(`Failed to derive private key from mnemonic for ${network}`)
  }
  return privateKey
}
