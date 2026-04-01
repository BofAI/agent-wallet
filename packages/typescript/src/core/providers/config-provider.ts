/**
 * Config-driven wallet provider — handles all wallet types from wallets_config.json.
 */

import { existsSync, mkdirSync, chmodSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Wallet, WalletProvider } from '../base.js'
import { WalletType } from '../base.js'
import { WalletNotFoundError } from '../errors.js'
import {
  ConfigNotFoundError,
  type WalletConfig,
  type WalletsTopology,
  loadConfig,
  loadRuntimeSecretsPassword,
  saveConfig,
} from '../config.js'
import { RUNTIME_SECRETS_FILENAME, WALLETS_CONFIG_FILENAME } from '../constants.js'
import { createAdapter } from './wallet-builder.js'
import { resolveNetwork } from '../utils/network.js'

export type SecretLoaderFn = (configDir: string, password: string, secretRef: string) => Uint8Array

export class ConfigWalletProvider implements WalletProvider {
  private readonly configDir: string
  private readonly password: string | undefined
  private readonly network: string | undefined
  private readonly secretLoader: SecretLoaderFn | undefined
  private readonly configPath: string
  private config: WalletsTopology
  private readonly wallets = new Map<string, Map<WalletType, Map<string | undefined, Wallet>>>()

  constructor(
    configDir: string,
    password?: string,
    options?: { network?: string; secretLoader?: SecretLoaderFn },
  ) {
    this.configDir = configDir
    this.password = password ?? undefined
    this.network = options?.network
    this.secretLoader = options?.secretLoader
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
    if (conf.type === 'local_secure') {
      const secretPath = this.secretPath((conf.params as { secret_ref: string }).secret_ref)
      if (existsSync(secretPath)) unlinkSync(secretPath)
    }
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

  hasSecretFile(walletId: string): boolean {
    const conf = this.getWalletConfig(walletId)
    if (conf.type !== 'local_secure') return false
    return existsSync(this.secretPath((conf.params as { secret_ref: string }).secret_ref))
  }

  hasRuntimeSecrets(): boolean {
    return existsSync(this.runtimeSecretsPath())
  }

  loadRuntimeSecretsPassword(): string | null {
    return loadRuntimeSecretsPassword(this.configDir)
  }

  saveRuntimeSecrets(password: string | null): void {
    if (!password) return
    this.ensureDir()
    const path = this.runtimeSecretsPath()
    writeFileSync(path, JSON.stringify({ password }, null, 2) + '\n', 'utf-8')
    try {
      chmodSync(path, 0o600)
    } catch {
      /* ignore on platforms without chmod support */
    }
  }

  async getWallet(walletId: string, network?: string): Promise<Wallet> {
    const conf = this.getWalletConfig(walletId) // throws if not found
    const resolvedNetwork =
      conf.type === 'privy' ? undefined : resolveNetwork(network, this.network)
    const cached = this.getWalletCache(walletId, conf.type as WalletType, resolvedNetwork)
    if (!cached) {
      const wallet = createAdapter(
        conf,
        this.configDir,
        this.password,
        resolvedNetwork,
        this.secretLoader,
      )
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

    // Fall back to first available wallet without password requirement
    for (const [walletId, conf] of Object.entries(this.config.wallets)) {
      if (walletIsAvailableWithoutPassword(conf, this.password)) {
        const resolvedNetwork = resolveNetwork(network, this.network)
        return this.getWallet(walletId, resolvedNetwork)
      }
    }

    if (Object.keys(this.config.wallets).length > 0) {
      throw new Error('Password required for local_secure wallets')
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

  private secretPath(secretRef: string): string {
    return join(this.configDir, `secret_${secretRef}.json`)
  }

  private runtimeSecretsPath(): string {
    return join(this.configDir, RUNTIME_SECRETS_FILENAME)
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

function walletIsAvailableWithoutPassword(
  conf: WalletConfig,
  password: string | undefined,
): boolean {
  return conf.type !== 'local_secure' || Boolean(password)
}
