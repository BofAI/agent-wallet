/**
 * Config-driven wallet provider — handles all wallet types from wallets_config.json.
 */

import { existsSync, mkdirSync, chmodSync } from 'node:fs'
import { join } from 'node:path'

import type { Wallet, WalletProvider } from '../base.js'
import { WalletType } from '../base.js'
import { WalletNotFoundError } from '../errors.js'
import {
  ConfigNotFoundError,
  type WalletConfig,
  type WalletsTopology,
  loadConfig,
  saveConfig,
} from '../config.js'
import { WALLETS_CONFIG_FILENAME } from '../constants.js'
import { createAdapter } from './wallet-builder.js'
import { resolveNetwork } from '../utils/network.js'
import type { WalletDependencies } from './wallet-builder.js'

export class ConfigWalletProvider implements WalletProvider {
  private readonly configDir: string
  private readonly network: string | undefined
  private readonly dependencies: WalletDependencies | undefined
  private readonly configPath: string
  private config: WalletsTopology
  private readonly wallets = new Map<string, Map<WalletType, Map<string | undefined, Wallet>>>()

  constructor(
    configDir: string,
    options?: { network?: string; dependencies?: WalletDependencies },
  ) {
    this.configDir = configDir
    this.network = options?.network
    const walletCli = options?.dependencies?.walletCli
    this.dependencies = walletCli
      ? {
          walletCli: {
            clientFactory: walletCli.clientFactory,
            secretProviderFactory: walletCli.secretProviderFactory,
          },
        }
      : undefined
    this.configPath = join(configDir, WALLETS_CONFIG_FILENAME)

    try {
      this.config = loadConfig(configDir)
    } catch (error) {
      if (!(error instanceof ConfigNotFoundError)) {
        throw error
      }
      this.config = { active_wallet: null, wallets: {} }
    }
  }

  isInitialized(): boolean {
    return existsSync(this.configPath)
  }

  ensureStorage(): void {
    this.ensureDir()
    if (!existsSync(this.configPath)) {
      this.persist()
    }
  }

  listWallets(): Array<[string, WalletConfig, boolean]> {
    return Object.entries(this.config.wallets).map(([walletId, conf]) => [
      walletId,
      conf,
      walletId === this.config.active_wallet,
    ])
  }

  getWalletConfig(walletId: string): WalletConfig {
    const conf = this.config.wallets[walletId]
    if (!conf) throw new WalletNotFoundError(`Wallet '${walletId}' not found`)
    return conf
  }

  getActiveId(): string | null {
    return this.config.active_wallet ?? null
  }

  addWallet(walletId: string, config: WalletConfig, opts?: { setActiveIfMissing?: boolean }): void {
    if (this.config.wallets[walletId]) {
      throw new Error(`Wallet '${walletId}' already exists`)
    }
    this.config.wallets[walletId] = config
    const setActive = opts?.setActiveIfMissing ?? true
    if (setActive && !this.config.active_wallet) {
      this.config.active_wallet = walletId
    }
    this.persist()
  }

  setActive(walletId: string): WalletConfig {
    const conf = this.getWalletConfig(walletId)
    this.config.active_wallet = walletId
    this.persist()
    return conf
  }

  removeWallet(walletId: string): WalletConfig {
    const conf = this.getWalletConfig(walletId)
    delete this.config.wallets[walletId]
    if (this.config.active_wallet === walletId) {
      this.config.active_wallet = null
    }
    // Evict cached wallets for this id
    for (const key of this.wallets.keys()) {
      if (key.startsWith(`${walletId}:`)) this.wallets.delete(key)
    }
    this.persist()
    return conf
  }

  async getWallet(walletId: string, network?: string): Promise<Wallet> {
    const conf = this.getWalletConfig(walletId) // throws if not found
    const resolvedNetwork =
      conf.type === 'privy' ? undefined : resolveNetwork(network, this.network)
    const cached = this.getWalletCache(walletId, conf.type as WalletType, resolvedNetwork)
    if (!cached) {
      const wallet = await createAdapter(conf, this.configDir, resolvedNetwork, this.dependencies)
      this.setWalletCache(walletId, conf.type as WalletType, resolvedNetwork, wallet)
      return wallet
    }
    return cached
  }

  async getActiveWallet(network?: string): Promise<Wallet> {
    const activeId = this.config.active_wallet
    if (activeId) {
      const resolvedNetwork = resolveNetwork(network, this.network)
      return this.getWallet(activeId, resolvedNetwork)
    }

    // Fall back to first available wallet
    for (const [walletId, _conf] of Object.entries(this.config.wallets)) {
      const resolvedNetwork = resolveNetwork(network, this.network)
      return this.getWallet(walletId, resolvedNetwork)
    }
    throw new WalletNotFoundError('No active wallet set.')
  }

  private ensureDir(): void {
    mkdirSync(this.configDir, { recursive: true })
    try {
      chmodSync(this.configDir, 0o700)
    } catch {
      /* ignore on platforms without chmod support */
    }
  }

  private persist(): void {
    this.ensureDir()
    saveConfig(this.configDir, this.config)
  }

  private getWalletCache(
    walletId: string,
    type: WalletType,
    network: string | undefined,
  ): Wallet | undefined {
    return this.wallets.get(walletId)?.get(type)?.get(network)
  }

  private setWalletCache(
    walletId: string,
    type: WalletType,
    network: string | undefined,
    wallet: Wallet,
  ): void {
    let byType = this.wallets.get(walletId)
    if (!byType) {
      byType = new Map<WalletType, Map<string | undefined, Wallet>>()
      this.wallets.set(walletId, byType)
    }
    let byNetwork = byType.get(type)
    if (!byNetwork) {
      byNetwork = new Map<string | undefined, Wallet>()
      byType.set(type, byNetwork)
    }
    byNetwork.set(network, wallet)
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
