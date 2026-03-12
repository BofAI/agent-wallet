import { homedir } from 'node:os'
import { join } from 'node:path'

import { mnemonicToAccount } from 'viem/accounts'

import type { BaseWallet } from '../base.js'
import { EvmWallet } from '../adapters/evm.js'
import { TronWallet } from '../adapters/tron.js'
import { LocalWalletProvider } from './local.js'
import { WalletProvider } from './base.js'
import { StaticWalletProvider } from './static.js'

function expandTilde(p: string): string {
  if (p === '~' || p.startsWith('~/')) return join(homedir(), p.slice(1))
  return p
}

const DEFAULT_SECRETS_DIR = join(homedir(), '.agent-wallet')
const ENV_AGENT_WALLET_PASSWORD = 'AGENT_WALLET_PASSWORD'
const ENV_AGENT_WALLET_DIR = 'AGENT_WALLET_DIR'
const ENV_TRON_PRIVATE_KEY = 'TRON_PRIVATE_KEY'
const ENV_TRON_MNEMONIC = 'TRON_MNEMONIC'
const ENV_EVM_PRIVATE_KEY = 'EVM_PRIVATE_KEY'
const ENV_EVM_MNEMONIC = 'EVM_MNEMONIC'
const TRON_MNEMONIC_PATH = "m/44'/195'/0'/0/0" as const

export function WalletFactory(): WalletProvider {
  const password = cleanEnvValue(process.env[ENV_AGENT_WALLET_PASSWORD])
  if (password) {
    const secretsDir = cleanEnvValue(process.env[ENV_AGENT_WALLET_DIR])
    return new LocalWalletProvider(
      expandTilde(secretsDir ?? DEFAULT_SECRETS_DIR),
      password,
    )
  }

  return new StaticWalletProvider(createWalletFromEnv(process.env))
}

class ValueError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValueError'
  }
}

function createWalletFromEnv(env: NodeJS.ProcessEnv): BaseWallet {
  const tronPrivateKey = cleanEnvValue(env[ENV_TRON_PRIVATE_KEY])
  const tronMnemonic = cleanEnvValue(env[ENV_TRON_MNEMONIC])
  const evmPrivateKey = cleanEnvValue(env[ENV_EVM_PRIVATE_KEY])
  const evmMnemonic = cleanEnvValue(env[ENV_EVM_MNEMONIC])

  assertSingleWalletSource({
    tronPrivateKey,
    tronMnemonic,
    evmPrivateKey,
    evmMnemonic,
  })

  if (tronPrivateKey) return createTronWalletFromPrivateKey(tronPrivateKey)
  if (tronMnemonic) return createTronWalletFromMnemonic(tronMnemonic)
  if (evmPrivateKey) return createEvmWalletFromPrivateKey(evmPrivateKey)
  if (evmMnemonic) return createEvmWalletFromMnemonic(evmMnemonic)

  throw new ValueError(
    'WalletFactory requires one of: AGENT_WALLET_PASSWORD, TRON_PRIVATE_KEY, TRON_MNEMONIC, EVM_PRIVATE_KEY, or EVM_MNEMONIC',
  )
}

function cleanEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function assertSingleWalletSource({
  tronPrivateKey,
  tronMnemonic,
  evmPrivateKey,
  evmMnemonic,
}: {
  tronPrivateKey?: string
  tronMnemonic?: string
  evmPrivateKey?: string
  evmMnemonic?: string
}): void {
  if (tronPrivateKey && tronMnemonic) {
    throw new ValueError('Provide only one of TRON_PRIVATE_KEY or TRON_MNEMONIC')
  }
  if (evmPrivateKey && evmMnemonic) {
    throw new ValueError('Provide only one of EVM_PRIVATE_KEY or EVM_MNEMONIC')
  }

  const hasTron = Boolean(tronPrivateKey || tronMnemonic)
  const hasEvm = Boolean(evmPrivateKey || evmMnemonic)
  if (hasTron && hasEvm) {
    throw new ValueError('Provide either TRON_* or EVM_* environment variables, not both')
  }
}

function createEvmWalletFromPrivateKey(privateKey: string): BaseWallet {
  return new EvmWallet(decodePrivateKey(privateKey))
}

function createEvmWalletFromMnemonic(mnemonic: string): BaseWallet {
  const account = mnemonicToAccount(mnemonic)
  const privateKey = account.getHdKey().privateKey
  if (!privateKey) throw new ValueError('Failed to derive private key from EVM_MNEMONIC')
  return new EvmWallet(privateKey)
}

function createTronWalletFromPrivateKey(privateKey: string): BaseWallet {
  return new TronWallet(decodePrivateKey(privateKey))
}

function createTronWalletFromMnemonic(mnemonic: string): BaseWallet {
  const account = mnemonicToAccount(mnemonic, {
    path: TRON_MNEMONIC_PATH as unknown as `m/44'/60'/${string}`,
  })
  const privateKey = account.getHdKey().privateKey
  if (!privateKey) throw new ValueError('Failed to derive private key from TRON_MNEMONIC')
  return new TronWallet(privateKey)
}

function decodePrivateKey(privateKey: string): Uint8Array {
  const normalized = privateKey.trim().replace(/^0x/, '')
  if (normalized.length !== 64) {
    throw new ValueError('Private key must be 32 bytes (64 hex characters)')
  }
  if (!/^[0-9a-fA-F]+$/.test(normalized)) {
    throw new ValueError('Private key must be a valid hex string')
  }
  return Uint8Array.from(Buffer.from(normalized, 'hex'))
}
