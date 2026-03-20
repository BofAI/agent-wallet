/**
 * Provider for directly supplied secret material.
 */

import type { Wallet, WalletProvider } from '../base.js'
import {
  createAdapter,
  decodePrivateKey,
  deriveKeyFromMnemonic,
  parseNetworkFamily,
} from './wallet-builder.js'

export class EnvWalletProvider implements WalletProvider {
  private readonly _network: string | undefined
  private readonly _privateKey: string | undefined
  private readonly _mnemonic: string | undefined
  private readonly _accountIndex: number

  constructor(options: {
    network?: string
    privateKey?: string
    mnemonic?: string
    accountIndex?: number
  }) {
    assertSingleWalletSource(options.privateKey, options.mnemonic)
    this._network = options.network
    this._privateKey = options.privateKey
    this._mnemonic = options.mnemonic
    this._accountIndex = options.accountIndex ?? 0
  }

  async getWallet(network?: string): Promise<Wallet> {
    return createWallet(
      resolveNetwork(network, this._network),
      this._privateKey,
      this._mnemonic,
      this._accountIndex,
    )
  }

  async getActiveWallet(network?: string): Promise<Wallet> {
    return this.getWallet(network)
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function createWallet(
  network: string,
  privateKey: string | undefined,
  mnemonic: string | undefined,
  accountIndex: number,
): Wallet {
  if (!privateKey && !mnemonic) {
    throw new Error('resolve_wallet could not find a wallet source in config or env')
  }

  const family = parseNetworkFamily(network)

  if (privateKey) {
    return createAdapter(network, decodePrivateKey(privateKey))
  }

  return createAdapter(network, deriveKeyFromMnemonic(family, mnemonic!, accountIndex))
}

function assertSingleWalletSource(
  privateKey: string | undefined,
  mnemonic: string | undefined,
): void {
  if (privateKey && mnemonic) {
    throw new Error('Provide only one of AGENT_WALLET_PRIVATE_KEY or AGENT_WALLET_MNEMONIC')
  }
}

function resolveNetwork(explicit: string | undefined, providerDefault: string | undefined): string {
  if (explicit) return explicit
  if (providerDefault) return providerDefault
  throw new Error('network is required')
}
