import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveWallet, resolveWalletProvider } from '../src/core/resolver.js'
import { ConfigWalletProvider, EnvWalletProvider } from '../src/core/providers/index.js'
import { type WalletsTopology, saveConfig } from '../src/core/config.js'
import { WalletNotFoundError, DecryptionError } from '../src/core/errors.js'
import { SecureKVStore } from '../src/local/kv-store.js'
import { loadLocalSecret } from '../src/local/secret-loader.js'
import { createAdapter } from '../src/core/providers/wallet-builder.js'

const TEST_PASSWORD = 'test-registry-pw'
const TEST_PRIVATE_KEY = '0x4c0883a69102937d6231471b5dbb6204fe512961708279f3e27e8e4ce3e66c3b'
const TEST_MNEMONIC = 'test test test test test test test test test test test junk'
const TEST_EVM_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const TEST_EVM_ADDRESS_INDEX_1 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const TEST_ENV_PRIVATE_KEY_ADDRESS = '0x71575b840BCA06B0c80224f42017A40A171fB134'

let secretsDir = ''
let localSecureTemplateDir = ''

function resetWalletEnv(): void {
  for (const key of [
    'AGENT_WALLET_PASSWORD',
    'AGENT_WALLET_DIR',
    'AGENT_WALLET_PRIVATE_KEY',
    'AGENT_WALLET_MNEMONIC',
    'AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX',
    'TRON_PRIVATE_KEY',
    'TRON_MNEMONIC',
    'TRON_ACCOUNT_INDEX',
    'PRIVY_APP_ID',
    'PRIVY_APP_SECRET',
    'PRIVY_WALLET_ID',
    'AGENT_WALLET_PRIVY_APP_ID',
    'AGENT_WALLET_PRIVY_APP_SECRET',
    'AGENT_WALLET_PRIVY_WALLET_ID',
  ]) {
    delete process.env[key]
  }
}

function setupLocalSecureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-wallet-registry-test-'))
  const kv = new SecureKVStore(dir, TEST_PASSWORD)
  kv.initMaster()
  kv.saveSecret('eth_test', Buffer.from(TEST_PRIVATE_KEY.slice(2), 'hex'))
  const config: WalletsTopology = {
    active_wallet: 'eth_test',
    wallets: {
      eth_test: {
        type: 'local_secure',
        params: { secret_ref: 'eth_test' },
      },
    },
  }
  saveConfig(dir, config)
  return dir
}

function cloneDir(src: string, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  cpSync(src, dir, { recursive: true })
  return dir
}

function writePasswordConfig(dir: string, password: string): void {
  writeFileSync(join(dir, 'runtime_secrets.json'), JSON.stringify({ password }), 'utf-8')
}

function writeRawPrivateKeyConfig(dir: string, activeWallet = 'hot'): void {
  saveConfig(dir, {
    active_wallet: activeWallet,
    wallets: {
      [activeWallet]: {
        type: 'raw_secret',
        params: {
          source: 'private_key',
          private_key: TEST_PRIVATE_KEY,
        },
      },
    },
  })
}

beforeAll(() => {
  localSecureTemplateDir = setupLocalSecureDir()
})

beforeEach(() => {
  secretsDir = cloneDir(localSecureTemplateDir, 'agent-wallet-registry-test-')
  resetWalletEnv()
  vi.restoreAllMocks()
})

afterEach(() => {
  resetWalletEnv()
  rmSync(secretsDir, { recursive: true, force: true })
  secretsDir = ''
})

afterAll(() => {
  if (localSecureTemplateDir) {
    rmSync(localSecureTemplateDir, { recursive: true, force: true })
  }
})

describe('ConfigWalletProvider', () => {
  it('gets active local_secure wallet', async () => {
    const provider = new ConfigWalletProvider(secretsDir, TEST_PASSWORD, {
      secretLoader: loadLocalSecret,
    })
    const wallet = await provider.getActiveWallet('eip155')
    expect(await wallet.getAddress()).toBe(TEST_ENV_PRIVATE_KEY_ADDRESS)
  })

  it('uses provider default network', async () => {
    const provider = new ConfigWalletProvider(secretsDir, TEST_PASSWORD, {
      network: 'eip155',
      secretLoader: loadLocalSecret,
    })
    const wallet = await provider.getActiveWallet()
    expect(await wallet.getAddress()).toBe(TEST_ENV_PRIVATE_KEY_ADDRESS)
  })

  it('throws on wallet not found', async () => {
    const provider = new ConfigWalletProvider(secretsDir, TEST_PASSWORD, {
      secretLoader: loadLocalSecret,
    })
    await expect(provider.getWallet('missing', 'eip155')).rejects.toThrow(WalletNotFoundError)
  })

  it('throws on wrong password during wallet access', async () => {
    const provider = new ConfigWalletProvider(secretsDir, 'wrong-password', {
      secretLoader: loadLocalSecret,
    })
    await expect(provider.getActiveWallet('eip155')).rejects.toThrow(DecryptionError)
  })

  it('resolves raw_secret private key config', async () => {
    writeRawPrivateKeyConfig(secretsDir)
    const provider = new ConfigWalletProvider(secretsDir, undefined, {
      secretLoader: loadLocalSecret,
    })
    const wallet = await provider.getActiveWallet('eip155')
    expect(await wallet.getAddress()).toBe(TEST_ENV_PRIVATE_KEY_ADDRESS)
  })

  it('does not fall back away from active local_secure without password', async () => {
    saveConfig(secretsDir, {
      active_wallet: 'secure',
      wallets: {
        secure: { type: 'local_secure', params: { secret_ref: 'secure' } },
        hot: {
          type: 'raw_secret',
          params: {
            source: 'private_key',
            private_key: TEST_PRIVATE_KEY,
          },
        },
      },
    })
    const provider = new ConfigWalletProvider(secretsDir, undefined, {
      secretLoader: loadLocalSecret,
    })
    await expect(provider.getActiveWallet('eip155')).rejects.toThrow(/Password required/)
  })

  it('falls back to first available wallet when no active wallet is set', async () => {
    saveConfig(secretsDir, {
      active_wallet: null,
      wallets: {
        secure: { type: 'local_secure', params: { secret_ref: 'secure' } },
        hot: {
          type: 'raw_secret',
          params: {
            source: 'private_key',
            private_key: TEST_PRIVATE_KEY,
          },
        },
      },
    })
    const provider = new ConfigWalletProvider(secretsDir, undefined, {
      secretLoader: loadLocalSecret,
    })
    const wallet = await provider.getActiveWallet('eip155')
    expect(await wallet.getAddress()).toBe(TEST_ENV_PRIVATE_KEY_ADDRESS)
  })

  it('resolves raw_secret mnemonic config', async () => {
    saveConfig(secretsDir, {
      active_wallet: 'seed',
      wallets: {
        seed: {
          type: 'raw_secret',
          params: {
            source: 'mnemonic',
            mnemonic: TEST_MNEMONIC,
            account_index: 1,
          },
        },
      },
    })
    const provider = new ConfigWalletProvider(secretsDir, undefined, {
      secretLoader: loadLocalSecret,
    })
    const wallet = await provider.getActiveWallet('eip155:1')
    expect(await wallet.getAddress()).toBe(TEST_EVM_ADDRESS_INDEX_1)
  })

  it('persists setActive', () => {
    writeRawPrivateKeyConfig(secretsDir, 'a')
    const provider = new ConfigWalletProvider(secretsDir, undefined, {
      secretLoader: loadLocalSecret,
    })
    provider.addWallet('b', {
      type: 'raw_secret',
      params: {
        source: 'private_key',
        private_key: TEST_PRIVATE_KEY,
      },
    })
    provider.setActive('b')
    const reloaded = new ConfigWalletProvider(secretsDir, undefined, {
      secretLoader: loadLocalSecret,
    })
    expect(reloaded.getActiveId()).toBe('b')
  })

  it('throws on invalid config instead of treating it as empty', () => {
    writeFileSync(
      join(secretsDir, 'wallets_config.json'),
      JSON.stringify({
        wallets: {
          broken: {
            type: 'evm_local',
            identity_file: 'broken',
          },
        },
      }),
      'utf-8',
    )

    expect(
      () =>
        new ConfigWalletProvider(secretsDir, undefined, {
          secretLoader: loadLocalSecret,
        }),
    ).toThrow()
  })
})

describe('EnvWalletProvider', () => {
  it('resolves private key EVM wallet', async () => {
    process.env.AGENT_WALLET_PRIVATE_KEY = TEST_PRIVATE_KEY
    const provider = new EnvWalletProvider({ network: 'eip155' })
    const wallet = await provider.getWallet()
    expect(await wallet.getAddress()).toBe(TEST_ENV_PRIVATE_KEY_ADDRESS)
  })

  it('resolves mnemonic EVM wallet', async () => {
    process.env.AGENT_WALLET_MNEMONIC = TEST_MNEMONIC
    const provider = new EnvWalletProvider({ network: 'eip155:1' })
    const wallet = await provider.getWallet()
    expect(await wallet.getAddress()).toBe(TEST_EVM_ADDRESS)
  })

  it('resolves mnemonic account index', async () => {
    process.env.AGENT_WALLET_MNEMONIC = TEST_MNEMONIC
    process.env.AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX = '1'
    const provider = new EnvWalletProvider({ network: 'eip155:1' })
    const wallet = await provider.getWallet()
    expect(await wallet.getAddress()).toBe(TEST_EVM_ADDRESS_INDEX_1)
  })

  it('allows missing network until wallet access', async () => {
    process.env.AGENT_WALLET_PRIVATE_KEY = TEST_PRIVATE_KEY
    const provider = new EnvWalletProvider({})
    await expect(provider.getWallet()).rejects.toThrow(/network is required/)
  })

  it('rejects conflicting sources', () => {
    process.env.AGENT_WALLET_PRIVATE_KEY = TEST_PRIVATE_KEY
    process.env.AGENT_WALLET_MNEMONIC = TEST_MNEMONIC
    const provider = new EnvWalletProvider({ network: 'eip155' })
    return expect(provider.getWallet()).rejects.toThrow(/Provide only one of/)
  })

  it('rejects missing sources on access', async () => {
    const provider = new EnvWalletProvider({ network: 'eip155' })
    await expect(provider.getWallet()).rejects.toThrow(/could not find a wallet source/)
  })

  it('ignores privy env vars', async () => {
    process.env.PRIVY_APP_ID = 'app-id'
    process.env.PRIVY_APP_SECRET = 'app-secret'
    process.env.PRIVY_WALLET_ID = 'wallet-id'
    const provider = new EnvWalletProvider({ network: 'eip155' })
    await expect(provider.getWallet()).rejects.toThrow(/could not find a wallet source/)
  })
})

describe('resolver', () => {
  it('password file takes precedence over env fallback', async () => {
    writePasswordConfig(secretsDir, TEST_PASSWORD)
    process.env.AGENT_WALLET_PRIVATE_KEY = TEST_PRIVATE_KEY
    const wallet = await resolveWallet({ dir: secretsDir, network: 'eip155' })
    expect(await wallet.getAddress()).toBe(TEST_ENV_PRIVATE_KEY_ADDRESS)
  })

  it('resolveWalletProvider prefers config', () => {
    const provider = resolveWalletProvider({ dir: secretsDir, network: 'eip155' })
    expect(provider).toBeInstanceOf(ConfigWalletProvider)
  })

  it('resolveWalletProvider falls back to env', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'agent-wallet-registry-empty-'))
    try {
      process.env.AGENT_WALLET_PRIVATE_KEY = TEST_PRIVATE_KEY
      const provider = resolveWalletProvider({ dir: emptyDir, network: 'eip155' })
      expect(provider).toBeInstanceOf(EnvWalletProvider)
    } finally {
      rmSync(emptyDir, { recursive: true, force: true })
    }
  })

  it('resolves non-local active wallet from config without password', async () => {
    writeRawPrivateKeyConfig(secretsDir)
    const wallet = await resolveWallet({ dir: secretsDir, network: 'eip155' })
    expect(await wallet.getAddress()).toBe(TEST_ENV_PRIVATE_KEY_ADDRESS)
  })

  it('falls back to env private key', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'agent-wallet-registry-empty-'))
    try {
      process.env.AGENT_WALLET_PRIVATE_KEY = TEST_PRIVATE_KEY
      const wallet = await resolveWallet({ dir: emptyDir, network: 'eip155' })
      expect(await wallet.getAddress()).toBe(TEST_ENV_PRIVATE_KEY_ADDRESS)
    } finally {
      rmSync(emptyDir, { recursive: true, force: true })
    }
  })

  it('falls back to env mnemonic', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'agent-wallet-registry-empty-'))
    try {
      process.env.AGENT_WALLET_MNEMONIC = TEST_MNEMONIC
      const wallet = await resolveWallet({ dir: emptyDir, network: 'eip155:1' })
      expect(await wallet.getAddress()).toBe(TEST_EVM_ADDRESS)
    } finally {
      rmSync(emptyDir, { recursive: true, force: true })
    }
  })

  it('throws when all sources are missing', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'agent-wallet-registry-empty-'))
    try {
      await expect(resolveWallet({ dir: emptyDir, network: 'eip155' })).rejects.toThrow(
        /could not find a wallet source/,
      )
    } finally {
      rmSync(emptyDir, { recursive: true, force: true })
    }
  })

  it('does not fall back to env when config exists but is invalid', () => {
    writeFileSync(
      join(secretsDir, 'wallets_config.json'),
      JSON.stringify({
        wallets: {
          broken: {
            type: 'evm_local',
            identity_file: 'broken',
          },
        },
      }),
      'utf-8',
    )
    process.env.AGENT_WALLET_PRIVATE_KEY = TEST_PRIVATE_KEY

    expect(() => resolveWalletProvider({ dir: secretsDir, network: 'eip155' })).toThrow()
  })
})

describe('wallet builder contracts', () => {
  it('passes the full network string to adapters after family routing', async () => {
    const conf = {
      type: 'raw_secret' as const,
      params: {
        source: 'private_key' as const,
        private_key: TEST_PRIVATE_KEY,
      },
    }
    const wallet = createAdapter(conf, secretsDir, undefined, 'eip155:8453', undefined)
    expect((wallet as any)._network).toBe('eip155:8453')
  })
})
