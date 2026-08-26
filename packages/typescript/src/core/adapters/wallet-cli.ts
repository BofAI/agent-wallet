import {
  getAddress as checksumAddress,
  recoverTransactionAddress,
  serializeTransaction,
  type Hex,
  type TransactionSerialized,
} from 'viem'

import type {
  Eip712Capable,
  MessageSigningCapable,
  SignedTransactionArtifact,
  SignOptions,
  TransactionPayload,
  Wallet,
} from '../base.js'
import type { WalletCliClient, WalletCliCurrentAccountData } from '../clients/wallet-cli.js'
import { SigningError, WalletCliExecutionError } from '../errors.js'
import type { SecretLease, SecretProvider } from '../secret-provider.js'
import type { WalletCliConfig } from '../providers/wallet-cli-config.js'
import { parseWalletCliNetwork, type WalletCliNetworkTarget } from '../wallet-cli-network.js'

interface WalletCliIdentity {
  accountId: string
  addresses: WalletCliCurrentAccountData['addresses']
}

export class WalletCliAdapter implements Wallet, Eip712Capable, MessageSigningCapable {
  private readonly target: WalletCliNetworkTarget
  private identityPromise?: Promise<WalletCliIdentity>

  constructor(
    private readonly config: WalletCliConfig,
    private readonly client: WalletCliClient,
    private readonly secretProvider: SecretProvider,
    network: string,
  ) {
    this.target = parseWalletCliNetwork(network)
  }

  async getAddress(): Promise<string> {
    const identity = await this.getIdentity()
    return this.addressFor(identity)
  }

  async signTransaction(
    payload: TransactionPayload,
    options?: SignOptions,
  ): Promise<SignedTransactionArtifact> {
    if (this.target.family === 'tron') {
      const transactionJson = stringifyPayload(payload, 'TRON transaction')
      const identity = await this.getIdentity()
      return this.withLease(identity, async (lease) => {
        const result = await this.client.signTronTransaction(
          transactionJson,
          lease,
          identity,
          this.target,
          options?.signal,
        )
        this.assertSigner(result.data.address, identity)
        if (
          !Array.isArray(result.data.signed.signature) ||
          result.data.signed.signature.length === 0
        ) {
          throw new WalletCliExecutionError(
            'wallet-cli returned a TRON transaction without signatures',
            'contract_mismatch',
          )
        }
        return { family: 'tron', transaction: result.data.signed }
      })
    }

    const unsignedHex = serializeEvmPayload(payload, this.target)
    const identity = await this.getIdentity()
    return this.withLease(identity, async (lease) => {
      const result = await this.client.signEvmTransaction(
        unsignedHex,
        lease,
        identity,
        this.target,
        options?.signal,
      )
      this.assertSigner(result.data.address, identity)
      const raw = result.data.signed.raw as Hex
      let recovered: string
      try {
        recovered = await recoverTransactionAddress({
          serializedTransaction: raw as TransactionSerialized,
        })
      } catch {
        throw new WalletCliExecutionError(
          'wallet-cli returned an invalid EVM signed transaction',
          'contract_mismatch',
        )
      }
      this.assertSigner(recovered, identity)
      return { family: 'evm', rawTransaction: strip0x(raw) }
    })
  }

  async signTypedData(data: Record<string, unknown>, options?: SignOptions): Promise<string> {
    validateTypedDataChain(data, this.target)
    const typedDataJson = stringifyPayload(data, 'typed data')
    const identity = await this.getIdentity()
    return this.withLease(identity, async (lease) => {
      const result = await this.client.signTypedData(
        typedDataJson,
        lease,
        identity,
        this.target,
        options?.signal,
      )
      this.assertSigner(result.data.address, identity)
      return strip0x(result.data.signature)
    })
  }

  async signMessage(message: Uint8Array, options?: SignOptions): Promise<string> {
    let decoded: string
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(message)
    } catch {
      throw new SigningError('wallet_cli sign_message requires valid UTF-8 bytes')
    }
    if (!decoded) throw new SigningError('wallet_cli sign_message requires a non-empty message')

    const identity = await this.getIdentity()
    return this.withLease(identity, async (lease) => {
      const result = await this.client.signMessage(
        decoded,
        lease,
        identity,
        this.target,
        options?.signal,
      )
      this.assertSigner(result.data.address, identity)
      if (result.data.message !== decoded) {
        throw new WalletCliExecutionError(
          'wallet-cli message-signing result does not match the requested message',
          'contract_mismatch',
        )
      }
      return strip0x(result.data.signature)
    })
  }

  private getIdentity(): Promise<WalletCliIdentity> {
    if (!this.identityPromise) {
      this.identityPromise = this.resolveIdentity().catch((error) => {
        this.identityPromise = undefined
        throw error
      })
    }
    return this.identityPromise
  }

  private async resolveIdentity(): Promise<WalletCliIdentity> {
    await this.client.ensureCompatible(this.target)
    const result = await this.client.currentAccount(this.config.account)
    const identity = {
      accountId: result.data.accountId,
      addresses: { ...result.data.addresses },
    }
    this.addressFor(identity)
    return identity
  }

  private addressFor(identity: WalletCliIdentity): string {
    const address = identity.addresses[this.target.family]
    if (!address) {
      throw new WalletCliExecutionError(
        `wallet-cli account '${identity.accountId}' has no ${this.target.family.toUpperCase()} address`,
        'contract_mismatch',
      )
    }
    if (this.target.family === 'evm') {
      try {
        return checksumAddress(address)
      } catch {
        throw new WalletCliExecutionError(
          `wallet-cli account '${identity.accountId}' returned an invalid EVM address`,
          'contract_mismatch',
        )
      }
    }
    return address
  }

  private assertSigner(actual: string, identity: WalletCliIdentity): void {
    const expected = this.addressFor(identity)
    let matches = actual === expected
    if (this.target.family === 'evm') {
      try {
        matches = checksumAddress(actual) === expected
      } catch {
        matches = false
      }
    }
    if (!matches) {
      throw new WalletCliExecutionError(
        'wallet-cli signing result does not match the pinned account identity',
        'contract_mismatch',
      )
    }
  }

  private async withLease<T>(
    identity: WalletCliIdentity,
    operation: (lease: SecretLease) => Promise<T>,
  ): Promise<T> {
    const lease = await this.secretProvider.acquire({
      label: 'wallet-cli password',
      accountId: identity.accountId,
      network: this.target.cliNetwork,
    })
    try {
      return await operation(lease)
    } finally {
      await lease.dispose()
    }
  }
}

function stringifyPayload(payload: Record<string, unknown>, label: string): string {
  try {
    return JSON.stringify(payload)
  } catch {
    throw new SigningError(`wallet_cli ${label} is not JSON serializable`)
  }
}

function serializeEvmPayload(
  payload: Record<string, unknown>,
  target: WalletCliNetworkTarget,
): Hex {
  for (const field of ['r', 's', 'v', 'yParity', 'signature']) {
    if (payload[field] !== undefined) {
      throw new SigningError(`wallet_cli refuses an EVM transaction that already has '${field}'`)
    }
  }
  for (const field of ['txID', 'raw_data', 'raw_data_hex']) {
    if (payload[field] !== undefined) {
      throw new SigningError(`wallet_cli EVM transaction contains TRON field '${field}'`)
    }
  }

  const chainId = decimalInteger(payload.chainId)
  if (!target.requestedChainId || chainId !== target.requestedChainId) {
    throw new SigningError(
      `wallet_cli transaction chainId '${String(payload.chainId)}' does not match ${target.agentNetwork}`,
    )
  }
  const transactionType = payload.type
  if (
    transactionType === 3 ||
    transactionType === '3' ||
    transactionType === '0x3' ||
    transactionType === 'eip4844' ||
    transactionType === 4 ||
    transactionType === '4' ||
    transactionType === '0x4' ||
    transactionType === 'eip7702' ||
    ['blobs', 'blobVersionedHashes', 'maxFeePerBlobGas', 'sidecars', 'authorizationList'].some(
      (field) => payload[field] !== undefined,
    )
  ) {
    throw new SigningError('wallet_cli EIP-4844/EIP-7702 transactions are not supported')
  }

  try {
    return serializeTransaction({
      ...payload,
      chainId: Number(target.requestedChainId),
    } as Parameters<typeof serializeTransaction>[0])
  } catch (error) {
    throw new SigningError(
      `wallet_cli EVM transaction could not be serialized: ${error instanceof Error ? error.message : 'invalid payload'}`,
    )
  }
}

function validateTypedDataChain(
  data: Record<string, unknown>,
  target: WalletCliNetworkTarget,
): void {
  if (target.family !== 'evm') return
  const domain = data.domain
  if (!domain || typeof domain !== 'object') return
  const chainId = (domain as Record<string, unknown>).chainId
  if (chainId === undefined) return
  if (decimalInteger(chainId) !== target.requestedChainId) {
    throw new SigningError(
      `wallet_cli typed-data domain.chainId '${String(chainId)}' does not match ${target.agentNetwork}`,
    )
  }
}

function decimalInteger(value: unknown): string | undefined {
  if (typeof value === 'bigint') return value > 0n ? value.toString() : undefined
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : undefined
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return BigInt(value).toString()
  return undefined
}

function strip0x(hex: string): string {
  return hex.startsWith('0x') ? hex.slice(2) : hex
}
