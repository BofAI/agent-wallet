import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { resolveWalletProvider, resolveWallet } from '../src/core/resolver.js'
import { EnvWalletProvider } from '../src/core/providers/env-provider.js'
import { ConfigWalletProvider } from '../src/core/providers/config-provider.js'
import { WalletNotFoundError } from '../src/core/errors.js'
import { saveConfig, type WalletsTopology } from '../src/core/config.js'
import { loadLocalSecret } from '../src/local/secret-loader.js'

/**
 * These tests verify that resolveWalletProvider / resolveWallet / getActiveWallet
 * always throw when no valid wallet can be resolved — no silent fallback to
 * a "default" or empty wallet in any code path.
 */

const ENV_KEYS = [
  'AGENT_WALLET_PASSWORD',
  'AGENT_WALLET_DIR',
  'AGENT_WALLET_PRIVATE_KEY',
  'TRON_PRIVATE_KEY',
  'AGENT_WALLET_MNEMONIC',
  'TRON_MNEMONIC',
  'AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX',
  'TRON_ACCOUNT_INDEX',
]

const NONEXISTENT_DIR = '/tmp/nonexistent-agent-wallet-test-dir'

describe('resolver – no valid wallet source', () => {
  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key]
      } else {
        delete process.env[key]
      }
    }
  })

  // -----------------------------------------------------------------------
  // resolveWalletProvider
  // -----------------------------------------------------------------------

  describe('resolveWalletProvider', () => {
    it('falls back to EnvWalletProvider when no config or password exists', () => {
      const provider = resolveWalletProvider({ dir: NONEXISTENT_DIR })
      expect(provider).toBeInstanceOf(EnvWalletProvider)
    })
  })

  // -----------------------------------------------------------------------
  // resolveWallet — end-to-end: must throw when no valid source
  // -----------------------------------------------------------------------

  describe('resolveWallet', () => {
    it('throws when no wallet source (evm)', async () => {
      await expect(resolveWallet({ dir: NONEXISTENT_DIR, network: 'evm' })).rejects.toThrow(
        'resolve_wallet could not find a wallet source in config or env',
      )
    })

    it('throws when no wallet source (tron)', async () => {
      await expect(resolveWallet({ dir: NONEXISTENT_DIR, network: 'tron' })).rejects.toThrow(
        'resolve_wallet could not find a wallet source in config or env',
      )
    })

    it('throws when no network is specified and no env source exists', async () => {
      await expect(resolveWallet({ dir: NONEXISTENT_DIR })).rejects.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // EnvWalletProvider.getActiveWallet — every failure path
  // -----------------------------------------------------------------------

  describe('EnvWalletProvider – getActiveWallet always throws without valid source', () => {
    it('throws when neither privateKey nor mnemonic is provided', async () => {
      const provider = new EnvWalletProvider({ network: 'evm' })
      await expect(provider.getActiveWallet()).rejects.toThrow(
        'resolve_wallet could not find a wallet source in config or env',
      )
    })

    it('throws when network is missing even with a valid privateKey', async () => {
      const provider = new EnvWalletProvider({
        privateKey: '4c0883a69102937d6231471b5dbb6204fe512961708279f3e27e8e4ce3e66c3b',
      })
      await expect(provider.getActiveWallet()).rejects.toThrow('network is required')
    })

    it('throws when network is missing even with a valid mnemonic', async () => {
      const provider = new EnvWalletProvider({
        mnemonic: 'test test test test test test test test test test test junk',
      })
      await expect(provider.getActiveWallet()).rejects.toThrow('network is required')
    })

    it('constructor throws when both privateKey and mnemonic are provided', () => {
      expect(
        () =>
          new EnvWalletProvider({
            privateKey: 'deadbeef',
            mnemonic:
              'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
          }),
      ).toThrow('Provide only one of AGENT_WALLET_PRIVATE_KEY or AGENT_WALLET_MNEMONIC')
    })
  })

  // -----------------------------------------------------------------------
  // ConfigWalletProvider.getActiveWallet — every failure path
  // -----------------------------------------------------------------------

  describe('ConfigWalletProvider – getActiveWallet always throws without valid wallet', () => {
    let tempDir: string

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'agent-wallet-resolver-test-'))
    })

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true })
    })

    it('throws WalletNotFoundError when config has zero wallets', async () => {
      saveConfig(tempDir, { active_wallet: null, wallets: {} })
      const provider = new ConfigWalletProvider(tempDir, undefined, {
        network: 'eip155',
        secretLoader: loadLocalSecret,
      })
      await expect(provider.getActiveWallet()).rejects.toThrow(WalletNotFoundError)
      await expect(provider.getActiveWallet()).rejects.toThrow('No active wallet set')
    })

    it('throws WalletNotFoundError when active_wallet points to non-existent id', async () => {
      saveConfig(tempDir, { active_wallet: 'ghost', wallets: {} })
      const provider = new ConfigWalletProvider(tempDir, undefined, {
        network: 'eip155',
        secretLoader: loadLocalSecret,
      })
      await expect(provider.getActiveWallet()).rejects.toThrow(WalletNotFoundError)
      await expect(provider.getActiveWallet()).rejects.toThrow("Wallet 'ghost' not found")
    })

    it('throws when all wallets are local_secure but no password is provided', async () => {
      const config: WalletsTopology = {
        active_wallet: null,
        wallets: {
          secure1: { type: 'local_secure', params: { secret_ref: 'sec1' } },
          secure2: { type: 'local_secure', params: { secret_ref: 'sec2' } },
        },
      }
      saveConfig(tempDir, config)
      const provider = new ConfigWalletProvider(tempDir, undefined, {
        network: 'eip155',
        secretLoader: loadLocalSecret,
      })
      await expect(provider.getActiveWallet()).rejects.toThrow(
        'Password required for local_secure wallets',
      )
    })

    it('throws when active_wallet is local_secure and password is wrong (no fallback)', async () => {
      const config: WalletsTopology = {
        active_wallet: 'secure',
        wallets: {
          secure: { type: 'local_secure', params: { secret_ref: 'secure' } },
          hot: {
            type: 'raw_secret',
            params: { source: 'private_key', private_key: '0xdeadbeef' },
          },
        },
      }
      saveConfig(tempDir, config)
      // active_wallet is 'secure' — it should NOT silently fall back to 'hot'
      const provider = new ConfigWalletProvider(tempDir, 'wrong-pw', {
        network: 'eip155',
        secretLoader: loadLocalSecret,
      })
      await expect(provider.getActiveWallet()).rejects.toThrow()
    })

    it('throws when network is missing', async () => {
      const config: WalletsTopology = {
        active_wallet: 'hot',
        wallets: {
          hot: {
            type: 'raw_secret',
            params: {
              source: 'private_key',
              private_key: '0x4c0883a69102937d6231471b5dbb6204fe512961708279f3e27e8e4ce3e66c3b',
            },
          },
        },
      }
      saveConfig(tempDir, config)
      // No network in constructor or getActiveWallet call
      const provider = new ConfigWalletProvider(tempDir, undefined, {
        secretLoader: loadLocalSecret,
      })
      await expect(provider.getActiveWallet()).rejects.toThrow('network is required')
    })

    it('throws on getWallet with non-existent walletId', async () => {
      saveConfig(tempDir, { active_wallet: null, wallets: {} })
      const provider = new ConfigWalletProvider(tempDir, undefined, {
        network: 'eip155',
        secretLoader: loadLocalSecret,
      })
      await expect(provider.getWallet('nope', 'eip155')).rejects.toThrow(WalletNotFoundError)
    })
  })
})
