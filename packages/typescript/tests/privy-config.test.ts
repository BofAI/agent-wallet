import { describe, expect, it } from 'vitest'

import { PrivyConfigError, PrivyConfigResolver } from '../src/core/providers/privy-config.js'

describe('PrivyConfigResolver', () => {
  it('resolves required config values from the selected source', () => {
    const resolver = new PrivyConfigResolver({
      source: {
        app_id: ' cfg-app ',
        app_secret: 'cfg-secret',
        wallet_id: 'cfg-wallet',
      },
    })

    const resolved = resolver.resolve()
    expect(resolved.appId).toBe('cfg-app')
    expect(resolved.appSecret).toBe('cfg-secret')
    expect(resolved.walletId).toBe('cfg-wallet')
  })

  it('reports missing required fields without leaking secrets', () => {
    const resolver = new PrivyConfigResolver({
      source: {
        app_id: 'cfg-app',
        app_secret: 'super-secret',
      },
    })

    expect(resolver.isEnabled()).toBe(false)
    try {
      resolver.resolve()
    } catch (err) {
      const error = err as PrivyConfigError
      expect(error.message).toMatch(/missing required/i)
      expect(error.message).toMatch(/wallet_id/i)
      expect(error.message).not.toContain('super-secret')
      return
    }
    throw new Error('Expected resolve() to throw PrivyConfigError')
  })
})
