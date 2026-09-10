/**
 * Local signer facade — dispatches to EVM or TRON signer by network.
 */

import type {
  Eip712Capable,
  SignedTransactionArtifact,
  SignOptions,
  TransactionPayload,
  Wallet,
} from '../base.js'
import { Network } from '../base.js'
import { UnsupportedOperationError } from '../errors.js'
import { parseCanonicalNetwork } from '../utils/network.js'
import { EvmSigner } from './evm.js'
import { TronSigner } from './tron.js'

export class LocalSigner implements Wallet, Eip712Capable {
  private readonly _network: string
  private readonly _impl: Wallet

  constructor(privateKey: Uint8Array, network?: string) {
    this._network = network ?? ''
    this._impl = createSigner(privateKey, network)
  }

  async getAddress(): Promise<string> {
    return this._impl.getAddress()
  }

  async signTransaction(
    payload: TransactionPayload,
    options?: SignOptions,
  ): Promise<SignedTransactionArtifact> {
    return this._impl.signTransaction(payload, options)
  }

  async signTypedData(data: Record<string, unknown>, options?: SignOptions): Promise<string> {
    const impl = this._impl
    if (!('signTypedData' in impl)) {
      throw new UnsupportedOperationError(
        `Wallet for network '${this._network}' does not support EIP-712 signing.`,
      )
    }
    return (impl as Eip712Capable).signTypedData(data, options)
  }
}

function createSigner(privateKey: Uint8Array, network?: string): Wallet {
  const target = parseCanonicalNetwork(network)
  if (target.family === Network.EVM) return new EvmSigner(privateKey, target.id)
  if (target.family === Network.TRON) return new TronSigner(privateKey, target.id)
  throw new Error(`Unknown network: ${network}`)
}
