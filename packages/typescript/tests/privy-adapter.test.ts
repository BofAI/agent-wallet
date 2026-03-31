import { describe, expect, it } from 'vitest'

import { PrivyAdapter } from '../src/core/adapters/privy.js'
import { UnsupportedOperationError } from '../src/core/errors.js'
import { keccak256 } from 'viem'
import { secp256k1 } from '@noble/curves/secp256k1'
import bs58checkModule from 'bs58check'

type RpcCall = { walletId: string; method: string; params: Record<string, unknown> }

type Bs58checkLike = {
  encode?: (input: Uint8Array) => string
  default?: typeof bs58checkModule
}

const bs58checkInterop = bs58checkModule as Bs58checkLike
const bs58check: typeof bs58checkModule =
  typeof bs58checkInterop.encode === 'function'
    ? bs58checkModule
    : (bs58checkInterop.default ?? bs58checkModule)

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
  it('maps signMessage to personal_sign', async () => {
    const client = new FakePrivyClient()
    const adapter = new PrivyAdapter(
      {
        appId: 'app',
        appSecret: 'secret',
        walletId: 'wallet-1',
      },
      client,
    )

    const signature = await adapter.signMessage(Uint8Array.from([1, 2, 3]))
    expect(signature).toBe('sig')
    expect(client.calls[0].method).toBe('personal_sign')
    expect(client.calls[0].params.encoding).toBe('hex')
    expect(client.calls[0].params.message).toBe('0x010203')
  })

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
    expect(signed).toBe('signed')
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

    expect(signed).toBe('signed')
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

  it('throws for signRaw on non-tron wallets', async () => {
    const client = new FakePrivyClient({ chainType: 'ethereum' })
    const adapter = new PrivyAdapter(
      {
        appId: 'app',
        appSecret: 'secret',
        walletId: 'wallet-1',
      },
      client,
    )

    await expect(adapter.signRaw(Uint8Array.from([1]))).rejects.toBeInstanceOf(
      UnsupportedOperationError,
    )
  })

  it('routes TRON signing through raw_sign and appends v', async () => {
    const privateKey = Uint8Array.from(Buffer.alloc(32, 1))
    const pubkey = secp256k1.getPublicKey(privateKey, false)
    const hash = keccak256(Uint8Array.from([1, 2, 3]))
    const hashBytes = Buffer.from(hash.slice(2), 'hex')
    const sig = secp256k1.sign(hashBytes, privateKey)
    const r = sig.r.toString(16).padStart(64, '0')
    const s = sig.s.toString(16).padStart(64, '0')
    const rawSignature = `0x${r}${s}`
    const v = sig.recovery + 27

    const tronAddress = toTronAddress(pubkey)
    const client = new FakePrivyClient({
      chainType: 'tron',
      address: tronAddress,
      rawSignature,
    })
    const adapter = new PrivyAdapter(
      {
        appId: 'app',
        appSecret: 'secret',
        walletId: 'wallet-1',
      },
      client,
    )

    const signature = await adapter.signMessage(Uint8Array.from([1, 2, 3]))
    expect(signature).toBe(`${r}${s}${v.toString(16).padStart(2, '0')}`)
    expect(client.rawCalls).toHaveLength(1)
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
})

function toTronAddress(pubkey: Uint8Array): string {
  const uncompressed = pubkey[0] === 4 ? pubkey.slice(1) : pubkey
  const addrHash = keccak256(uncompressed)
  const addrBytes = Buffer.from(addrHash.slice(2), 'hex').slice(-20)
  const tronAddrBytes = Buffer.concat([Buffer.from([0x41]), addrBytes])
  return bs58check.encode(tronAddrBytes)
}
