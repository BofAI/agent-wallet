/**
 * Wallet resolution helpers.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

import type { Wallet } from './base.js'
import {
  ConfigNotFoundError,
  loadConfig,
  loadRuntimeSecretsPassword,
  type WalletsTopology,
} from './config.js'
import { ConfigWalletProvider } from './providers/config-provider.js'
import { EnvWalletProvider } from './providers/env-provider.js'
import { loadLocalSecret } from '../local/secret-loader.js'

const DEFAULT_SECRETS_DIR = join(homedir(), '.agent-wallet')
const ENV_AGENT_WALLET_PASSWORD = 'AGENT_WALLET_PASSWORD'
const ENV_AGENT_WALLET_DIR = 'AGENT_WALLET_DIR'
const ENV_PRIVATE_KEY_KEYS = ['AGENT_WALLET_PRIVATE_KEY', 'TRON_PRIVATE_KEY'] as const
const ENV_MNEMONIC_KEYS = ['AGENT_WALLET_MNEMONIC', 'TRON_MNEMONIC'] as const
const ENV_ACCOUNT_INDEX_KEYS = [
  'AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX',
  'TRON_ACCOUNT_INDEX',
] as const

export type ResolvedWalletProvider = ConfigWalletProvider | EnvWalletProvider

export function resolveWalletProvider(options?: {
  network?: string
  dir?: string
}): ResolvedWalletProvider {
  const resolvedDir = resolveDir(options?.dir)
  const password = resolvePassword(resolvedDir)

  if (password) {
    return new ConfigWalletProvider(resolvedDir, password, {
      network: options?.network,
      secretLoader: loadLocalSecret,
    })
  }

  const config = loadConfigSafe(resolvedDir)
  if (hasAvailableConfigWallet(config)) {
    return new ConfigWalletProvider(resolvedDir, undefined, {
      network: options?.network,
      secretLoader: loadLocalSecret,
    })
  }

  return new EnvWalletProvider({
    network: options?.network,
    privateKey: firstEnv(ENV_PRIVATE_KEY_KEYS),
    mnemonic: firstEnv(ENV_MNEMONIC_KEYS),
    accountIndex: parseAccountIndex(firstEnv(ENV_ACCOUNT_INDEX_KEYS)),
  })
}

export async function resolveWallet(options?: {
  network?: string
  dir?: string
  walletId?: string
}): Promise<Wallet> {
  const provider = resolveWalletProvider({ network: options?.network, dir: options?.dir })

  if (provider instanceof ConfigWalletProvider) {
    return options?.walletId
      ? provider.getWallet(options.walletId, options?.network)
      : provider.getActiveWallet(options?.network)
  }

  if (provider instanceof EnvWalletProvider) {
    return provider.getWallet()
  }

  throw new Error(`Unsupported provider resolved: ${(provider as object).constructor.name}`)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function expandTilde(p: string): string {
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return p
}

function resolveDir(dir: string | undefined): string {
  if (dir) return expandTilde(dir)
  const envDir = cleanEnvValue(process.env[ENV_AGENT_WALLET_DIR])
  if (envDir) return expandTilde(envDir)
  return DEFAULT_SECRETS_DIR
}

function resolvePassword(secretsDir: string): string | null {
  const filePassword = loadRuntimeSecretsPassword(secretsDir)
  if (filePassword) return filePassword
  return cleanEnvValue(process.env[ENV_AGENT_WALLET_PASSWORD]) ?? null
}

function loadConfigSafe(secretsDir: string): WalletsTopology | null {
  try {
    return loadConfig(secretsDir)
  } catch (error) {
    if (!(error instanceof ConfigNotFoundError)) {
      throw error
    }
    return null
  }
}

function hasAvailableConfigWallet(config: WalletsTopology | null): boolean {
  return Boolean(config && Object.keys(config.wallets).length > 0)
}

function firstEnv(keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = cleanEnvValue(process.env[key])
    if (value !== undefined) return value
  }
  return undefined
}

function cleanEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function parseAccountIndex(value: string | undefined): number {
  const normalized = value?.trim()
  if (!normalized) return 0
  if (!/^\d+$/.test(normalized)) {
    throw new Error('AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX must be a non-negative integer')
  }
  return Number(normalized)
}
