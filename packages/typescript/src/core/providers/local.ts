import type { BaseWallet } from '../base.js'
import { EvmWallet } from '../adapters/evm.js'
import { TronWallet } from '../adapters/tron.js'
import { WalletNotFoundError } from '../errors.js'
import { loadConfig, saveConfig, type WalletConfig, type WalletInfo, type WalletsTopology } from '../../local/config.js'
import { SecureKVStore } from '../../local/kv-store.js'
import { WalletProvider } from './base.js'

export class LocalWalletProvider extends WalletProvider {
  private readonly config: WalletsTopology
  private readonly wallets: Map<string, BaseWallet> = new Map()

  constructor(
    private readonly secretsDir: string,
    password: string,
  ) {
    super()
    const kvStore = new SecureKVStore(secretsDir, password)
    kvStore.verifyPassword()
    this.config = loadConfig(secretsDir)
    for (const [wid, conf] of Object.entries(this.config.wallets)) {
      this.wallets.set(wid, createWallet(conf, kvStore))
    }
  }

  async listWallets(): Promise<WalletInfo[]> {
    return Object.entries(this.config.wallets).map(([wid, conf]) => ({
      id: wid,
      type: conf.type,
    }))
  }

  async getWallet(walletId: string): Promise<BaseWallet> {
    const wallet = this.wallets.get(walletId)
    if (!wallet) {
      throw new WalletNotFoundError(`Wallet '${walletId}' not found`)
    }
    return wallet
  }

  getActiveId(): string | null {
    return this.config.active_wallet ?? null
  }

  async getActiveWallet(): Promise<BaseWallet> {
    const activeId = this.getActiveId()
    if (!activeId) {
      throw new WalletNotFoundError("No active wallet set. Use 'agent-wallet use <id>' to set one.")
    }
    return this.getWallet(activeId)
  }

  async getActive(): Promise<BaseWallet> {
    return this.getActiveWallet()
  }

  setActive(walletId: string): void {
    if (!this.wallets.has(walletId)) {
      throw new WalletNotFoundError(`Wallet '${walletId}' not found`)
    }
    this.config.active_wallet = walletId
    saveConfig(this.secretsDir, this.config)
  }
}

function createWallet(conf: WalletConfig, kvStore: SecureKVStore): BaseWallet {
  switch (conf.type) {
    case 'evm_local': {
      const privateKey = kvStore.loadPrivateKey(conf.identity_file!)
      return new EvmWallet(privateKey)
    }
    case 'tron_local': {
      const privateKey = kvStore.loadPrivateKey(conf.identity_file!)
      return new TronWallet(privateKey)
    }
    default:
      throw new Error(`Unknown wallet type: ${conf.type}`)
  }
}
