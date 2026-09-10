/**
 * Chain operations via wallet-cli — build transactions, broadcast, query.
 *
 * This module lives in integrations/ (optional, non-core): it orchestrates
 * wallet-cli subprocess calls for chain operations that agent-wallet's
 * signing core deliberately does not own. It reuses WalletCliClient.run
 * for transport + envelope parsing.
 *
 * Passwords are never needed here: --dry-run builds without signing, and
 * tx broadcast accepts an already-signed transaction.
 */

import type { WalletCliClient, WalletCliSuccessResult } from '../../core/clients/wallet-cli.js'
import { WalletCliExecutionError } from '../../core/errors.js'
import { assertTronWalletCliNetwork } from '../../core/wallet-cli-network.js'
import bs58checkModule from 'bs58check'
import { z } from 'zod'

type Bs58checkLike = {
  decode?: (input: string) => Uint8Array
  default?: typeof bs58checkModule
}

const bs58checkInterop = bs58checkModule as Bs58checkLike
const bs58check: typeof bs58checkModule =
  typeof bs58checkInterop.decode === 'function'
    ? bs58checkModule
    : (bs58checkInterop.default ?? bs58checkModule)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuildTransferParams {
  from: string
  to: string
  amount?: string
  rawAmount?: string
  token?: string
  contract?: string
  assetId?: string
  network: string
}

export interface BuildTransferResult {
  kind: string
  mode: string
  tx: Record<string, unknown>
  fee: unknown
  rawAmount: string
  to: string
}

export interface BroadcastResult {
  kind: string
  stage: string
  txId: string
  confirmed?: boolean
  failed?: boolean
  blockNumber?: string
}

export interface TxStatusResult {
  state: 'confirmed' | 'failed' | 'pending' | 'not_found'
  confirmed: boolean
  failed: boolean
  blockNumber?: string
}

export interface AccountBalanceResult {
  address: string
  balance: string
  decimals: number
  symbol: string
}

const BuildTransferSchema = z
  .object({
    kind: z.string(),
    mode: z.string(),
    tx: z.record(z.unknown()),
    fee: z.unknown(),
    rawAmount: z.string(),
    to: z.string(),
  })
  .passthrough() as unknown as z.ZodType<BuildTransferResult>
const BroadcastSchema = z
  .object({
    kind: z.string(),
    stage: z.string(),
    txId: z.string().min(1),
    confirmed: z.boolean().optional(),
    failed: z.boolean().optional(),
    blockNumber: z.string().optional(),
  })
  .passthrough()
const TxStatusSchema = z
  .object({
    state: z.enum(['confirmed', 'failed', 'pending', 'not_found']),
    confirmed: z.boolean(),
    failed: z.boolean(),
    blockNumber: z
      .union([z.string(), z.number()])
      .optional()
      .transform((value) => (value === undefined ? undefined : String(value))),
  })
  .passthrough() as unknown as z.ZodType<TxStatusResult>
const AccountBalanceSchema = z
  .object({
    address: z.string(),
    balance: z.string(),
    decimals: z.number().int().nonnegative(),
    symbol: z.string(),
  })
  .passthrough()

// ---------------------------------------------------------------------------
// Chain operations
// ---------------------------------------------------------------------------

export async function buildTransfer(
  client: WalletCliClient,
  params: BuildTransferParams,
): Promise<WalletCliSuccessResult<BuildTransferResult>> {
  const target = assertTronWalletCliNetwork(params.network)
  const compatibility = await client.ensureCompatible(target)
  const args = [
    'tx',
    'send',
    '--to',
    params.to,
    '--account',
    params.from,
    '--network',
    target.cliNetwork,
    '--dry-run',
    '-o',
    'json',
  ]
  if (params.amount) args.push('--amount', params.amount)
  if (params.rawAmount) args.push('--raw-amount', params.rawAmount)
  if (params.token) args.push('--token', params.token)
  if (params.contract) args.push('--contract', params.contract)
  if (params.assetId) args.push('--asset-id', params.assetId)
  const result = await client.run(args, {
    command: 'tx.send',
    dataSchema: BuildTransferSchema,
    chain: compatibility.network!,
  })
  assertTransferOwner(result.data.tx, params.from)
  return result
}

export async function broadcast(
  client: WalletCliClient,
  signedTx: string,
  network: string,
): Promise<WalletCliSuccessResult<BroadcastResult>> {
  const target = assertTronWalletCliNetwork(network)
  const compatibility = await client.ensureCompatible(target)
  const args = ['tx', 'broadcast', '--tx-stdin', '--network', target.cliNetwork, '-o', 'json']
  return client.run(args, {
    command: 'tx.broadcast',
    dataSchema: BroadcastSchema,
    chain: compatibility.network!,
    stdin: signedTx,
  })
}

export async function getTxStatus(
  client: WalletCliClient,
  txid: string,
  network: string,
): Promise<WalletCliSuccessResult<TxStatusResult>> {
  const target = assertTronWalletCliNetwork(network)
  const compatibility = await client.ensureCompatible(target)
  const args = ['tx', 'status', '--txid', txid, '--network', target.cliNetwork, '-o', 'json']
  return client.run(args, {
    command: 'tx.status',
    dataSchema: TxStatusSchema,
    chain: compatibility.network!,
  })
}

export async function getBalance(
  client: WalletCliClient,
  network: string,
  accountRef?: string,
): Promise<WalletCliSuccessResult<AccountBalanceResult>> {
  const target = assertTronWalletCliNetwork(network)
  const compatibility = await client.ensureCompatible(target)
  const args = ['account', 'balance', '--network', target.cliNetwork, '-o', 'json']
  if (accountRef) args.push('--account', accountRef)
  return client.run(args, {
    command: 'account.balance',
    dataSchema: AccountBalanceSchema,
    chain: compatibility.network!,
  })
}

export async function getTxInfo(
  client: WalletCliClient,
  txid: string,
  network: string,
): Promise<WalletCliSuccessResult<unknown>> {
  const target = assertTronWalletCliNetwork(network)
  const compatibility = await client.ensureCompatible(target)
  const args = ['tx', 'info', '--txid', txid, '--network', target.cliNetwork, '-o', 'json']
  return client.run(args, {
    command: 'tx.info',
    dataSchema: z.unknown(),
    chain: compatibility.network!,
  })
}

function assertTransferOwner(transaction: Record<string, unknown>, expectedAddress: string): void {
  const expected = tronAddressHex(expectedAddress)
  const rawData = transaction.raw_data
  const contracts =
    rawData && typeof rawData === 'object'
      ? (rawData as Record<string, unknown>).contract
      : undefined
  if (!Array.isArray(contracts) || contracts.length === 0) {
    throw new WalletCliExecutionError(
      'wallet-cli built a transaction without an owner contract',
      'contract_mismatch',
    )
  }

  const owners = contracts.map((contract) => {
    if (!contract || typeof contract !== 'object') return undefined
    const parameter = (contract as Record<string, unknown>).parameter
    if (!parameter || typeof parameter !== 'object') return undefined
    const value = (parameter as Record<string, unknown>).value
    if (!value || typeof value !== 'object') return undefined
    return (value as Record<string, unknown>).owner_address
  })
  if (
    owners.some(
      (owner) =>
        typeof owner !== 'string' ||
        (owner === expectedAddress ? expected : owner.replace(/^0x/i, '').toLowerCase()) !==
          expected,
    )
  ) {
    throw new WalletCliExecutionError(
      'wallet-cli built a transaction for a different owner than the injected wallet',
      'contract_mismatch',
    )
  }
}

function tronAddressHex(address: string): string {
  try {
    const decoded = Buffer.from(bs58check.decode(address))
    if (decoded.length !== 21 || decoded[0] !== 0x41) throw new Error('invalid TRON address')
    return decoded.toString('hex').toLowerCase()
  } catch {
    throw new WalletCliExecutionError(
      'The injected wallet returned an invalid TRON address',
      'contract_mismatch',
    )
  }
}
