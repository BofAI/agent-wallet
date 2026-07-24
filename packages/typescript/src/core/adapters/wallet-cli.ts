/**
 * WalletCliAdapter — signing adapter backed by the wallet-cli CLI.
 *
 * Currently TRON-only. BSC (EVM) support is planned for when wallet-cli
 * adds EVM account addresses and signing commands; the network-family
 * dispatch in getAddress() is pre-wired so the addition is a branch fill-in,
 * not a plumbing refactor.
 *
 * Implements the Wallet + Eip712Capable interfaces by delegating signing
 * operations to wallet-cli subprocess commands (tx sign, typed-data sign).
 * The keystore password is a config-stored credential (like Privy's
 * app_secret), passed to wallet-cli via --password-stdin.
 *
 * This adapter mirrors PrivyAdapter as the "external signing source adapter"
 * precedent. It signs only — no broadcasting (that's in integrations/).
 */

import type { Eip712Capable, SignOptions, Wallet } from '../base.js'
import { SigningError, WalletError } from '../errors.js'
import type { WalletCliClient } from '../clients/wallet-cli.js'
import type { WalletCliConfig } from '../providers/wallet-cli-config.js'
import { parseNetworkFamily } from '../utils/network.js'

export class WalletCliAdapter implements Wallet, Eip712Capable {
  private readonly config: WalletCliConfig
  private readonly client: WalletCliClient
  private readonly network: string | undefined
  private cachedAddress: string | null = null

  constructor(config: WalletCliConfig, client: WalletCliClient, network?: string) {
    this.config = config
    this.client = client
    this.network = network
  }

  async getAddress(): Promise<string> {
    if (this.cachedAddress) return this.cachedAddress
    const result = await this.client.currentAccount(this.config.account)
    const family = this.network ? parseNetworkFamily(this.network) : 'tron'
    const address = selectAddress(result.data?.addresses, family)
    if (!address) {
      throw new WalletError(`wallet-cli current did not return a ${family.toUpperCase()} address`)
    }
    this.cachedAddress = address
    return this.cachedAddress
  }

  async signTransaction(payload: Record<string, unknown>, _options?: SignOptions): Promise<string> {
    const result = await this.client.signTransaction(
      JSON.stringify(payload),
      this.config.password,
      this.config.account,
    )
    if (!result.data?.signed) {
      throw new SigningError('wallet-cli tx sign did not return a signed transaction')
    }
    return JSON.stringify(result.data.signed)
  }

  async signTypedData(data: Record<string, unknown>, _options?: SignOptions): Promise<string> {
    const result = await this.client.signTypedData(
      JSON.stringify(data),
      this.config.password,
      this.config.account,
    )
    if (!result.data?.signature) {
      throw new SigningError('wallet-cli typed-data sign did not return a signature')
    }
    return strip0x(result.data.signature)
  }
}

/**
 * Select the address for a network family from wallet-cli `current` output.
 * TRON is supported today; EVM (BSC) is reserved for when wallet-cli ships it.
 */
function selectAddress(
  addresses: { tron: string; evm?: string } | undefined,
  family: string,
): string | undefined {
  if (family === 'tron') return addresses?.tron
  if (family === 'evm') return addresses?.evm
  return undefined
}

function strip0x(hex: string): string {
  return hex.startsWith('0x') ? hex.slice(2) : hex
}
