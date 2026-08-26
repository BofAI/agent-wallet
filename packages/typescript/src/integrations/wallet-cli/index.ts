/**
 * integrations/wallet-cli — optional chain-ops orchestration layer.
 *
 * Safe to remove without affecting the signing core. Provides build/broadcast/
 * query helpers and the signAndBroadcast end-to-end orchestrator.
 */

export { buildTransfer, broadcast, getTxStatus, getBalance, getTxInfo } from './chain-ops.js'
export type {
  BuildTransferParams,
  BuildTransferResult,
  BroadcastResult,
  TxStatusResult,
  AccountBalanceResult,
} from './chain-ops.js'

export { signAndBroadcast } from './orchestrate.js'
export type { SignAndBroadcastParams, SignAndBroadcastResult } from './orchestrate.js'
