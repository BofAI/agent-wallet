// Core types and interfaces
export { WalletType } from "./core/base.js";
export type { BaseWallet, Eip712Capable } from "./core/base.js";

// Error classes
export {
  WalletError,
  WalletNotFoundError,
  DecryptionError,
  InsufficientBalanceError,
  SigningError,
  NetworkError,
  UnsupportedOperationError,
} from "./core/errors.js";

// Wallet adapters
export { EvmWallet } from "./core/adapters/evm.js";
export { TronWallet } from "./core/adapters/tron.js";

// Provider layer
export {
  WalletProvider,
  LocalWalletProvider,
  StaticWalletProvider,
  resolveWalletProvider,
} from "./core/providers/index.js";
export type { ResolveWalletProviderOptions } from "./core/providers/index.js";

// Local infrastructure (config + key storage)
export { CURRENT_CONFIG_VERSION, loadConfig, saveConfig, migrateConfig } from "./local/config.js";
export type { WalletConfig, WalletsTopology, WalletInfo } from "./local/config.js";
export { SecureKVStore, encryptBytes, decryptBytes } from "./local/kv-store.js";
