// Core types
export { Network, WalletType } from './core/base.js'
export type {
  Wallet,
  TransactionPayload,
  EvmTransactionPayload,
  TronTransactionPayload,
  SignedTransactionArtifact,
  EvmSignedTransactionArtifact,
  TronSignedTransactionArtifact,
  Eip712Capable,
  WalletProvider,
  SignOptions,
} from './core/base.js'

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
  ExternalSignerError,
  ExternalSignerConfigError,
  ExternalSignerExecutionError,
  ExternalSignerUsageError,
  ExternalSignerNotFoundError,
  WalletCliConfigError,
  WalletCliNotFoundError,
  WalletCliUsageError,
  WalletCliExecutionError,
  WalletCliSubmittedTransactionError,
} from './core/errors.js'

// Provider layer
export { ConfigWalletProvider, EnvWalletProvider } from './core/providers/index.js'

// Secret resolver
export type { SecretRef, SecretValue } from './core/secret-resolver.js'

// Resolver
export { resolveWallet, resolveWalletProvider } from './core/resolver.js'
export type { ResolvedWalletProvider } from './core/resolver.js'

// Config types and functions
export { loadConfig, saveConfig } from './core/config.js'
export type {
  WalletConfig,
  WalletsTopology,
  RawSecretPrivateKeyParams,
  RawSecretMnemonicParams,
  RawSecretParams,
  PrivyWalletParams,
  WalletCliWalletParams,
} from './core/config.js'
export type { WalletDependencies, WalletCliDependencies } from './core/providers/wallet-builder.js'
