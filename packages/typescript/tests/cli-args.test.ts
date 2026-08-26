import { describe, expect, it } from 'vitest'

import { parseArgs } from '../src/delivery/cli-args.js'

describe('parseArgs', () => {
  it('separates a sign subcommand payload from long and short options', () => {
    expect(
      parseArgs(['sign', 'tx', '{"chainId":1}', '--network=eip155:1', '-w', 'wallet-1']),
    ).toEqual({
      command: 'sign',
      subcommand: 'tx',
      args: ['{"chainId":1}'],
      options: { network: 'eip155:1', w: 'wallet-1' },
    })
  })

  it('parses boolean flags without coupling to command execution', () => {
    expect(parseArgs(['remove', 'wallet-1', '--yes'])).toEqual({
      command: 'remove',
      subcommand: 'wallet-1',
      args: ['wallet-1'],
      options: { yes: true },
    })
  })
})
