/**
 * WalletCliSigner — TRON signing adapter backed by the wallet-cli CLI.
 *
 * Implements the Wallet + Eip712Capable interfaces by delegating signing
 * operations to wallet-cli subprocess commands (tx sign, message sign,
 * typed-data sign). The keystore password is a config-stored credential
 * (like Privy's app_secret), passed to wallet-cli via --password-stdin.
 *
 * This adapter mirrors PrivyAdapter as the "external signing source adapter"
 * precedent. It signs only — no broadcasting (that's in integrations/).
 *
 * Note on signMessage semantics: wallet-cli's `message sign` signs UTF-8 text
 * (EIP-191 personal_sign), not arbitrary bytes. This differs from TronSigner
 * which signs keccak256(bytes) directly. Pure ASCII messages produce identical
 * signatures; non-UTF-8 bytes may differ. For arbitrary byte signing, use
 * signTransaction or wait for wallet-cli hex input support.
 */

import type { Eip712Capable, SignOptions, Wallet } from '../base.js'
import { UnsupportedOperationError } from '../errors.js'
import type { WalletCliClient } from '../clients/wallet-cli.js'
import type { WalletCliConfig } from '../providers/wallet-cli-config.js'

export class WalletCliSigner implements Wallet, Eip712Capable {
  private readonly config: WalletCliConfig
  private readonly client: WalletCliClient
  private cachedAddress: string | null = null

  constructor(config: WalletCliConfig, client: WalletCliClient) {
    this.config = config
    this.client = client
  }

  async getAddress(): Promise<string> {
    if (this.cachedAddress) return this.cachedAddress
    const result = await this.client.currentAccount(this.config.account)
    const address = result.data?.addresses?.tron
    if (!address) {
      throw new Error('wallet-cli current did not return a TRON address')
    }
    this.cachedAddress = address
    return address
  }

  async signTransaction(
    payload: Record<string, unknown>,
    _options?: SignOptions,
  ): Promise<string> {
    const result = await this.client.signTransaction(
      JSON.stringify(payload),
      this.config.password,
      this.config.account,
    )
    if (!result.data?.signed) {
      throw new Error('wallet-cli tx sign did not return a signed transaction')
    }
    return JSON.stringify(result.data.signed)
  }

  async signMessage(msg: Uint8Array, _options?: SignOptions): Promise<string> {
    const text = Buffer.from(msg).toString('utf-8')
    const result = await this.client.signMessage(text, this.config.password, this.config.account)
    if (!result.data?.signature) {
      throw new Error('wallet-cli message sign did not return a signature')
    }
    return strip0x(result.data.signature)
  }

  async signTypedData(data: Record<string, unknown>, _options?: SignOptions): Promise<string> {
    const result = await this.client.signTypedData(
      JSON.stringify(data),
      this.config.password,
      this.config.account,
    )
    if (!result.data?.signature) {
      throw new Error('wallet-cli typed-data sign did not return a signature')
    }
    return strip0x(result.data.signature)
  }

  async signRaw(_rawTx: Uint8Array, _options?: SignOptions): Promise<string> {
    throw new UnsupportedOperationError(
      'wallet-cli adapter does not support raw-digest signing; use signTransaction with an unsigned tx object',
    )
  }
}

function strip0x(hex: string): string {
  return hex.startsWith('0x') ? hex.slice(2) : hex
}
