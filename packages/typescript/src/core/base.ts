export const WalletType = {
  EVM_LOCAL: 'evm_local',
  TRON_LOCAL: 'tron_local',
} as const

export type WalletType = (typeof WalletType)[keyof typeof WalletType]

export interface BaseWallet {
  getAddress(): Promise<string>
  signRaw(rawTx: Uint8Array): Promise<string>
  signTransaction(payload: Record<string, unknown>): Promise<string>
  signMessage(msg: Uint8Array): Promise<string>
}

export interface Eip712Capable {
  signTypedData(data: Record<string, unknown>): Promise<string>
}
