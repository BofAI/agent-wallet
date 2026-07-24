/**
 * Wallet resolution helpers.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

import type { Wallet } from './base.js'
import { ENV_AGENT_WALLET_DIR } from './base.js'
import {
  ConfigNotFoundError,
  loadConfig,
  type WalletsTopology,
} from './config.js'
import { ConfigWalletProvider } from './providers/config-provider.js'
import { EnvWalletProvider } from './providers/env-provider.js'
import { cleanEnvValue } from './utils/env.js'

const DEFAULT_SECRETS_DIR = join(homedir(), '.agent-wallet')

export type ResolvedWalletProvider = ConfigWalletProvider | EnvWalletProvider

export function resolveWalletProvider(options?: {
  network?: string
  dir?: string
}): ResolvedWalletProvider {
  const resolvedDir = resolveDir(options?.dir)

  const config = loadConfigSafe(resolvedDir)
  if (hasAvailableConfigWallet(config)) {
    return new ConfigWalletProvider(resolvedDir, {
      network: options?.network,
    })
  }

  return new EnvWalletProvider({
    network: options?.network,
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
    return provider.getActiveWallet(options?.network)
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
