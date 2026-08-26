import { describe, expect, it, vi } from 'vitest'

import type { WalletCliClient, WalletCliRunContract } from '../src/core/clients/wallet-cli.js'
import {
  broadcast,
  buildTransfer,
  getBalance,
  getTxInfo,
  getTxStatus,
} from '../src/integrations/wallet-cli/chain-ops.js'

const NETWORK = { id: 'tron:nile', family: 'tron', chainId: 'nile' }

function client() {
  const ensureCompatible = vi.fn().mockResolvedValue({
    version: '4.13.0',
    catalog: { tool: 'wallet-cli', version: '4.13.0', globalFlags: [], commands: [] },
    networks: [NETWORK],
    network: NETWORK,
  })
  const run = vi.fn().mockImplementation((_args, contract: WalletCliRunContract<unknown>) =>
    Promise.resolve({
      schema: 'wallet-cli.result.v1',
      success: true,
      command: contract.command,
      data: {},
      chain: { family: 'tron', network: 'tron:nile', chainId: 'nile' },
      meta: { durationMs: 1, warnings: [] },
    }),
  )
  return {
    value: { ensureCompatible, run } as unknown as WalletCliClient,
    ensureCompatible,
    run,
  }
}

describe('wallet-cli TRON-only chain operations', () => {
  it('builds decimal-string transfers with an explicit command/context validator', async () => {
    const mock = client()
    await buildTransfer(mock.value, {
      to: 'TRecipient',
      amount: '1.25',
      rawAmount: '1250000',
      token: 'USDT',
      contract: 'TContract',
      assetId: '1002000',
      network: 'tron:nile',
    })

    expect(mock.run).toHaveBeenCalledWith(
      [
        'tx',
        'send',
        '--to',
        'TRecipient',
        '--network',
        'tron:nile',
        '--dry-run',
        '-o',
        'json',
        '--amount',
        '1.25',
        '--raw-amount',
        '1250000',
        '--token',
        'USDT',
        '--contract',
        'TContract',
        '--asset-id',
        '1002000',
      ],
      expect.objectContaining({ command: 'tx.send', chain: NETWORK }),
    )
    const contract = mock.run.mock.calls[0][1] as WalletCliRunContract<unknown>
    expect(contract.dataSchema.safeParse({}).success).toBe(false)
    expect(mock.run.mock.calls[0][0]).not.toContain('--password-stdin')
  })

  it('broadcasts the signed artifact only through stdin', async () => {
    const mock = client()
    const signed = JSON.stringify({ txID: 'abc', signature: ['rsv'] })
    await broadcast(mock.value, signed, 'tron:nile')

    expect(mock.run).toHaveBeenCalledWith(
      ['tx', 'broadcast', '--tx-stdin', '--network', 'tron:nile', '-o', 'json'],
      expect.objectContaining({ command: 'tx.broadcast', chain: NETWORK, stdin: signed }),
    )
    expect(mock.run.mock.calls[0][0]).not.toContain(signed)
  })

  it('uses strict schemas for all four transaction status states', async () => {
    const mock = client()
    await getTxStatus(mock.value, 'abc', 'tron:nile')
    const contract = mock.run.mock.calls[0][1] as WalletCliRunContract<unknown>

    for (const state of ['confirmed', 'failed', 'pending', 'not_found']) {
      expect(
        contract.dataSchema.safeParse({ state, confirmed: false, failed: false }).success,
      ).toBe(true)
    }
    expect(
      contract.dataSchema.safeParse({ state: 'unknown', confirmed: false, failed: false }).success,
    ).toBe(false)
    expect(
      contract.dataSchema.parse({
        state: 'confirmed',
        confirmed: true,
        failed: false,
        blockNumber: 123,
      }),
    ).toMatchObject({ blockNumber: '123' })
  })

  it('provides command/context validators for balance and transaction info', async () => {
    const mock = client()
    await getBalance(mock.value, 'tron:nile', 'fixture')
    await getTxInfo(mock.value, 'abc', 'tron:nile')

    expect(mock.run).toHaveBeenNthCalledWith(
      1,
      ['account', 'balance', '--network', 'tron:nile', '-o', 'json', '--account', 'fixture'],
      expect.objectContaining({ command: 'account.balance', chain: NETWORK }),
    )
    expect(mock.run).toHaveBeenNthCalledWith(
      2,
      ['tx', 'info', '--txid', 'abc', '--network', 'tron:nile', '-o', 'json'],
      expect.objectContaining({ command: 'tx.info', chain: NETWORK }),
    )
    const balanceContract = mock.run.mock.calls[0][1] as WalletCliRunContract<unknown>
    expect(balanceContract.dataSchema.safeParse({}).success).toBe(false)
  })

  it.each([
    ['build', (value: WalletCliClient) => buildTransfer(value, { to: '0x1', network: 'eip155:1' })],
    ['broadcast', (value: WalletCliClient) => broadcast(value, '{}', 'eip155:1')],
    ['status', (value: WalletCliClient) => getTxStatus(value, 'abc', 'eip155:1')],
    ['balance', (value: WalletCliClient) => getBalance(value, 'eip155:1')],
    ['info', (value: WalletCliClient) => getTxInfo(value, 'abc', 'eip155:1')],
  ])('rejects EVM %s before any wallet-cli process call', async (_name, operation) => {
    const mock = client()
    await expect(operation(mock.value)).rejects.toThrow(/TRON-only/)
    expect(mock.ensureCompatible).not.toHaveBeenCalled()
    expect(mock.run).not.toHaveBeenCalled()
  })
})
