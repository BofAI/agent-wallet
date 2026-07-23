/**
 * signAndBroadcast — end-to-end orchestration helper.
 *
 * Chains: wallet-cli build tx (--dry-run, no password) → agent-wallet sign
 * (password used internally by the Wallet adapter) → wallet-cli broadcast
 * (signed tx via stdin, no password) → optional poll tx status (no password).
 *
 * Lives in integrations/ (optional, non-core). The signing core (Wallet
 * interface) is injected, so this works with any adapter — WalletCliAdapter,
 * TronSigner, etc.
 */

import type { Wallet } from '../../core/base.js'
import type { WalletCliClient } from '../../core/clients/wallet-cli.js'
import { buildTransfer, broadcast, getTxStatus } from './chain-ops.js'

export interface SignAndBroadcastParams {
  to: string
  amount?: string
  rawAmount?: string
  token?: string
  contract?: string
  assetId?: string
  network: string
  wait?: boolean
  waitTimeoutMs?: number
  confirmMainnet?: boolean
}

export interface SignAndBroadcastResult {
  txId: string
  stage: 'submitted' | 'confirmed' | 'failed' | 'timeout'
  confirmed?: boolean
  failed?: boolean
  blockNumber?: string
}

const DEFAULT_WAIT_TIMEOUT_MS = 60_000
const POLL_INTERVAL_MS = 3_000
const MAINNET = 'tron:mainnet'

export async function signAndBroadcast(
  wallet: Wallet,
  client: WalletCliClient,
  params: SignAndBroadcastParams,
): Promise<SignAndBroadcastResult> {
  // Mainnet safety guard
  if (params.network === MAINNET && !params.confirmMainnet) {
    throw new Error(
      `Mainnet broadcast requires explicit confirmation: pass confirmMainnet: true for ${MAINNET}`,
    )
  }

  // Step 1: Build unsigned transaction (no password)
  const buildResult = await buildTransfer(client, {
    to: params.to,
    amount: params.amount,
    rawAmount: params.rawAmount,
    token: params.token,
    contract: params.contract,
    assetId: params.assetId,
    network: params.network,
  })
  if (!buildResult.success || !buildResult.data?.tx) {
    throw new Error(`Failed to build transaction: ${buildResult.error?.message}`)
  }

  // Step 2: Sign with agent-wallet (password used internally by the adapter)
  const signedTxJson = await wallet.signTransaction(buildResult.data.tx as Record<string, unknown>)

  // Step 3: Broadcast (signed tx via stdin, no password)
  const broadcastResult = await broadcast(client, signedTxJson, params.network)
  if (!broadcastResult.success || !broadcastResult.data?.txId) {
    throw new Error(`Failed to broadcast: ${broadcastResult.error?.message}`)
  }

  const txId = broadcastResult.data.txId

  // Step 4: Optional polling
  if (!params.wait) {
    return { txId, stage: 'submitted' }
  }

  const deadline = Date.now() + (params.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS)
  while (Date.now() < deadline) {
    const statusResult = await getTxStatus(client, txId, params.network)
    if (!statusResult.success || !statusResult.data) {
      await sleep(POLL_INTERVAL_MS)
      continue
    }

    const state = statusResult.data.state
    if (state === 'confirmed') {
      return {
        txId,
        stage: 'confirmed',
        confirmed: true,
        blockNumber: statusResult.data.blockNumber,
      }
    }
    if (state === 'failed') {
      return { txId, stage: 'failed', failed: true }
    }
    // pending or not_found: keep polling
    await sleep(POLL_INTERVAL_MS)
  }

  // Timeout: transaction may still be in flight — do NOT auto-resend
  return { txId, stage: 'timeout' }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
