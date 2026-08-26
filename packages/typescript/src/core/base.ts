export const Network = {
  EVM: 'evm',
  TRON: 'tron',
} as const

export type Network = (typeof Network)[keyof typeof Network]

export const WalletType = {
  RAW_SECRET: 'raw_secret',
  PRIVY: 'privy',
  WALLET_CLI: 'wallet_cli',
} as const

export type WalletType = (typeof WalletType)[keyof typeof WalletType]

export const ENV_AGENT_WALLET_DIR = 'AGENT_WALLET_DIR'
export const ENV_PRIVATE_KEY_KEYS = ['AGENT_WALLET_PRIVATE_KEY'] as const
export const ENV_MNEMONIC_KEYS = ['AGENT_WALLET_MNEMONIC'] as const
export const ENV_ACCOUNT_INDEX_KEYS = ['AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX'] as const

export type EvmTransactionPayload = Record<string, unknown>
export type TronTransactionPayload = Record<string, unknown> & { raw_data_hex?: string }
export type TransactionPayload = EvmTransactionPayload | TronTransactionPayload

export type EvmSignedTransactionArtifact = {
  family: 'evm'
  rawTransaction: string
}

export type TronSignedTransactionArtifact = {
  family: 'tron'
  transaction: Record<string, unknown>
}

export type SignedTransactionArtifact = EvmSignedTransactionArtifact | TronSignedTransactionArtifact

export interface Wallet {
  getAddress(): Promise<string>
  signTransaction(
    payload: TransactionPayload,
    options?: SignOptions,
  ): Promise<SignedTransactionArtifact>
}

export interface Eip712Capable {
  signTypedData(data: Record<string, unknown>, options?: SignOptions): Promise<string>
}

/** Additive capability for wallets that can preserve UTF-8 message semantics. */
export interface MessageSigningCapable {
  signMessage(message: Uint8Array, options?: SignOptions): Promise<string>
}

export type SignOptions = {
  authorizationSignature?: string
  signal?: AbortSignal
}

export interface WalletProvider {
  getActiveWallet(network?: string): Promise<Wallet>
}
