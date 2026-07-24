import { describe, it, expect } from 'vitest'
import { WalletCliConfigResolver } from '../src/core/providers/wallet-cli-config.js'
import { WalletCliConfigError } from '../src/core/errors.js'
import { WalletConfigSchema } from '../src/core/config.js'

describe('WalletCliConfigResolver', () => {
  it('resolves with account and password', async () => {
    const resolver = new WalletCliConfigResolver({
      source: { account: 'main-1', password: 'Abc12345!@' },
    })
    const config = await resolver.resolve()
    expect(config.account).toBe('main-1')
    expect(config.password).toBe('Abc12345!@')
  })

  it('resolves with password only (account optional)', async () => {
    const resolver = new WalletCliConfigResolver({
      source: { password: 'Abc12345!@' },
    })
    const config = await resolver.resolve()
    expect(config.account).toBeUndefined()
    expect(config.password).toBe('Abc12345!@')
  })

  it('throws WalletCliConfigError when password missing', async () => {
    const resolver = new WalletCliConfigResolver({
      source: { account: 'main-1' },
    })
    await expect(resolver.resolve()).rejects.toThrow(WalletCliConfigError)
    await expect(resolver.resolve()).rejects.toThrow('password')
  })

  it('throws when source is undefined', async () => {
    const resolver = new WalletCliConfigResolver({})
    await expect(resolver.resolve()).rejects.toThrow(WalletCliConfigError)
  })

  it('trims whitespace from values', async () => {
    const resolver = new WalletCliConfigResolver({
      source: { account: '  main-1  ', password: '  Abc12345!@  ' },
    })
    const config = await resolver.resolve()
    expect(config.account).toBe('main-1')
    expect(config.password).toBe('Abc12345!@')
  })

  it('treats empty string as missing', async () => {
    const resolver = new WalletCliConfigResolver({
      source: { password: '   ' },
    })
    await expect(resolver.resolve()).rejects.toThrow(WalletCliConfigError)
  })
})

describe('WalletConfigSchema — wallet_cli type', () => {
  it('validates a wallet_cli entry with account and password', async () => {
    const config = WalletConfigSchema.parse({
      type: 'wallet_cli',
      params: { account: 'main-1', password: 'Abc12345!@' },
    })
    expect(config.type).toBe('wallet_cli')
  })

  it('validates a wallet_cli entry with password only', async () => {
    const config = WalletConfigSchema.parse({
      type: 'wallet_cli',
      params: { password: 'Abc12345!@' },
    })
    expect(config.type).toBe('wallet_cli')
  })

  it('rejects wallet_cli without password', async () => {
    expect(() =>
      WalletConfigSchema.parse({
        type: 'wallet_cli',
        params: { account: 'main-1' },
      }),
    ).toThrow()
  })

  it('rejects params mismatch (wallet_cli type with privy params)', async () => {
    expect(() =>
      WalletConfigSchema.parse({
        type: 'wallet_cli',
        params: { app_id: 'x', app_secret: 'y', wallet_id: 'z' },
      }),
    ).toThrow()
  })
})
