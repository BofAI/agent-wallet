// Core types
export { Network, WalletType } from './core/base.js'
export type { Wallet, Eip712Capable, WalletProvider, SignOptions } from './core/base.js'

// Error classes
export {
  WalletError,
  WalletNotFoundError,
  DecryptionError,
  InsufficientBalanceError,
  SigningError,
  NetworkError,
  UnsupportedOperationError,
  PrivyConfigError,
  PrivyRequestError,
  PrivyRateLimitError,
  PrivyAuthError,
} from './core/errors.js'

// Wallet adapters
export { EvmSigner } from './core/adapters/evm.js'
export { TronSigner } from './core/adapters/tron.js'
export { LocalSigner } from './core/adapters/local.js'
export { LocalSecureSigner } from './core/adapters/local-secure.js'
export { RawSecretSigner } from './core/adapters/raw-secret.js'
export { PrivyAdapter } from './core/adapters/privy.js'

// Provider layer
export { ConfigWalletProvider, EnvWalletProvider } from './core/providers/index.js'
export type { SecretLoaderFn } from './core/providers/index.js'

// Resolver
export { resolveWallet, resolveWalletProvider } from './core/resolver.js'
export type { ResolvedWalletProvider } from './core/resolver.js'

// Config types and functions
export { loadConfig, saveConfig, loadRuntimeSecretsPassword } from './core/config.js'
export type {
  WalletConfig,
  WalletsTopology,
  LocalSecureWalletParams,
  RawSecretPrivateKeyParams,
  RawSecretMnemonicParams,
  RawSecretParams,
  PrivyWalletParams,
} from './core/config.js'
export { PrivyConfigResolver } from './core/providers/privy-config.js'
export { PrivyClient } from './core/clients/privy.js'

// KV Store
export { SecureKVStore, encryptBytes, decryptBytes } from './local/kv-store.js'
