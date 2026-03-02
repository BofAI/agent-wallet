/**
 * Common types for wallet providers
 */

/** Account info returned by getAccountInfo */
export interface AccountInfo {
  address: string;
}

/** Result of signing an unsigned transaction */
export interface SignedTxResult {
  /** Signed transaction object (chain-specific) */
  signedTx: unknown;
  /** Optional raw signature hex/base64 for compatibility */
  signature?: string;
}
