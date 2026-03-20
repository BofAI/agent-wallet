import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  LocalSecureWalletConfigSchema,
  RawSecretMnemonicConfigSchema,
  RawSecretPrivateKeyConfigSchema,
  RawSecretWalletConfigSchema,
  WalletConfigSchema,
  WalletsTopologySchema,
  loadConfig,
  loadRuntimeSecretsPassword,
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
  it('accepts local_secure wallet config', () => {
    const parsed = LocalSecureWalletConfigSchema.parse({
      type: 'local_secure',
      secret_ref: 'wallet-a',
    })
    expect(parsed.secret_ref).toBe('wallet-a')
  })

  it('accepts raw_secret private key config', () => {
    const parsed = RawSecretWalletConfigSchema.parse({
      type: 'raw_secret',
      material: {
        source: 'private_key',
        private_key: '0xabc',
      },
    })
    expect(parsed.material.source).toBe('private_key')
  })

  it('accepts raw_secret mnemonic config', () => {
    const parsed = RawSecretWalletConfigSchema.parse({
      type: 'raw_secret',
      material: {
        source: 'mnemonic',
        mnemonic: 'test test test test test test test test test test test junk',
      },
    })
    expect(parsed.material.source).toBe('mnemonic')
    if (parsed.material.source === 'mnemonic') {
      expect(parsed.material.account_index).toBe(0)
    }
  })

  it('rejects invalid wallet type', () => {
    expect(() =>
      WalletConfigSchema.parse({
        type: 'legacy_local',
        secret_ref: 'old',
      }),
    ).toThrow()
  })

  it('rejects invalid raw_secret material type', () => {
    expect(() =>
      RawSecretWalletConfigSchema.parse({
        type: 'raw_secret',
        material: {
          source: 'api_key',
          value: 'secret',
        },
      }),
    ).toThrow()
  })
})

describe('loadConfig / saveConfig', () => {
  it('roundtrips config', () => {
    const config: WalletsTopology = {
      active_wallet: 'wallet-a',
      wallets: {
        'wallet-a': {
          type: 'local_secure',
          secret_ref: 'wallet-a',
        },
        hot: {
          type: 'raw_secret',
          material: {
            source: 'private_key',
            private_key: '0x1234',
          },
        },
      },
    }

    saveConfig(secretsDir, config)
    const loaded = loadConfig(secretsDir)

    expect(loaded.active_wallet).toBe('wallet-a')
    expect(loaded.wallets['wallet-a'].type).toBe('local_secure')
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
          material: {
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
    expect(raw.wallets.seed.material.account_index).toBe(1)
    expect(raw.wallets.seed.material.mnemonic).toBeTypeOf('string')
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

describe('runtime secrets', () => {
  it('loads password from runtime_secrets.json', () => {
    writeFileSync(
      join(secretsDir, 'runtime_secrets.json'),
      JSON.stringify({ password: '  secret-pass  ' }),
      'utf-8',
    )
    expect(loadRuntimeSecretsPassword(secretsDir)).toBe('secret-pass')
  })

  it('returns null when runtime_secrets.json is missing', () => {
    expect(loadRuntimeSecretsPassword(secretsDir)).toBeNull()
  })

  it('throws on invalid runtime secrets object shape', () => {
    writeFileSync(join(secretsDir, 'runtime_secrets.json'), JSON.stringify(['bad']), 'utf-8')
    expect(() => loadRuntimeSecretsPassword(secretsDir)).toThrow(/JSON object/)
  })

  it('throws on invalid runtime secrets JSON', () => {
    writeFileSync(join(secretsDir, 'runtime_secrets.json'), '{bad json', 'utf-8')
    expect(() => loadRuntimeSecretsPassword(secretsDir)).toThrow(/Invalid JSON in runtime_secrets\.json/)
  })

  it('throws on non-string password', () => {
    writeFileSync(join(secretsDir, 'runtime_secrets.json'), JSON.stringify({ password: 123 }), 'utf-8')
    expect(() => loadRuntimeSecretsPassword(secretsDir)).toThrow(/password must be a string/)
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
