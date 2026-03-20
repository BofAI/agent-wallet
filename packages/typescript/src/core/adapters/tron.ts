import { keccak256 } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { secp256k1 } from '@noble/curves/secp256k1'
import bs58checkModule from 'bs58check'

// Normalize CJS/ESM interop: bs58check v4 exports differ between CJS and ESM,
// and tsup's __toESM() wrapper can add an extra .default layer in CJS bundles.
const bs58check: typeof bs58checkModule =
  typeof (bs58checkModule as any).encode === 'function'
    ? bs58checkModule
    : (bs58checkModule as any).default

import type { Wallet, Eip712Capable } from '../base.js'
import { SigningError } from '../errors.js'

export class TronAdapter implements Wallet, Eip712Capable {
  private readonly privateKeyBytes: Uint8Array
  private readonly address: string
  private readonly network: string

  constructor(privateKey: Uint8Array, network: string = 'tron') {
    this.privateKeyBytes = privateKey
    this.network = network

    // Derive Tron address: 0x41 + ethAddress (without 0x prefix)
    const hex = `0x${Buffer.from(privateKey).toString('hex')}` as `0x${string}`
    const account = privateKeyToAccount(hex)
    const ethAddrBytes = Buffer.from(account.address.slice(2), 'hex') // 20 bytes
    const tronAddrBytes = Buffer.concat([Buffer.from([0x41]), ethAddrBytes])
    this.address = bs58check.encode(tronAddrBytes)
  }

  async getAddress(): Promise<string> {
    return this.address
  }

  async signRaw(rawTx: Uint8Array): Promise<string> {
    try {
      return this.ecdsaSign(rawTx)
    } catch (e) {
      throw new SigningError(`Tron sign_raw failed: ${e}`)
    }
  }

  /**
   * Sign a pre-built unsigned transaction from TronGrid.
   *
   * Accepts an unsigned tx object with { txID, raw_data_hex, raw_data }.
   * The txID is SHA256(raw_data) — we sign the txID directly with secp256k1
   * and return the signed tx as JSON with the signature attached.
   */
  async signTransaction(payload: Record<string, unknown>): Promise<string> {
    try {
      if (!payload.txID || !payload.raw_data_hex) {
        throw new Error(
          'Payload must be an unsigned transaction with {txID, raw_data_hex}. ' +
            'Use TronGrid API to build the transaction first.',
        )
      }
      const txId = payload.txID as string
      if (!/^[0-9a-fA-F]{64}$/.test(txId)) {
        throw new Error('Payload txID must be a 32-byte hex string')
      }
      const txIdBytes = Buffer.from(txId, 'hex')
      const signature = this.signDigest(txIdBytes)
      const signedTx = { ...payload, signature: [signature] }
      return JSON.stringify(signedTx)
    } catch (e) {
      if (e instanceof SigningError) throw e
      throw new SigningError(`Tron sign_transaction failed: ${e}`)
    }
  }

  async signMessage(msg: Uint8Array): Promise<string> {
    try {
      return this.ecdsaSign(msg)
    } catch (e) {
      throw new SigningError(`Tron sign_message failed: ${e}`)
    }
  }

  async signTypedData(data: Record<string, unknown>): Promise<string> {
    try {
      // Tron uses same secp256k1 as EVM for EIP-712 signing
      const hex = `0x${Buffer.from(this.privateKeyBytes).toString('hex')}` as `0x${string}`
      const account = privateKeyToAccount(hex)

      const { domain, types, primaryType, message } = data as {
        domain: Record<string, unknown>
        types: Record<string, Array<{ name: string; type: string }>>
        primaryType: string
        message: Record<string, unknown>
      }

      const { EIP712Domain: _domain, ...messageTypes } = types

      const sig = await account.signTypedData({
        domain: domain as any,
        types: messageTypes as any,
        primaryType,
        message: message as any,
      })
      return sig.slice(2)
    } catch (e) {
      throw new SigningError(`Tron sign_typed_data failed: ${e}`)
    }
  }

  /**
   * Raw ECDSA sign: keccak256(data) → secp256k1 sign → r || s || v (65 bytes hex)
   * This matches tronpy's PrivateKey.sign_msg() behavior.
   */
  private ecdsaSign(data: Uint8Array): string {
    const hash = keccak256(data)
    const hashBytes = Buffer.from(hash.slice(2), 'hex')
    return this.signDigest(hashBytes)
  }

  /**
   * Sign a pre-hashed 32-byte digest directly with secp256k1.
   * Used for transaction signing where the txID (SHA256 hash) is already computed.
   */
  private signDigest(digest: Uint8Array): string {
    const sig = secp256k1.sign(digest, this.privateKeyBytes)
    const r = sig.r.toString(16).padStart(64, '0')
    const s = sig.s.toString(16).padStart(64, '0')
    const v = (sig.recovery + 27).toString(16).padStart(2, '0')
    return r + s + v
  }
}
