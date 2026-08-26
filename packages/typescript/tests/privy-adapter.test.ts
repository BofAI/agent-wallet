import { describe, expect, it } from 'vitest'

import { PrivyAdapter } from '../src/core/adapters/privy.js'

type RpcCall = { walletId: string; method: string; params: Record<string, unknown> }

class FakePrivyClient {
  calls: RpcCall[] = []
  walletCalls: string[] = []
  rawCalls: string[] = []
  private readonly chainType: string
  private readonly address: string
  private readonly rawSignature: string

  constructor(opts?: { chainType?: string; address?: string; rawSignature?: string }) {
    this.chainType = opts?.chainType ?? 'ethereum'
    this.address = opts?.address ?? '0xabc'
    this.rawSignature = opts?.rawSignature ?? '0xdead'
  }

  async getWallet(walletId: string) {
    this.walletCalls.push(walletId)
    return { address: this.address, chainType: this.chainType }
  }

  async rpc(
    walletId: string,
    method: string,
    params: Record<string, unknown>,
    _options?: { authorizationSignature?: string },
  ) {
    this.calls.push({ walletId, method, params })
    if (method === 'eth_signTransaction') {
      return { data: { signed_transaction: '0xsigned' } }
    }
    return { data: { signature: '0xsig' } }
  }

  async rawSign(
    walletId: string,
    _params?: Record<string, unknown>,
    _options?: { authorizationSignature?: string },
  ) {
    this.rawCalls.push(walletId)
    return { data: { signature: this.rawSignature } }
  }
}

describe('PrivyAdapter', () => {
  it('maps signTransaction to eth_signTransaction', async () => {
    const client = new FakePrivyClient()
    const adapter = new PrivyAdapter(
      {
        appId: 'app',
        appSecret: 'secret',
        walletId: 'wallet-1',
      },
      client,
    )

    const signed = await adapter.signTransaction({
      transaction: {
        to: '0x1',
        chain_id: 1,
        gas_limit: 21000,
        nonce: '0',
        max_fee_per_gas: 1000000000,
        max_priority_fee_per_gas: '1000000',
        value: 0,
      },
    })
    expect(signed).toEqual({ family: 'evm', rawTransaction: 'signed' })
    expect(client.calls[0].method).toBe('eth_signTransaction')
    expect(client.calls[0].params.transaction.chain_id).toBe('0x1')
    expect(client.calls[0].params.transaction.gas_limit).toBe('0x5208')
    expect(client.calls[0].params.transaction.max_fee_per_gas).toBe('0x3b9aca00')
    expect(client.calls[0].params.transaction.max_priority_fee_per_gas).toBe('0xf4240')
    expect(client.calls[0].params.transaction.value).toBe('0x0')
  })

  it('accepts viem-style transaction payloads', async () => {
    const client = new FakePrivyClient()
    const adapter = new PrivyAdapter(
      {
        appId: 'app',
        appSecret: 'secret',
        walletId: 'wallet-1',
      },
      client,
    )

    const signed = await adapter.signTransaction({
      to: '0x1',
      chainId: 1,
      gas: 21000,
      nonce: 0,
      maxFeePerGas: 1000000000,
      maxPriorityFeePerGas: 1000000,
      value: 0,
    })

    expect(signed).toEqual({ family: 'evm', rawTransaction: 'signed' })
    expect(client.calls[0].method).toBe('eth_signTransaction')
    expect(client.calls[0].params.transaction.chain_id).toBe('0x1')
    expect(client.calls[0].params.transaction.gas_limit).toBe('0x5208')
    expect(client.calls[0].params.transaction.max_fee_per_gas).toBe('0x3b9aca00')
    expect(client.calls[0].params.transaction.max_priority_fee_per_gas).toBe('0xf4240')
    expect(client.calls[0].params.transaction.value).toBe('0x0')
  })

  it('maps signTypedData to eth_signTypedData_v4', async () => {
    const client = new FakePrivyClient()
    const adapter = new PrivyAdapter(
      {
        appId: 'app',
        appSecret: 'secret',
        walletId: 'wallet-1',
      },
      client,
    )

    const signature = await adapter.signTypedData({
      domain: {},
      types: {},
      message: {},
      primaryType: 'Message',
    })
    expect(signature).toBe('sig')
    expect(client.calls[0].method).toBe('eth_signTypedData_v4')
    expect(client.calls[0].params.typed_data).toBeTruthy()
    expect(client.calls[0].params.typed_data.primary_type).toBe('Message')
  })

  it('caches getAddress', async () => {
    const client = new FakePrivyClient()
    const adapter = new PrivyAdapter(
      {
        appId: 'app',
        appSecret: 'secret',
        walletId: 'wallet-1',
      },
      client,
    )

    await adapter.getAddress()
    await adapter.getAddress()
    expect(client.walletCalls).toHaveLength(1)
  })

  it('rejects a Privy wallet whose chain family does not match the requested network', async () => {
    const client = new FakePrivyClient({ chainType: 'ethereum' })
    const adapter = new PrivyAdapter(
      {
        appId: 'app',
        appSecret: 'secret',
        walletId: 'wallet-1',
      },
      client,
      'tron:mainnet',
    )

    await expect(adapter.getAddress()).rejects.toThrow(
      "Privy wallet chain 'evm' does not match requested network family 'tron'",
    )
  })
})
