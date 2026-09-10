import { describe, expect, it } from 'vitest'

import { Network } from '../src/core/base.js'
import {
  parseCanonicalNetwork,
  parseNetworkFamily,
  resolveNetwork,
} from '../src/core/utils/network.js'

describe('canonical network contract', () => {
  it.each([
    ['eip155:1', Network.EVM, '1'],
    ['eip155:11155111', Network.EVM, '11155111'],
    ['tron:728126428', Network.TRON, '728126428'],
    ['tron:3448148188', Network.TRON, '3448148188'],
  ])('accepts %s without rewriting it', (id, family, chainId) => {
    expect(parseCanonicalNetwork(id)).toEqual({ id, family, chainId })
    expect(parseNetworkFamily(id)).toBe(family)
  })

  it.each([
    undefined,
    '',
    'tron',
    'eip155',
    'tron:mainnet',
    'tron:nile',
    'evm:1',
    'ethereum',
    'TRON:728126428',
    ' tron:728126428',
    'tron:728126428 ',
    'tron:0',
    'eip155:01',
    'eip155:-1',
    `eip155:${'1'.repeat(33)}`,
  ])('rejects non-canonical value %s', (network) => {
    expect(() => parseCanonicalNetwork(network)).toThrow(/canonical CAIP-2/)
  })

  it('validates explicit and provider-default networks without normalization', () => {
    expect(resolveNetwork('eip155:1', 'tron:728126428')).toBe('eip155:1')
    expect(resolveNetwork(undefined, 'tron:728126428')).toBe('tron:728126428')
    expect(resolveNetwork(undefined, undefined)).toBeUndefined()
    expect(() => resolveNetwork('tron:mainnet', undefined)).toThrow(/canonical CAIP-2/)
  })
})
