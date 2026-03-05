export const WalletType = {
  EVM_LOCAL: "evm_local",
  TRON_LOCAL: "tron_local",
} as const;

export type WalletType = (typeof WalletType)[keyof typeof WalletType];

export const COMMON_CHAINS: Record<WalletType, string[]> = {
  [WalletType.EVM_LOCAL]: [
    "eip155:1",
    "eip155:56",
    "eip155:137",
    "eip155:8453",
    "eip155:42161",
  ],
  [WalletType.TRON_LOCAL]: ["tron:mainnet", "tron:nile", "tron:shasta"],
};

export interface BaseWallet {
  getAddress(): Promise<string>;
  signRaw(rawTx: Uint8Array): Promise<string>;
  signTransaction(payload: Record<string, unknown>): Promise<string>;
  signMessage(msg: Uint8Array): Promise<string>;
}

export interface Eip712Capable {
  signTypedData(data: Record<string, unknown>): Promise<string>;
}
