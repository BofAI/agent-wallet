/**
 * Provider for directly supplied secret material.
 */

import type { Wallet, WalletProvider } from '../base.js'
import {
  ENV_ACCOUNT_INDEX_KEYS,
  ENV_MNEMONIC_KEYS,
  ENV_PRIVATE_KEY_KEYS,
} from '../base.js'
import type { RawSecretPrivateKeyParams, RawSecretMnemonicParams } from '../config.js'
import { createEnvAdapter, type EnvWalletResolved } from './wallet-builder.js'
import { firstEnv, parseAccountIndex } from '../utils/env.js'
import { resolveNetwork } from '../utils/network.js'

export class EnvWalletProvider implements WalletProvider {
  private readonly _network: string | undefined
  private readonly _env: NodeJS.ProcessEnv

  constructor(options: {
    network?: string
    env?: NodeJS.ProcessEnv
  }) {
    this._network = options.network
    this._env = options.env ?? process.env
  }

  async getActiveWallet(network?: string): Promise<Wallet> {
    const resolved = resolveEnvWallet(this._env, network, this._network)
    if (!resolved) {
      throw new Error('resolve_wallet could not find a wallet source in config or env')
    }
    return createEnvAdapter(resolved)
  }

  async getWallet(network?: string): Promise<Wallet> {
    return this.getActiveWallet(network)
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveEnvWallet(
  env: NodeJS.ProcessEnv,
  explicitNetwork: string | undefined,
  providerDefault: string | undefined,
): EnvWalletResolved | null {
  const raw = parseRawSecretEnv(env)
  if (raw) {
    return {
      params: raw,
      network: resolveNetwork(explicitNetwork, providerDefault),
    }
  }
  return null
}

function parseRawSecretEnv(
  env: NodeJS.ProcessEnv,
): RawSecretPrivateKeyParams | RawSecretMnemonicParams | null {
  const privateKey = firstEnv(env, ENV_PRIVATE_KEY_KEYS)
  const mnemonic = firstEnv(env, ENV_MNEMONIC_KEYS)
  if (privateKey && mnemonic) {
    throw new Error('Provide only one of AGENT_WALLET_PRIVATE_KEY or AGENT_WALLET_MNEMONIC')
  }
  if (privateKey) {
    return { source: 'private_key' as const, private_key: privateKey }
  }
  if (mnemonic) {
    return {
      source: 'mnemonic' as const,
      mnemonic,
      account_index: parseAccountIndex(firstEnv(env, ENV_ACCOUNT_INDEX_KEYS)),
    }
  }
  return null
}
