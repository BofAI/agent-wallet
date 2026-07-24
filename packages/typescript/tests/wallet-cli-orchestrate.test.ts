import { describe, it, expect, vi } from 'vitest'
import { signAndBroadcast } from '../src/integrations/wallet-cli/orchestrate.js'
import type { Wallet } from '../src/core/base.js'
import type { WalletCliClient, WalletCliResult } from '../src/core/clients/wallet-cli.js'

function mockWallet(signedTxJson: string): Wallet {
  return {
    getAddress: vi.fn().mockResolvedValue('TTest123'),
    signTransaction: vi.fn().mockResolvedValue(signedTxJson),
  }
}

function mockClient(): WalletCliClient {
  return { run: vi.fn() } as unknown as WalletCliClient
}

const UNSIGNED_TX = { txID: 'abc', raw_data_hex: 'deadbeef' }
const SIGNED_TX_JSON = JSON.stringify({ txID: 'abc', raw_data_hex: 'deadbeef', signature: ['rsv'] })

function mockRunResult<T>(data: T, command = 'test'): WalletCliResult<T> {
  return { success: true, command, data }
}

describe('signAndBroadcast', () => {
  it('builds, signs, and broadcasts without wait', async () => {
    const wallet = mockWallet(SIGNED_TX_JSON)
    const client = mockClient()
    ;(client.run as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(mockRunResult({ kind: 'send', mode: 'dry-run', tx: UNSIGNED_TX, fee: {}, rawAmount: '1000000', to: 'T...' }))
      .mockResolvedValueOnce(mockRunResult({ kind: 'broadcast', stage: 'submitted', txId: 'tx123' }))

    const result = await signAndBroadcast(wallet, client, {
      to: 'T...',
      amount: '1',
      network: 'tron:nile',
    })

    expect(result.txId).toBe('tx123')
    expect(result.stage).toBe('submitted')
    expect(wallet.signTransaction).toHaveBeenCalledWith(UNSIGNED_TX)
    expect(client.run).toHaveBeenCalledTimes(2)
  })

  it('polls tx status when wait=true and returns confirmed', async () => {
    const wallet = mockWallet(SIGNED_TX_JSON)
    const client = mockClient()
    ;(client.run as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(mockRunResult({ kind: 'send', mode: 'dry-run', tx: UNSIGNED_TX, fee: {}, rawAmount: '1000000', to: 'T...' }))
      .mockResolvedValueOnce(mockRunResult({ kind: 'broadcast', stage: 'submitted', txId: 'tx456' }))
      .mockResolvedValueOnce(mockRunResult({ state: 'pending', confirmed: false, failed: false }))
      .mockResolvedValueOnce(mockRunResult({ state: 'confirmed', confirmed: true, failed: false, blockNumber: '12345' }))

    const result = await signAndBroadcast(wallet, client, {
      to: 'T...',
      amount: '1',
      network: 'tron:nile',
      wait: true,
      waitTimeoutMs: 10_000,
    })

    expect(result.stage).toBe('confirmed')
    expect(result.confirmed).toBe(true)
    expect(result.blockNumber).toBe('12345')
  })

  it('returns failed when tx status is failed', async () => {
    const wallet = mockWallet(SIGNED_TX_JSON)
    const client = mockClient()
    ;(client.run as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(mockRunResult({ kind: 'send', mode: 'dry-run', tx: UNSIGNED_TX, fee: {}, rawAmount: '1000000', to: 'T...' }))
      .mockResolvedValueOnce(mockRunResult({ kind: 'broadcast', stage: 'submitted', txId: 'tx789' }))
      .mockResolvedValueOnce(mockRunResult({ state: 'failed', confirmed: false, failed: true }))

    const result = await signAndBroadcast(wallet, client, {
      to: 'T...',
      amount: '1',
      network: 'tron:nile',
      wait: true,
      waitTimeoutMs: 10_000,
    })

    expect(result.stage).toBe('failed')
    expect(result.failed).toBe(true)
  })

  it('throws on mainnet without confirmMainnet', async () => {
    const wallet = mockWallet(SIGNED_TX_JSON)
    const client = mockClient()

    await expect(
      signAndBroadcast(wallet, client, {
        to: 'T...',
        amount: '1',
        network: 'tron:mainnet',
      }),
    ).rejects.toThrow('confirmMainnet')
  })

  it('allows mainnet with confirmMainnet=true', async () => {
    const wallet = mockWallet(SIGNED_TX_JSON)
    const client = mockClient()
    ;(client.run as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(mockRunResult({ kind: 'send', mode: 'dry-run', tx: UNSIGNED_TX, fee: {}, rawAmount: '1000000', to: 'T...' }))
      .mockResolvedValueOnce(mockRunResult({ kind: 'broadcast', stage: 'submitted', txId: 'txMain' }))

    const result = await signAndBroadcast(wallet, client, {
      to: 'T...',
      amount: '1',
      network: 'tron:mainnet',
      confirmMainnet: true,
    })

    expect(result.txId).toBe('txMain')
  })
})
