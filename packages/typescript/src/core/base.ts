export const WalletType = {
  EVM_LOCAL: 'evm_local',
  TRON_LOCAL: 'tron_local',
} as const

export type WalletType = (typeof WalletType)[keyof typeof WalletType]

export const COMMON_CHAINS: Record<WalletType, string[]> = {
  [WalletType.EVM_LOCAL]: [
    'eip155:1', // Ethereum Mainnet
    'eip155:11155111', // Ethereum Sepolia
    'eip155:56', // BNB Chain Mainnet
    'eip155:97', // BNB Chain Testnet
    'eip155:137', // Polygon Mainnet
    'eip155:80002', // Polygon Amoy
    'eip155:8453', // Base Mainnet
    'eip155:84532', // Base Sepolia
    'eip155:42161', // Arbitrum One
    'eip155:421614', // Arbitrum Sepolia
  ],
  [WalletType.TRON_LOCAL]: ['tron:mainnet', 'tron:nile', 'tron:shasta'],
}

export interface BaseWallet {
  getAddress(): Promise<string>
  signRaw(rawTx: Uint8Array): Promise<string>
  signTransaction(payload: Record<string, unknown>): Promise<string>
  signMessage(msg: Uint8Array): Promise<string>
}

export interface Eip712Capable {
  signTypedData(data: Record<string, unknown>): Promise<string>
}
