// Core types
export { Network, WalletType } from './core/base.js'
export type { Wallet, Eip712Capable, WalletProvider } from './core/base.js'

// Error classes
export {
  WalletError,
  WalletNotFoundError,
  DecryptionError,
  InsufficientBalanceError,
  SigningError,
  NetworkError,
  UnsupportedOperationError,
} from './core/errors.js'

// Wallet adapters
export { EvmAdapter } from './core/adapters/evm.js'
export { TronAdapter } from './core/adapters/tron.js'

// Provider layer
export { ConfigWalletProvider, EnvWalletProvider } from './core/providers/index.js'
export type { SecretLoaderFn } from './core/providers/index.js'

// Resolver
export { resolveWallet, resolveWalletProvider } from './core/resolver.js'
export type { ResolvedWalletProvider } from './core/resolver.js'

// Config types and functions
export {
  loadConfig,
  saveConfig,
  loadRuntimeSecretsPassword,
} from './core/config.js'
export type {
  WalletConfig,
  WalletsTopology,
  LocalSecureWalletConfig,
  RawSecretWalletConfig,
  RawSecretPrivateKeyConfig,
  RawSecretMnemonicConfig,
  RawSecretMaterial,
} from './core/config.js'

// KV Store
export { SecureKVStore, encryptBytes, decryptBytes } from './local/kv-store.js'
