/**
 * Provider for directly supplied secret material.
 */

import type { Wallet, WalletProvider } from '../base.js'
import type { RawSecretPrivateKeyParams, RawSecretMnemonicParams } from '../config.js'
import { RawSecretSigner } from '../adapters/raw-secret.js'

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
    const resolved = resolveNetwork(network, this._network)
    const params = buildParams(this._privateKey, this._mnemonic, this._accountIndex)
    return new RawSecretSigner(params, resolved)
  }

  async getActiveWallet(network?: string): Promise<Wallet> {
    return this.getWallet(network)
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildParams(
  privateKey: string | undefined,
  mnemonic: string | undefined,
  accountIndex: number,
): RawSecretPrivateKeyParams | RawSecretMnemonicParams {
  if (privateKey) {
    return { source: 'private_key' as const, private_key: privateKey }
  }
  if (mnemonic) {
    return { source: 'mnemonic' as const, mnemonic, account_index: accountIndex }
  }
  throw new Error('resolve_wallet could not find a wallet source in config or env')
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
