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

import type { WalletCliClient, WalletCliResult } from '../../core/clients/wallet-cli.js'

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

// ---------------------------------------------------------------------------
// Chain operations
// ---------------------------------------------------------------------------

export async function buildTransfer(
  client: WalletCliClient,
  params: BuildTransferParams,
): Promise<WalletCliResult<BuildTransferResult>> {
  const args = ['tx', 'send', '--to', params.to, '--network', params.network, '--dry-run', '-o', 'json']
  if (params.amount) args.push('--amount', params.amount)
  if (params.rawAmount) args.push('--raw-amount', params.rawAmount)
  if (params.token) args.push('--token', params.token)
  if (params.contract) args.push('--contract', params.contract)
  if (params.assetId) args.push('--asset-id', params.assetId)
  return client.run(args)
}

export async function broadcast(
  client: WalletCliClient,
  signedTx: string,
  network: string,
): Promise<WalletCliResult<BroadcastResult>> {
  const args = ['tx', 'broadcast', '--tx-stdin', '--network', network, '-o', 'json']
  return client.run(args, signedTx)
}

export async function getTxStatus(
  client: WalletCliClient,
  txid: string,
  network: string,
): Promise<WalletCliResult<TxStatusResult>> {
  const args = ['tx', 'status', '--txid', txid, '--network', network, '-o', 'json']
  return client.run(args)
}

export async function getBalance(
  client: WalletCliClient,
  network: string,
  accountRef?: string,
): Promise<WalletCliResult<AccountBalanceResult>> {
  const args = ['account', 'balance', '--network', network, '-o', 'json']
  if (accountRef) args.push('--account', accountRef)
  return client.run(args)
}

export async function getTxInfo(
  client: WalletCliClient,
  txid: string,
  network: string,
): Promise<WalletCliResult<unknown>> {
  const args = ['tx', 'info', '--txid', txid, '--network', network, '-o', 'json']
  return client.run(args)
}
