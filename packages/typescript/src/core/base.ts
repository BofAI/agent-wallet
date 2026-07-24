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
export const ENV_PRIVATE_KEY_KEYS = ['AGENT_WALLET_PRIVATE_KEY', 'TRON_PRIVATE_KEY'] as const
export const ENV_MNEMONIC_KEYS = ['AGENT_WALLET_MNEMONIC', 'TRON_MNEMONIC'] as const
export const ENV_ACCOUNT_INDEX_KEYS = [
  'AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX',
  'TRON_ACCOUNT_INDEX',
] as const

export interface Wallet {
  getAddress(): Promise<string>
  signTransaction(payload: Record<string, unknown>, options?: SignOptions): Promise<string>
}

export interface Eip712Capable {
  signTypedData(data: Record<string, unknown>, options?: SignOptions): Promise<string>
}

export type SignOptions = {
  authorizationSignature?: string
}

export interface WalletProvider {
  getActiveWallet(network?: string): Promise<Wallet>
}
