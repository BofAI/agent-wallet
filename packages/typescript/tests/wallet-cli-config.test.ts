import { describe, it, expect } from 'vitest'
import { WalletCliConfigResolver } from '../src/core/providers/wallet-cli-config.js'
import { WalletCliConfigError } from '../src/core/errors.js'
import { WalletConfigSchema } from '../src/core/config.js'

describe('WalletCliConfigResolver', () => {
  it('resolves with account and password', () => {
    const resolver = new WalletCliConfigResolver({
      source: { account: 'main-1', password: 'Abc12345!@' },
    })
    const config = resolver.resolve()
    expect(config.account).toBe('main-1')
    expect(config.password).toBe('Abc12345!@')
  })

  it('resolves with password only (account optional)', () => {
    const resolver = new WalletCliConfigResolver({
      source: { password: 'Abc12345!@' },
    })
    const config = resolver.resolve()
    expect(config.account).toBeUndefined()
    expect(config.password).toBe('Abc12345!@')
  })

  it('throws WalletCliConfigError when password missing', () => {
    const resolver = new WalletCliConfigResolver({
      source: { account: 'main-1' },
    })
    expect(() => resolver.resolve()).toThrow(WalletCliConfigError)
    expect(() => resolver.resolve()).toThrow('password')
  })

  it('throws when source is undefined', () => {
    const resolver = new WalletCliConfigResolver({})
    expect(() => resolver.resolve()).toThrow(WalletCliConfigError)
  })

  it('trims whitespace from values', () => {
    const resolver = new WalletCliConfigResolver({
      source: { account: '  main-1  ', password: '  Abc12345!@  ' },
    })
    const config = resolver.resolve()
    expect(config.account).toBe('main-1')
    expect(config.password).toBe('Abc12345!@')
  })

  it('treats empty string as missing', () => {
    const resolver = new WalletCliConfigResolver({
      source: { password: '   ' },
    })
    expect(() => resolver.resolve()).toThrow(WalletCliConfigError)
  })
})

describe('WalletConfigSchema — wallet_cli type', () => {
  it('validates a wallet_cli entry with account and password', () => {
    const config = WalletConfigSchema.parse({
      type: 'wallet_cli',
      params: { account: 'main-1', password: 'Abc12345!@' },
    })
    expect(config.type).toBe('wallet_cli')
  })

  it('validates a wallet_cli entry with password only', () => {
    const config = WalletConfigSchema.parse({
      type: 'wallet_cli',
      params: { password: 'Abc12345!@' },
    })
    expect(config.type).toBe('wallet_cli')
  })

  it('rejects wallet_cli without password', () => {
    expect(() =>
      WalletConfigSchema.parse({
        type: 'wallet_cli',
        params: { account: 'main-1' },
      }),
    ).toThrow()
  })

  it('rejects params mismatch (wallet_cli type with privy params)', () => {
    expect(() =>
      WalletConfigSchema.parse({
        type: 'wallet_cli',
        params: { app_id: 'x', app_secret: 'y', wallet_id: 'z' },
      }),
    ).toThrow()
  })
})
