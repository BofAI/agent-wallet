export const Network = {
  EVM: 'evm',
  TRON: 'tron',
} as const

export type Network = (typeof Network)[keyof typeof Network]

export const WalletType = {
  LOCAL_SECURE: 'local_secure',
  RAW_SECRET: 'raw_secret',
} as const

export type WalletType = (typeof WalletType)[keyof typeof WalletType]

export interface Wallet {
  getAddress(): Promise<string>
  signRaw(rawTx: Uint8Array): Promise<string>
  signTransaction(payload: Record<string, unknown>): Promise<string>
  signMessage(msg: Uint8Array): Promise<string>
}

export interface Eip712Capable {
  signTypedData(data: Record<string, unknown>): Promise<string>
}

export interface WalletProvider {
  getActiveWallet(network?: string): Promise<Wallet>
}
