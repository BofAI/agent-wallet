/**
 * Local signer facade — dispatches to EVM or TRON signer by network.
 */

import type { Wallet, Eip712Capable } from '../base.js'
import { Network } from '../base.js'
import { UnsupportedOperationError } from '../errors.js'
import { EvmSigner } from './evm.js'
import { TronSigner } from './tron.js'

export class LocalSigner implements Wallet, Eip712Capable {
  private readonly _network: string
  private readonly _impl: Wallet

  constructor(privateKey: Uint8Array, network: string) {
    this._network = network
    this._impl = createSigner(privateKey, network)
  }

  async getAddress(): Promise<string> {
    return this._impl.getAddress()
  }

  async signRaw(rawTx: Uint8Array): Promise<string> {
    return this._impl.signRaw(rawTx)
  }

  async signTransaction(payload: Record<string, unknown>): Promise<string> {
    return this._impl.signTransaction(payload)
  }

  async signMessage(msg: Uint8Array): Promise<string> {
    return this._impl.signMessage(msg)
  }

  async signTypedData(data: Record<string, unknown>): Promise<string> {
    const impl = this._impl
    if (!('signTypedData' in impl)) {
      throw new UnsupportedOperationError(
        `Wallet for network '${this._network}' does not support EIP-712 signing.`,
      )
    }
    return (impl as Eip712Capable).signTypedData(data)
  }
}

function createSigner(privateKey: Uint8Array, network: string): Wallet {
  const family = parseNetworkFamily(network)
  if (family === Network.EVM) return new EvmSigner(privateKey, network)
  if (family === Network.TRON) return new TronSigner(privateKey, network)
  throw new Error(`Unknown network: ${network}`)
}

export function parseNetworkFamily(network: string | undefined): Network {
  const normalized = network?.trim().toLowerCase()
  if (!normalized) throw new Error('network is required')
  if (normalized === 'tron' || normalized.startsWith('tron:')) return Network.TRON
  if (normalized === 'eip155' || normalized.startsWith('eip155:')) return Network.EVM
  throw new Error("network must start with 'tron' or 'eip155'")
}
