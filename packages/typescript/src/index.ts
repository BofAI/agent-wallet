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
export { RemoteWallet } from "./core/adapters/remote.js";

// Provider layer
export {
  WalletProvider,
  LocalWalletProvider,
  RemoteWalletProvider,
  WalletFactory,
  createProvider,
} from "./core/provider.js";

// Storage
export { CURRENT_CONFIG_VERSION, loadConfig, saveConfig, migrateConfig } from "./storage/config.js";
export type { WalletConfig, WalletsTopology, WalletInfo } from "./storage/config.js";

// Secret management
export { SecureKVStore, encryptBytes, decryptBytes } from "./secret/kv-store.js";
