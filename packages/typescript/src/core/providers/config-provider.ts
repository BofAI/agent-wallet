/**
 * Config-driven wallet provider — handles all wallet types from wallets_config.json.
 */

import { existsSync, mkdirSync, chmodSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Wallet, WalletProvider } from '../base.js'
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
import { createAdapter, decodePrivateKey, deriveKeyFromMnemonic, parseNetworkFamily } from './wallet-builder.js'

export type SecretLoaderFn = (configDir: string, password: string, secretRef: string) => Uint8Array

export class ConfigWalletProvider implements WalletProvider {
  private readonly configDir: string
  private readonly password: string | undefined
  private readonly network: string | undefined
  private readonly secretLoader: SecretLoaderFn | undefined
  private readonly configPath: string
  private config: WalletsTopology
  private readonly wallets = new Map<string, Wallet>()

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

  addWallet(
    walletId: string,
    config: WalletConfig,
    opts?: { setActiveIfMissing?: boolean },
  ): void {
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
      const secretPath = this.secretPath(conf.secret_ref)
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
    return existsSync(this.secretPath(conf.secret_ref))
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
    writeFileSync(
      path,
      JSON.stringify({ password }, null, 2) + '\n',
      'utf-8',
    )
    try {
      chmodSync(path, 0o600)
    } catch {
      /* ignore on platforms without chmod support */
    }
  }

  async getWallet(walletId: string, network?: string): Promise<Wallet> {
    this.getWalletConfig(walletId) // throws if not found
    const resolvedNetwork = resolveNetwork(network, this.network)
    const cacheKey = `${walletId}:${resolvedNetwork}`
    if (!this.wallets.has(cacheKey)) {
      const conf = this.config.wallets[walletId]
      this.wallets.set(
        cacheKey,
        createWalletFromConfig(conf, this.configDir, this.password, resolvedNetwork, this.secretLoader),
      )
    }
    return this.wallets.get(cacheKey)!
  }

  async getActiveWallet(network?: string): Promise<Wallet> {
    const resolvedNetwork = resolveNetwork(network, this.network)
    const activeId = this.config.active_wallet
    if (activeId) {
      return this.getWallet(activeId, resolvedNetwork)
    }

    // Fall back to first available wallet without password requirement
    for (const [walletId, conf] of Object.entries(this.config.wallets)) {
      if (walletIsAvailableWithoutPassword(conf, this.password)) {
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
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function createWalletFromConfig(
  conf: WalletConfig,
  configDir: string,
  password: string | undefined,
  network: string,
  secretLoader: SecretLoaderFn | undefined,
): Wallet {
  if (conf.type === 'local_secure') {
    if (!password) throw new Error('Password required for local_secure wallets')
    if (!secretLoader) throw new Error('local_secure wallets require a configured secret loader')
    const privateKey = secretLoader(configDir, password, conf.secret_ref)
    return createAdapter(network, privateKey)
  }

  if (conf.type === 'raw_secret') {
    const material = conf.material
    if (material.source === 'private_key') {
      const privateKey = decodePrivateKey(material.private_key)
      return createAdapter(network, privateKey)
    }
    if (material.source === 'mnemonic') {
      const family = parseNetworkFamily(network)
      const privateKey = deriveKeyFromMnemonic(family, material.mnemonic, material.account_index)
      return createAdapter(network, privateKey)
    }
  }

  throw new Error(`Unknown wallet config type: ${conf.type}`)
}

function walletIsAvailableWithoutPassword(
  conf: WalletConfig,
  password: string | undefined,
): boolean {
  return conf.type !== 'local_secure' || Boolean(password)
}

function resolveNetwork(explicit: string | undefined, providerDefault: string | undefined): string {
  if (explicit) return explicit
  if (providerDefault) return providerDefault
  throw new Error('network is required')
}
