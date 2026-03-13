import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DecryptionError,
  InsufficientBalanceError,
  NetworkError,
  SigningError,
  UnsupportedOperationError,
  WalletError,
  WalletNotFoundError,
} from '../src/core/errors.js'
import {
  LocalWalletProvider,
  StaticWalletProvider,
  WalletProvider,
  resolveWalletProvider,
} from '../src/core/providers/index.js'
import { saveConfig } from '../src/local/config.js'
import { SecureKVStore } from '../src/local/kv-store.js'

const TEST_PRIVATE_KEY = '0x4c0883a69102937d6231471b5dbb6204fe512961708279f3e27e8e4ce3e66c3b'
const TEST_MNEMONIC = 'test test test test test test test test test test test junk'
const TEST_EVM_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const TEST_EVM_ADDRESS_INDEX_1 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

let secretsDir = ''
let password = ''

function setupEvmSecrets(): void {
  secretsDir = mkdtempSync(join(tmpdir(), 'agent-wallet-registry-test-'))
  password = 'test-registry-pw'
  const kv = new SecureKVStore(secretsDir, password)
  kv.initMaster()
  kv.savePrivateKey('id_eth_test', randomBytes(32))

  saveConfig(secretsDir, {
    config_version: 1,
    active_wallet: 'eth_test',
    wallets: {
      eth_test: {
        type: 'evm_local',
        identity_file: 'id_eth_test',
      },
    },
  })
}

function resetWalletEnv(): void {
  for (const key of [
    'AGENT_WALLET_PASSWORD',
    'AGENT_WALLET_DIR',
    'AGENT_WALLET_PRIVATE_KEY',
    'AGENT_WALLET_MNEMONIC',
    'AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX',
  ]) {
    delete process.env[key]
  }
}

beforeEach(() => {
  setupEvmSecrets()
  resetWalletEnv()
  vi.restoreAllMocks()
})

afterEach(() => {
  resetWalletEnv()
  if (secretsDir) {
    rmSync(secretsDir, { recursive: true, force: true })
    secretsDir = ''
  }
})

describe('LocalWalletProvider', () => {
  it('should init and list wallets', async () => {
    const provider = new LocalWalletProvider(secretsDir, password)
    expect(provider).toBeInstanceOf(WalletProvider)
    const wallets = await provider.listWallets()
    expect(wallets.length).toBe(1)
    expect(wallets[0].id).toBe('eth_test')
    expect(wallets[0].type).toBe('evm_local')
  })

  it('should get wallet', async () => {
    const provider = new LocalWalletProvider(secretsDir, password)
    const wallet = await provider.getWallet('eth_test')
    expect(wallet).not.toBeNull()
  })

  it('should get active wallet', async () => {
    const provider = new LocalWalletProvider(secretsDir, password)
    const wallet = await provider.getActiveWallet()
    expect(wallet).not.toBeNull()
  })

  it('should throw on wallet not found', async () => {
    const provider = new LocalWalletProvider(secretsDir, password)
    await expect(provider.getWallet('nonexistent')).rejects.toThrow(
      WalletNotFoundError,
    )
  })

  it('should throw on wrong password', () => {
    expect(() => new LocalWalletProvider(secretsDir, 'wrong-password')).toThrow(
      DecryptionError,
    )
  })
})

describe('Error classes', () => {
  it('should construct all exported wallet errors', () => {
    const errors = [
      new WalletError('wallet'),
      new WalletNotFoundError('missing'),
      new DecryptionError('decrypt'),
      new InsufficientBalanceError('balance'),
      new SigningError('sign'),
      new NetworkError('network'),
      new UnsupportedOperationError('unsupported'),
    ]

    expect(errors.map((error) => error.name)).toEqual([
      'WalletError',
      'WalletNotFoundError',
      'DecryptionError',
      'InsufficientBalanceError',
      'SigningError',
      'NetworkError',
      'UnsupportedOperationError',
    ])
  })
})

describe('resolveWalletProvider', () => {
  it('should create local provider from env', () => {
    process.env.AGENT_WALLET_PASSWORD = password
    process.env.AGENT_WALLET_DIR = secretsDir

    const provider = resolveWalletProvider()
    expect(provider).toBeInstanceOf(LocalWalletProvider)
  })

  it('should prefer local provider when generic env also exists', () => {
    process.env.AGENT_WALLET_PASSWORD = password
    process.env.AGENT_WALLET_DIR = secretsDir
    process.env.AGENT_WALLET_PRIVATE_KEY = TEST_PRIVATE_KEY

    const provider = resolveWalletProvider()
    expect(provider).toBeInstanceOf(LocalWalletProvider)
  })

  it('should create static provider for EVM private key mode', () => {
    process.env.AGENT_WALLET_PRIVATE_KEY = TEST_PRIVATE_KEY

    const provider = resolveWalletProvider({ network: 'eip155' })
    expect(provider).toBeInstanceOf(StaticWalletProvider)
  })

  it('should throw on missing env', () => {
    expect(() => resolveWalletProvider()).toThrow(/resolveWalletProvider requires one of/)
  })

  it('should require network for generic env wallet mode', () => {
    process.env.AGENT_WALLET_PRIVATE_KEY = TEST_PRIVATE_KEY

    expect(() => resolveWalletProvider()).toThrow(/requires options\.network/)
  })

  it('should throw on conflicting generic env', () => {
    process.env.AGENT_WALLET_PRIVATE_KEY = TEST_PRIVATE_KEY
    process.env.AGENT_WALLET_MNEMONIC = TEST_MNEMONIC

    expect(() => resolveWalletProvider({ network: 'tron' })).toThrow(
      /AGENT_WALLET_PRIVATE_KEY or AGENT_WALLET_MNEMONIC/,
    )
  })

  it('should derive an EVM wallet from mnemonic', async () => {
    process.env.AGENT_WALLET_MNEMONIC = TEST_MNEMONIC

    const provider = resolveWalletProvider({ network: 'eip155:1' })
    const wallet = await provider.getActiveWallet()
    expect(await wallet.getAddress()).toBe(TEST_EVM_ADDRESS)
  })

  it('should derive a TRON wallet from mnemonic', async () => {
    process.env.AGENT_WALLET_MNEMONIC = TEST_MNEMONIC

    const provider = resolveWalletProvider({ network: 'tron:nile' })
    const wallet = await provider.getActiveWallet()
    expect((await wallet.getAddress()).startsWith('T')).toBe(true)
  })

  it('should derive an EVM wallet from mnemonic with account index', async () => {
    process.env.AGENT_WALLET_MNEMONIC = TEST_MNEMONIC
    process.env.AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX = '1'

    const provider = resolveWalletProvider({ network: 'eip155:1' })
    const wallet = await provider.getActiveWallet()
    expect(await wallet.getAddress()).toBe(TEST_EVM_ADDRESS_INDEX_1)
  })

  it('should reject unknown network prefixes', () => {
    process.env.AGENT_WALLET_PRIVATE_KEY = TEST_PRIVATE_KEY

    expect(() => resolveWalletProvider({ network: 'solana:devnet' })).toThrow(/must start with 'tron' or 'eip155'/)
  })

  it('should reject invalid account index', () => {
    process.env.AGENT_WALLET_MNEMONIC = TEST_MNEMONIC
    process.env.AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX = '-1'

    expect(() => resolveWalletProvider({ network: 'eip155' })).toThrow(
      /AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX must be a non-negative integer/,
    )
  })
})

describe('End-to-end', () => {
  it('should sign message via local provider', async () => {
    const provider = new LocalWalletProvider(secretsDir, password)
    const wallet = await provider.getWallet('eth_test')
    const addr = await wallet.getAddress()
    expect(addr.startsWith('0x')).toBe(true)
    const sig = await wallet.signMessage(Buffer.from('hello from provider'))
    expect(sig.length).toBeGreaterThan(0)
  })

  it('should sign message via env-backed factory', async () => {
    process.env.AGENT_WALLET_PRIVATE_KEY = TEST_PRIVATE_KEY

    const provider = resolveWalletProvider({ network: 'eip155' })
    const wallet = await provider.getActiveWallet()
    const addr = await wallet.getAddress()
    expect(addr.startsWith('0x')).toBe(true)
    const sig = await wallet.signMessage(Buffer.from('hello from env provider'))
    expect(sig.length).toBeGreaterThan(0)
  })
})
