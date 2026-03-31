import { describe, expect, it } from 'vitest'

describe('import smoke', () => {
  it('imports core modules without circular init issues', async () => {
    const base = await import('../src/core/base.js')
    const utilsEnv = await import('../src/core/utils/env.js')
    const utilsKeys = await import('../src/core/utils/keys.js')
    const utilsNetwork = await import('../src/core/utils/network.js')
    const utilsHex = await import('../src/core/utils/hex.js')
    const providers = await import('../src/core/providers/index.js')
    const resolver = await import('../src/core/resolver.js')

    expect(base).toBeTruthy()
    expect(utilsEnv).toBeTruthy()
    expect(utilsKeys).toBeTruthy()
    expect(utilsNetwork).toBeTruthy()
    expect(utilsHex).toBeTruthy()
    expect(providers).toBeTruthy()
    expect(resolver).toBeTruthy()
  })
})
