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
import { assertTronWalletCliNetwork } from '../../core/wallet-cli-network.js'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuildTransferParams {
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
    '--network',
    params.network,
    '--dry-run',
    '-o',
    'json',
  ]
  if (params.amount) args.push('--amount', params.amount)
  if (params.rawAmount) args.push('--raw-amount', params.rawAmount)
  if (params.token) args.push('--token', params.token)
  if (params.contract) args.push('--contract', params.contract)
  if (params.assetId) args.push('--asset-id', params.assetId)
  return client.run(args, {
    command: 'tx.send',
    dataSchema: BuildTransferSchema,
    chain: compatibility.network!,
  })
}

export async function broadcast(
  client: WalletCliClient,
  signedTx: string,
  network: string,
): Promise<WalletCliSuccessResult<BroadcastResult>> {
  const target = assertTronWalletCliNetwork(network)
  const compatibility = await client.ensureCompatible(target)
  const args = ['tx', 'broadcast', '--tx-stdin', '--network', network, '-o', 'json']
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
  const args = ['tx', 'status', '--txid', txid, '--network', network, '-o', 'json']
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
  const args = ['account', 'balance', '--network', network, '-o', 'json']
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
  const args = ['tx', 'info', '--txid', txid, '--network', network, '-o', 'json']
  return client.run(args, {
    command: 'tx.info',
    dataSchema: z.unknown(),
    chain: compatibility.network!,
  })
}
