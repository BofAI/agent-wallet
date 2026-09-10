import { describe, it, expect, vi } from 'vitest'
import { signAndBroadcast } from '../src/integrations/wallet-cli/orchestrate.js'
import type { Wallet } from '../src/core/base.js'
import type { WalletCliClient, WalletCliResult } from '../src/core/clients/wallet-cli.js'
import { WalletCliExecutionError } from '../src/core/errors.js'

const SOURCE_ADDRESS = 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH'
const SOURCE_HEX = '41c8599111f29c1e1e061265b4af93ea1f274ad78a'

function mockWallet(signedTxJson: string): Wallet {
  return {
    getAddress: vi.fn().mockResolvedValue(SOURCE_ADDRESS),
    signTransaction: vi.fn().mockResolvedValue({
      family: 'tron',
      transaction: JSON.parse(signedTxJson) as Record<string, unknown>,
    }),
  }
}

function mockClient(): WalletCliClient {
  return {
    ensureCompatible: vi.fn(
      async (target: { family: string; cliNetwork: string; requestedChainId?: string }) => ({
        version: '4.13.0',
        catalog: { tool: 'wallet-cli', version: '4.13.0', globalFlags: [], commands: [] },
        networks: [],
        network: {
          id: target.cliNetwork,
          family: target.family,
          chainId: target.requestedChainId ?? target.cliNetwork.split(':')[1],
        },
      }),
    ),
    run: vi.fn(),
  } as unknown as WalletCliClient
}

const UNSIGNED_TX = {
  txID: 'abc',
  raw_data_hex: 'deadbeef',
  raw_data: {
    contract: [{ parameter: { value: { owner_address: SOURCE_HEX } } }],
  },
}
const SIGNED_TX_JSON = JSON.stringify({ ...UNSIGNED_TX, signature: ['rsv'] })

function mockRunResult<T>(data: T, command = 'test'): WalletCliResult<T> {
  return { success: true, command, data }
}

describe('signAndBroadcast', () => {
  it('builds, signs, and broadcasts without wait', async () => {
    const wallet = mockWallet(SIGNED_TX_JSON)
    const client = mockClient()
    ;(client.run as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        mockRunResult({
          kind: 'send',
          mode: 'dry-run',
          tx: UNSIGNED_TX,
          fee: {},
          rawAmount: '1000000',
          to: 'T...',
        }),
      )
      .mockResolvedValueOnce(
        mockRunResult({ kind: 'broadcast', stage: 'submitted', txId: 'tx123' }),
      )

    const result = await signAndBroadcast(wallet, client, {
      to: 'T...',
      amount: '1',
      network: 'tron:3448148188',
    })

    expect(result.txId).toBe('tx123')
    expect(result.stage).toBe('submitted')
    expect(wallet.signTransaction).toHaveBeenCalledWith(UNSIGNED_TX)
    expect(client.run).toHaveBeenNthCalledWith(
      1,
      expect.arrayContaining(['--account', SOURCE_ADDRESS]),
      expect.any(Object),
    )
    expect(client.run).toHaveBeenCalledTimes(2)
  })

  it('polls tx status when wait=true and returns confirmed', async () => {
    const wallet = mockWallet(SIGNED_TX_JSON)
    const client = mockClient()
    ;(client.run as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        mockRunResult({
          kind: 'send',
          mode: 'dry-run',
          tx: UNSIGNED_TX,
          fee: {},
          rawAmount: '1000000',
          to: 'T...',
        }),
      )
      .mockResolvedValueOnce(
        mockRunResult({ kind: 'broadcast', stage: 'submitted', txId: 'tx456' }),
      )
      .mockResolvedValueOnce(mockRunResult({ state: 'pending', confirmed: false, failed: false }))
      .mockResolvedValueOnce(
        mockRunResult({ state: 'confirmed', confirmed: true, failed: false, blockNumber: '12345' }),
      )

    const result = await signAndBroadcast(wallet, client, {
      to: 'T...',
      amount: '1',
      network: 'tron:3448148188',
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
      .mockResolvedValueOnce(
        mockRunResult({
          kind: 'send',
          mode: 'dry-run',
          tx: UNSIGNED_TX,
          fee: {},
          rawAmount: '1000000',
          to: 'T...',
        }),
      )
      .mockResolvedValueOnce(
        mockRunResult({ kind: 'broadcast', stage: 'submitted', txId: 'tx789' }),
      )
      .mockResolvedValueOnce(mockRunResult({ state: 'failed', confirmed: false, failed: true }))

    const result = await signAndBroadcast(wallet, client, {
      to: 'T...',
      amount: '1',
      network: 'tron:3448148188',
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
        network: 'tron:728126428',
      }),
    ).rejects.toThrow('confirmMainnet')
  })

  it('allows mainnet with confirmMainnet=true', async () => {
    const wallet = mockWallet(SIGNED_TX_JSON)
    const client = mockClient()
    ;(client.run as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        mockRunResult({
          kind: 'send',
          mode: 'dry-run',
          tx: UNSIGNED_TX,
          fee: {},
          rawAmount: '1000000',
          to: 'T...',
        }),
      )
      .mockResolvedValueOnce(
        mockRunResult({ kind: 'broadcast', stage: 'submitted', txId: 'txMain' }),
      )

    const result = await signAndBroadcast(wallet, client, {
      to: 'T...',
      amount: '1',
      network: 'tron:728126428',
      confirmMainnet: true,
    })

    expect(result.txId).toBe('txMain')
  })

  it('returns timeout with the signed tx id when broadcast may still be in flight', async () => {
    const wallet = mockWallet(SIGNED_TX_JSON)
    const client = mockClient()
    ;(client.run as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        mockRunResult({
          kind: 'send',
          mode: 'dry-run',
          tx: UNSIGNED_TX,
          fee: {},
          rawAmount: '1000000',
          to: 'T...',
        }),
      )
      .mockRejectedValueOnce(new WalletCliExecutionError('timed out', 'timeout'))

    await expect(
      signAndBroadcast(wallet, client, {
        to: 'T...',
        amount: '1',
        network: 'tron:3448148188',
      }),
    ).resolves.toEqual({ txId: 'abc', stage: 'timeout' })
  })

  it.each([1, 2])(
    'preserves txId when status query %i fails after one broadcast',
    async (failedAttempt) => {
      const wallet = mockWallet(SIGNED_TX_JSON)
      const client = mockClient()
      const run = client.run as ReturnType<typeof vi.fn>
      run
        .mockResolvedValueOnce(
          mockRunResult({
            kind: 'send',
            mode: 'dry-run',
            tx: UNSIGNED_TX,
            fee: {},
            rawAmount: '1000000',
            to: 'T...',
          }),
        )
        .mockResolvedValueOnce(
          mockRunResult({ kind: 'broadcast', stage: 'submitted', txId: 'known-tx-id' }),
        )
      if (failedAttempt === 2) {
        run.mockResolvedValueOnce(
          mockRunResult({ state: 'pending', confirmed: false, failed: false }),
        )
      }
      run.mockRejectedValueOnce(new WalletCliExecutionError('status unavailable', 'timeout'))

      await expect(
        signAndBroadcast(wallet, client, {
          to: 'T...',
          amount: '1',
          network: 'tron:3448148188',
          wait: true,
          waitTimeoutMs: 10_000,
        }),
      ).rejects.toMatchObject({ txId: 'known-tx-id', code: 'timeout' })

      const broadcastCalls = run.mock.calls.filter(
        ([args]) => Array.isArray(args) && args[0] === 'tx' && args[1] === 'broadcast',
      )
      expect(broadcastCalls).toHaveLength(1)
    },
  )
})
