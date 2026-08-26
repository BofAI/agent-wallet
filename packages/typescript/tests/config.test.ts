import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  type PrivyWalletParams,
  RawSecretPrivateKeyParamsSchema,
  RawSecretMnemonicParamsSchema,
  WalletConfigSchema,
  WalletsTopologySchema,
  loadConfig,
  saveConfig,
  type WalletsTopology,
} from '../src/core/config.js'

let secretsDir: string

beforeEach(() => {
  secretsDir = mkdtempSync(join(tmpdir(), 'agent-wallet-config-test-'))
})

afterEach(() => {
  rmSync(secretsDir, { recursive: true, force: true })
})

describe('config schemas', () => {
  it('accepts raw_secret private key config', () => {
    const parsed = WalletConfigSchema.parse({
      type: 'raw_secret',
      params: {
        source: 'private_key',
        private_key: '0xabc',
      },
    })
    expect(parsed.type).toBe('raw_secret')
    expect(parsed.params.source).toBe('private_key')
  })

  it('accepts raw_secret mnemonic config', () => {
    const parsed = WalletConfigSchema.parse({
      type: 'raw_secret',
      params: {
        source: 'mnemonic',
        mnemonic: 'test test test test test test test test test test test junk',
      },
    })
    expect(parsed.params.source).toBe('mnemonic')
    expect(parsed.params.account_index).toBe(0)
  })

  it('rejects invalid wallet type', () => {
    expect(() =>
      WalletConfigSchema.parse({
        type: 'legacy_local',
        params: { source: 'private_key', private_key: '0xold' },
      }),
    ).toThrow()
  })

  it('rejects invalid raw_secret params source', () => {
    expect(() =>
      WalletConfigSchema.parse({
        type: 'raw_secret',
        params: {
          source: 'api_key',
          value: 'secret',
        },
      }),
    ).toThrow()
  })

  it('parses params sub-schemas independently', () => {
    const pkp = RawSecretPrivateKeyParamsSchema.parse({ source: 'private_key', private_key: '0x1' })
    expect(pkp.source).toBe('private_key')

    const mp = RawSecretMnemonicParamsSchema.parse({
      source: 'mnemonic',
      mnemonic: 'test',
      account_index: 2,
    })
    expect(mp.account_index).toBe(2)
  })

  it('accepts privy wallet config', () => {
    const parsed = WalletConfigSchema.parse({
      type: 'privy',
      params: {
        app_id: 'app',
        app_secret: 'secret',
        wallet_id: 'wallet',
      } satisfies PrivyWalletParams,
    })

    expect(parsed.type).toBe('privy')
    expect(parsed.params.app_id).toBe('app')
  })
})

describe('loadConfig / saveConfig', () => {
  it('roundtrips config', () => {
    const config: WalletsTopology = {
      active_wallet: 'wallet-a',
      wallets: {
        'wallet-a': {
          type: 'raw_secret',
          params: {
            source: 'private_key',
            private_key: '0x1234',
          },
        },
        hot: {
          type: 'raw_secret',
          params: {
            source: 'private_key',
            private_key: '0x1234',
          },
        },
      },
    }

    saveConfig(secretsDir, config)
    const loaded = loadConfig(secretsDir)

    expect(loaded.active_wallet).toBe('wallet-a')
    expect(loaded.wallets['wallet-a'].type).toBe('raw_secret')
    expect(loaded.wallets.hot.type).toBe('raw_secret')
  })

  it('throws on missing file', () => {
    expect(() => loadConfig(secretsDir)).toThrow(/Config not found/)
  })

  it('throws on invalid json', () => {
    writeFileSync(join(secretsDir, 'wallets_config.json'), 'not json', 'utf-8')
    expect(() => loadConfig(secretsDir)).toThrow()
  })

  it('writes snake_case JSON', () => {
    const config: WalletsTopology = {
      active_wallet: 'seed',
      wallets: {
        seed: {
          type: 'raw_secret',
          params: {
            source: 'mnemonic',
            mnemonic: 'test test test test test test test test test test test junk',
            account_index: 1,
          },
        },
      },
    }

    saveConfig(secretsDir, config)
    const raw = JSON.parse(readFileSync(join(secretsDir, 'wallets_config.json'), 'utf-8'))

    expect(raw.active_wallet).toBe('seed')
    expect(raw.wallets.seed.params.account_index).toBe(1)
    expect(raw.wallets.seed.params.mnemonic).toBeTypeOf('string')
  })

  it('omits null active_wallet on save', () => {
    const config: WalletsTopology = {
      active_wallet: null,
      wallets: {},
    }

    saveConfig(secretsDir, config)
    const raw = JSON.parse(readFileSync(join(secretsDir, 'wallets_config.json'), 'utf-8'))
    expect(raw.active_wallet).toBeUndefined()
  })
})

describe('wallet topology schema', () => {
  it('defaults active_wallet to null', () => {
    const parsed = WalletsTopologySchema.parse({
      wallets: {},
    })
    expect(parsed.active_wallet).toBeNull()
  })
})
