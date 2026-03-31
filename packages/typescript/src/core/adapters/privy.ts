import type { Eip712Capable, SignOptions, Wallet } from '../base.js'
import { SigningError, UnsupportedOperationError } from '../errors.js'
import type { PrivyClient, PrivyRpcMethod, PrivyRpcParams } from '../clients/privy.js'
import type { PrivyConfig } from '../providers/privy-config.js'
import { stripHexPrefix } from '../utils/hex.js'
import { keccak256, hashTypedData } from 'viem'
import { secp256k1 } from '@noble/curves/secp256k1'
import bs58checkModule from 'bs58check'
import { createHash } from 'node:crypto'

type Bs58checkLike = {
  encode?: (input: Uint8Array) => string
  default?: typeof bs58checkModule
}

const bs58checkInterop = bs58checkModule as Bs58checkLike
const bs58check: typeof bs58checkModule =
  typeof bs58checkInterop.encode === 'function'
    ? bs58checkModule
    : (bs58checkInterop.default ?? bs58checkModule)

export class PrivyAdapter implements Wallet, Eip712Capable {
  private readonly config: PrivyConfig
  private readonly client: PrivyClient
  private cachedAddress: string | null = null
  private cachedChainType: string | null = null

  constructor(config: PrivyConfig, client: PrivyClient) {
    this.config = config
    this.client = client
  }

  async getAddress(): Promise<string> {
    if (this.cachedAddress) return this.cachedAddress
    const wallet = await this.client.getWallet(this.config.walletId)
    this.cachedAddress = wallet.address
    this.cachedChainType = wallet.chainType ?? null
    return wallet.address
  }

  async signRaw(_rawTx: Uint8Array, options?: SignOptions): Promise<string> {
    const chain = await this.getChainType()
    if (chain === 'tron') {
      return this.tronSignBytes(_rawTx, options)
    }
    throw new UnsupportedOperationError('Privy adapter does not support raw transaction signing')
  }

  async signTransaction(payload: Record<string, unknown>, options?: SignOptions): Promise<string> {
    const chain = await this.getChainType()
    if (chain === 'tron') {
      return this.tronSignTransaction(payload, options)
    }
    const response = await this.rpc(
      'eth_signTransaction',
      normalizeTransactionPayload(payload),
      options,
    )
    const signed = response.data.signed_transaction
    if (!signed) {
      throw new SigningError('Privy eth_signTransaction did not return signed_transaction')
    }
    return stripHexPrefix(signed)
  }

  async signMessage(msg: Uint8Array, options?: SignOptions): Promise<string> {
    const chain = await this.getChainType()
    if (chain === 'tron') {
      return this.tronSignBytes(msg, options)
    }
    const hex = `0x${Buffer.from(msg).toString('hex')}`
    const response = await this.rpc(
      'personal_sign',
      {
        message: hex,
        encoding: 'hex',
      },
      options,
    )
    return extractSignature(response)
  }

  async signTypedData(data: Record<string, unknown>, options?: SignOptions): Promise<string> {
    const chain = await this.getChainType()
    if (chain === 'tron') {
      return this.tronSignTypedData(data, options)
    }
    const response = await this.rpc('eth_signTypedData_v4', normalizeTypedDataPayload(data), options)
    return extractSignature(response)
  }

  private async rpc(method: PrivyRpcMethod, params: PrivyRpcParams, options?: SignOptions) {
    return this.client.rpc(this.config.walletId, method, params, options)
  }

  private async getChainType(): Promise<string> {
    if (this.cachedChainType) return this.cachedChainType
    const wallet = await this.client.getWallet(this.config.walletId)
    this.cachedAddress = wallet.address
    this.cachedChainType = wallet.chainType?.toLowerCase() ?? ''
    return this.cachedChainType
  }

  private async tronSignTransaction(
    payload: Record<string, unknown>,
    options?: SignOptions,
  ): Promise<string> {
    const { txId } = normalizeTronTxPayload(payload)
    const signature = await this.tronSignHash(Buffer.from(txId, 'hex'), options)
    const signedTx = { ...payload, txID: txId, signature: [signature] }
    return JSON.stringify(signedTx)
  }

  private async tronSignBytes(bytes: Uint8Array, options?: SignOptions): Promise<string> {
    const hashHex = keccak256(bytes)
    const hash = Buffer.from(hashHex.slice(2), 'hex')
    return this.tronSignHash(hash, options)
  }

  private async tronSignTypedData(
    data: Record<string, unknown>,
    options?: SignOptions,
  ): Promise<string> {
    const typed = normalizeTypedDataPayload(data).typed_data as Record<string, unknown> | undefined
    if (!typed) {
      throw new SigningError('Privy TRON typed data payload is missing typed_data')
    }
    const { domain, types, message } = typed as {
      domain: Record<string, unknown>
      types: Record<string, Array<{ name: string; type: string }>>
      message: Record<string, unknown>
    }
    const primaryType = (typed.primary_type ?? typed.primaryType) as string
    if (!primaryType) {
      throw new SigningError('Privy TRON typed data payload is missing primaryType')
    }
    const { EIP712Domain: _domain, ...messageTypes } = types ?? {}
    const hashHex = hashTypedData({
      domain: domain as Record<string, unknown>,
      types: messageTypes as Record<string, Array<{ name: string; type: string }>>,
      primaryType,
      message: message as Record<string, unknown>,
    })
    const hash = Buffer.from(hashHex.slice(2), 'hex')
    return this.tronSignHash(hash, options)
  }

  private async tronSignHash(hash: Uint8Array, options?: SignOptions): Promise<string> {
    const hashHex = `0x${Buffer.from(hash).toString('hex')}`
    const response = await this.client.rawSign(this.config.walletId, { hash: hashHex }, options)
    const signature = extractSignature(response)
    const sigHex = stripHexPrefix(signature)
    const sigBytes = Buffer.from(sigHex, 'hex')
    if (sigBytes.length !== 64) {
      throw new SigningError('Privy raw_sign response must be 64-byte r||s for TRON')
    }
    const v = await recoverTronRecoveryId(sigBytes, hash, await this.getAddress())
    const vHex = (v + 27).toString(16).padStart(2, '0')
    return `${sigHex}${vHex}`
  }
}

function extractSignature(response: { data: { signature?: string } }): string {
  const signature = response.data.signature
  if (!signature) {
    throw new SigningError('Privy signing response missing signature')
  }
  return stripHexPrefix(signature)
}

function normalizeTransactionPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const hasTransaction = payload.transaction && typeof payload.transaction === 'object'
  const tx = (hasTransaction ? payload.transaction : payload) as Record<string, unknown>
  if (!tx || typeof tx !== 'object') return payload
  const normalized: Record<string, unknown> = {}
  const mappedKeys = new Set([
    'to',
    'data',
    'value',
    'nonce',
    'chain_id',
    'chainId',
    'gas_limit',
    'gas',
    'max_fee_per_gas',
    'maxFeePerGas',
    'max_priority_fee_per_gas',
    'maxPriorityFeePerGas',
    'gas_price',
    'gasPrice',
    'access_list',
    'accessList',
    'type',
  ])
  const pick = (...keys: string[]) => keys.map((k) => tx[k]).find((v) => v !== undefined)
  const assign = (key: string, value: unknown) => {
    if (value !== undefined) normalized[key] = value
  }

  assign('to', tx.to)
  assign('data', tx.data)
  assign('value', pick('value'))
  assign('nonce', pick('nonce'))
  assign('chain_id', pick('chain_id', 'chainId'))
  assign('gas_limit', pick('gas_limit', 'gas'))
  assign('max_fee_per_gas', pick('max_fee_per_gas', 'maxFeePerGas'))
  assign('max_priority_fee_per_gas', pick('max_priority_fee_per_gas', 'maxPriorityFeePerGas'))
  assign('gas_price', pick('gas_price', 'gasPrice'))
  assign('access_list', pick('access_list', 'accessList'))
  assign('type', pick('type'))

  for (const [key, value] of Object.entries(tx)) {
    if (!mappedKeys.has(key) && !(key in normalized)) {
      normalized[key] = value
    }
  }

  const hexFields = [
    'value',
    'gas_limit',
    'nonce',
    'chain_id',
    'max_fee_per_gas',
    'max_priority_fee_per_gas',
    'gas_price',
  ]
  for (const field of hexFields) {
    if (field in normalized) {
      normalized[field] = toHexValue(normalized[field])
    }
  }
  if (hasTransaction) {
    return { ...payload, transaction: normalized }
  }
  return { transaction: normalized }
}

function toHexValue(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return value
    if (trimmed.startsWith('0x')) return trimmed
    if (/^\d+$/.test(trimmed)) {
      return `0x${BigInt(trimmed).toString(16)}`
    }
    return value
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `0x${BigInt(Math.trunc(value)).toString(16)}`
  }
  if (typeof value === 'bigint') {
    return `0x${value.toString(16)}`
  }
  return value
}

function normalizeTypedDataPayload(data: Record<string, unknown>): Record<string, unknown> {
  const payload = 'typed_data' in data ? data : { typed_data: data }
  const typed = payload.typed_data as Record<string, unknown> | undefined
  if (!typed) return payload
  if ('primaryType' in typed && !('primary_type' in typed)) {
    typed.primary_type = typed.primaryType
    delete typed.primaryType
  }
  return payload
}

function normalizeTronTxPayload(payload: Record<string, unknown>): {
  txId: string
  rawDataHex: string
} {
  const rawDataHexRaw = payload.raw_data_hex
  if (typeof rawDataHexRaw !== 'string' || !rawDataHexRaw.trim()) {
    throw new SigningError('Payload must include raw_data_hex for TRON signing')
  }
  const rawDataHex = stripHexPrefix(rawDataHexRaw.trim())
  const txIdRaw = payload.txID ?? payload.txId ?? payload.tx_id
  if (typeof txIdRaw === 'string' && txIdRaw.trim()) {
    const txId = stripHexPrefix(txIdRaw.trim())
    if (!/^[0-9a-fA-F]{64}$/.test(txId)) {
      throw new SigningError('Payload txID must be a 32-byte hex string')
    }
    return { txId, rawDataHex }
  }
  const digest = createHash('sha256').update(Buffer.from(rawDataHex, 'hex')).digest('hex')
  return { txId: digest, rawDataHex }
}

async function recoverTronRecoveryId(
  signature: Uint8Array,
  hash: Uint8Array,
  address: string,
): Promise<number> {
  for (const recovery of [0, 1]) {
    try {
      const sig = secp256k1.Signature.fromCompact(signature).addRecoveryBit(recovery)
      const pub = sig.recoverPublicKey(hash)
      const tronAddress = tronAddressFromPublicKey(pub.toRawBytes(false))
      if (tronAddress === address) {
        return recovery
      }
    } catch {
      continue
    }
  }
  throw new UnsupportedOperationError('Unable to derive recovery id for TRON signature')
}

function tronAddressFromPublicKey(pubkey: Uint8Array): string {
  const uncompressed = pubkey[0] === 4 ? pubkey.slice(1) : pubkey
  const hash = keccak256(uncompressed)
  const addrBytes = Buffer.from(hash.slice(2), 'hex').slice(-20)
  const tronAddrBytes = Buffer.concat([Buffer.from([0x41]), addrBytes])
  return bs58check.encode(tronAddrBytes)
}
