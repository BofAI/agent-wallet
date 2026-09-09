import { describe, expect, it, vi } from 'vitest'
import { hashTypedData } from 'viem'

import { WalletCliAdapter } from '../src/core/adapters/wallet-cli.js'
import type { WalletCliClient } from '../src/core/clients/wallet-cli.js'
import type { SecretLease, SecretProvider } from '../src/core/secret-provider.js'

const TRON_ADDRESS = 'TMSgJxtPw29AFEHMXsjGo4kWV7UwbCToHJ'
const EVM_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const CONFIG = { account: 'fixture', password: { exec: '/unused/in-unit-test' } }

function success<T>(command: string, data: T) {
  return {
    schema: 'wallet-cli.result.v1' as const,
    success: true as const,
    command,
    data,
    meta: { durationMs: 1, warnings: [] },
  }
}

function mockClient(): WalletCliClient {
  return {
    ensureCompatible: vi.fn().mockResolvedValue({
      version: '4.13.0',
      catalog: { tool: 'wallet-cli', version: '4.13.0', globalFlags: [], commands: [] },
      networks: [],
      network: { id: 'tron:3448148188', family: 'tron', chainId: '3448148188' },
    }),
    currentAccount: vi.fn().mockResolvedValue(
      success('current', {
        accountId: 'wlt_fixture.0',
        label: 'fixture',
        type: 'seed',
        index: 0,
        active: true,
        addresses: { tron: TRON_ADDRESS, evm: EVM_ADDRESS },
      }),
    ),
    signTronTransaction: vi.fn().mockResolvedValue(
      success('tx.sign', {
        kind: 'sign',
        mode: 'sign-only',
        address: TRON_ADDRESS,
        txId: 'abc',
        signed: { txID: 'abc', raw_data_hex: 'deadbeef', signature: ['fixture'] },
      }),
    ),
    signTypedData: vi
      .fn()
      .mockImplementation((_json, _lease, _identity, target: { family: string }) =>
        Promise.resolve(
          success('typed-data.sign', {
            address: target.family === 'evm' ? EVM_ADDRESS : TRON_ADDRESS,
            primaryType: 'Message',
            digest: `0x${'22'.repeat(32)}`,
            signature: `0x${'33'.repeat(65)}`,
          }),
        ),
      ),
  } as unknown as WalletCliClient
}

function trackingProvider() {
  const leases: Array<{ lease: SecretLease; dispose: ReturnType<typeof vi.fn> }> = []
  const acquire = vi.fn(async () => {
    const dispose = vi.fn().mockResolvedValue(undefined)
    const lease: SecretLease = { writeTo: vi.fn().mockResolvedValue(undefined), dispose }
    leases.push({ lease, dispose })
    return lease
  })
  return { provider: { acquire } as SecretProvider, acquire, leases }
}

describe('WalletCliAdapter', () => {
  it.each([
    undefined,
    '',
    'tron',
    'eip155',
    'bsc',
    'evm:1',
    'tron:nile',
    'tron:mainnet',
    'TRON:728126428',
    ' tron:728126428',
    'eip155:0',
    'eip155:01',
  ])('rejects incomplete or non-canonical network %s synchronously', (network) => {
    expect(
      () =>
        new WalletCliAdapter(CONFIG, mockClient(), trackingProvider().provider, network as string),
    ).toThrow(/network|chainId|aliases/i)
  })

  it('shares one in-flight identity lookup and pins both family addresses', async () => {
    const client = mockClient()
    const adapter = new WalletCliAdapter(
      CONFIG,
      client,
      trackingProvider().provider,
      'tron:3448148188',
    )
    await expect(Promise.all([adapter.getAddress(), adapter.getAddress()])).resolves.toEqual([
      TRON_ADDRESS,
      TRON_ADDRESS,
    ])
    expect(client.currentAccount).toHaveBeenCalledTimes(1)
    expect(client.currentAccount).toHaveBeenCalledWith('fixture', {
      agentNetwork: 'tron:3448148188',
      cliNetwork: 'tron:3448148188',
      family: 'tron',
      requestedChainId: '3448148188',
    })
  })

  it('allows a later identity attempt after the first lookup fails', async () => {
    const client = mockClient()
    ;(client.currentAccount as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(
        success('current', {
          accountId: 'wlt_fixture.0',
          type: 'seed',
          index: 0,
          active: true,
          addresses: { tron: TRON_ADDRESS },
        }),
      )
    const adapter = new WalletCliAdapter(
      CONFIG,
      client,
      trackingProvider().provider,
      'tron:3448148188',
    )
    await expect(adapter.getAddress()).rejects.toThrow('temporary failure')
    await expect(adapter.getAddress()).resolves.toBe(TRON_ADDRESS)
    expect(client.currentAccount).toHaveBeenCalledTimes(2)
  })

  it('passes canonical account/network, acquires one lease and disposes it after TRON signing', async () => {
    const client = mockClient()
    const secret = trackingProvider()
    const adapter = new WalletCliAdapter(CONFIG, client, secret.provider, 'tron:3448148188')
    const signed = await adapter.signTransaction({ txID: 'abc', raw_data_hex: 'deadbeef' })

    expect(signed).toMatchObject({
      family: 'tron',
      transaction: { signature: ['fixture'] },
    })
    expect(secret.acquire).toHaveBeenCalledWith({
      label: 'wallet-cli password',
      accountId: 'wlt_fixture.0',
      network: 'tron:3448148188',
    })
    expect(client.signTronTransaction).toHaveBeenCalledWith(
      JSON.stringify({ txID: 'abc', raw_data_hex: 'deadbeef' }),
      secret.leases[0].lease,
      expect.objectContaining({ accountId: 'wlt_fixture.0' }),
      expect.objectContaining({ cliNetwork: 'tron:3448148188' }),
      undefined,
    )
    expect(secret.leases[0].dispose).toHaveBeenCalledTimes(1)
  })

  it('rejects signer mismatch and still disposes the lease', async () => {
    const client = mockClient()
    ;(client.signTronTransaction as ReturnType<typeof vi.fn>).mockResolvedValue(
      success('tx.sign', {
        kind: 'sign',
        mode: 'sign-only',
        address: 'TWrongSigner',
        signed: { signature: ['fixture'] },
      }),
    )
    const secret = trackingProvider()
    const adapter = new WalletCliAdapter(CONFIG, client, secret.provider, 'tron:3448148188')
    await expect(adapter.signTransaction({ txID: 'abc' })).rejects.toMatchObject({
      code: 'contract_mismatch',
    })
    expect(secret.leases[0].dispose).toHaveBeenCalledTimes(1)
  })

  it('rejects EVM typed-data chain mismatch before identity or secret access', async () => {
    const client = mockClient()
    const secret = trackingProvider()
    const evm = new WalletCliAdapter(CONFIG, client, secret.provider, 'eip155:1')
    await expect(
      evm.signTypedData({ domain: { chainId: 56 }, types: {}, message: {} }),
    ).rejects.toThrow('does not match')
    expect(client.currentAccount).not.toHaveBeenCalled()
    expect(secret.acquire).not.toHaveBeenCalled()
  })

  it.each([
    { type: 'eip4844' },
    { type: 'eip7702' },
    { blobVersionedHashes: [] },
    { authorizationList: [] },
  ])(
    'rejects unsupported EVM transaction fields before identity or secret access',
    async (extra) => {
      const client = mockClient()
      const secret = trackingProvider()
      const adapter = new WalletCliAdapter(CONFIG, client, secret.provider, 'eip155:1')

      await expect(adapter.signTransaction({ chainId: 1, ...extra })).rejects.toThrow(
        'EIP-4844/EIP-7702',
      )
      expect(client.currentAccount).not.toHaveBeenCalled()
      expect(secret.acquire).not.toHaveBeenCalled()
    },
  )

  it('forwards cancellation and disposes the lease after an aborted signing operation', async () => {
    const client = mockClient()
    const controller = new AbortController()
    controller.abort()
    ;(client.signTronTransaction as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error('aborted'), { code: 'aborted' }),
    )
    const secret = trackingProvider()
    const adapter = new WalletCliAdapter(CONFIG, client, secret.provider, 'tron:3448148188')

    await expect(
      adapter.signTransaction({ txID: 'abc' }, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'aborted' })
    expect(client.signTronTransaction).toHaveBeenCalledWith(
      expect.any(String),
      secret.leases[0].lease,
      expect.any(Object),
      expect.any(Object),
      controller.signal,
    )
    expect(secret.leases[0].dispose).toHaveBeenCalledTimes(1)
  })

  it.each([undefined, '1'])(
    'passes an x402 PaymentPermit typed-data payload with domain version %s unchanged',
    async (version) => {
      const client = mockClient()
      const secret = trackingProvider()
      const adapter = new WalletCliAdapter(CONFIG, client, secret.provider, 'eip155:1')
      const typedData = {
        types: {
          EIP712Domain: [
            { name: 'name', type: 'string' },
            ...(version === undefined ? [] : [{ name: 'version', type: 'string' }]),
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' },
          ],
          PaymentPermitDetails: [
            { name: 'buyer', type: 'address' },
            { name: 'amount', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
          ],
        },
        primaryType: 'PaymentPermitDetails',
        domain: {
          name: 'x402PaymentPermit',
          ...(version === undefined ? {} : { version }),
          chainId: 1,
          verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
        },
        message: {
          buyer: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          amount: 1_000_000,
          nonce: 0,
        },
      }

      await expect(adapter.signTypedData(typedData)).resolves.toBe('33'.repeat(65))
      expect(client.signTypedData).toHaveBeenCalledWith(
        JSON.stringify(typedData),
        secret.leases[0].lease,
        expect.objectContaining({ accountId: 'wlt_fixture.0' }),
        expect.objectContaining({ cliNetwork: 'eip155:1' }),
        undefined,
      )
    },
  )

  it('serializes nested typed-data bigint values as digest-equivalent decimal strings', async () => {
    const client = mockClient()
    const secret = trackingProvider()
    const adapter = new WalletCliAdapter(CONFIG, client, secret.provider, 'eip155:1')
    const typedData = {
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'chainId', type: 'uint256' },
        ],
        Payment: [
          { name: 'recipient', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ],
        Batch: [
          { name: 'payments', type: 'Payment[]' },
          { name: 'nonce', type: 'uint256' },
        ],
      },
      primaryType: 'Batch',
      domain: { name: 'BigInt fixture', chainId: 1n },
      message: {
        payments: [
          {
            recipient: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
            amount: 1_000_000_000_000_000_000n,
          },
        ],
        nonce: 2n ** 256n - 1n,
      },
    }

    await adapter.signTypedData(typedData)
    const serialized = vi.mocked(client.signTypedData).mock.calls[0][0]
    const parsed = JSON.parse(serialized)

    expect(parsed.domain.chainId).toBe('1')
    expect(parsed.message.payments[0].amount).toBe('1000000000000000000')
    expect(parsed.message.nonce).toBe((2n ** 256n - 1n).toString())
    expect(hashTypedData(parsed)).toBe(hashTypedData(typedData))
  })

  it('still rejects cyclic typed-data payloads', async () => {
    const client = mockClient()
    const adapter = new WalletCliAdapter(CONFIG, client, trackingProvider().provider, 'eip155:1')
    const typedData: Record<string, unknown> = {
      domain: { chainId: 1 },
      types: {},
      message: {},
    }
    typedData.self = typedData

    await expect(adapter.signTypedData(typedData)).rejects.toThrow('not JSON serializable')
  })
})
