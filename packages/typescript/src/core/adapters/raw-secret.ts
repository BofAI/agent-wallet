/**
 * Local signer backed by raw secret material stored in config.
 */

import type { RawSecretPrivateKeyParams, RawSecretMnemonicParams } from '../config.js'
import { LocalSigner } from './local.js'
import { decodePrivateKey, deriveKeyFromMnemonic, parseNetworkFamily } from '../providers/wallet-builder.js'

export class RawSecretSigner extends LocalSigner {
  constructor(
    params: RawSecretPrivateKeyParams | RawSecretMnemonicParams,
    network: string,
  ) {
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
